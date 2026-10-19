<#
.SYNOPSIS
  Despliega LOS PAPIS en el servidor de pruebas (pnpm deploy:pruebas).

.DESCRIPTION
  Construye las imágenes los-papis-api y los-papis-web en este PC con los MISMOS Dockerfiles que CI, las sube al
  VPS por ssh (docker save | docker load), copia los archivos de compose y ejecuta infra/server/deploy-remote.sh
  como el usuario de despliegue (migraciones, arranque y comprobación). El servidor no construye nada: comparte su
  memoria con otras aplicaciones del dueño. Al final comprueba /api/health desde este PC por HTTPS.

  Pensado para Windows PowerShell 5.1: sin "&&", sin operadores ternarios, $LASTEXITCODE tras cada ejecutable y
  cmd.exe para la tubería de bytes entre docker save y ssh (PowerShell la convertiría a texto y la rompería).

.PARAMETER Tag
  Etiqueta de las imágenes. Por defecto, el commit actual (git rev-parse --short=12 HEAD).

.PARAMETER SkipBuild
  No construye: usa las imágenes con esa etiqueta que ya existan en el servidor (no se vuelven a subir) o, si no
  están allí, en este PC. Para volver atrás: .\scripts\deploy-pruebas.ps1 -Tag <etiqueta anterior> -SkipBuild

.PARAMETER SshAlias
  Alias de ~/.ssh/config del usuario de despliegue (por defecto lospapis-pruebas; ver README, "Servidor de pruebas").

.PARAMETER RemoteDir
  Carpeta de despliegue en el servidor (por defecto /opt/los-papis; la crea infra/server/provision-pruebas.sh).

.EXAMPLE
  pnpm deploy:pruebas

.EXAMPLE
  .\scripts\deploy-pruebas.ps1 -Tag 4de17c9a1b2c -SkipBuild
#>
[CmdletBinding()]
param(
  [string]$Tag,
  [switch]$SkipBuild,
  [string]$SshAlias = 'lospapis-pruebas',
  [string]$RemoteDir = '/opt/los-papis'
)

$ErrorActionPreference = 'Stop'
# Una terminal abierta antes de instalar Docker o Git no los ve: se recarga el PATH desde el registro.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
# Invoke-RestMethod por HTTPS en .NET Framework: asegurar TLS 1.2.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

function Write-Step([string]$Text) {
  Write-Host ''
  Write-Host "== $Text" -ForegroundColor Cyan
}

function Assert-LastExitCode([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What ha fallado (código de salida $LASTEXITCODE)." }
}

function Assert-LineFeedOnly([string]$RelativePath) {
  # Los scripts que corren en el servidor tienen que ir con LF: un CR rompe bash ("$'\r': command not found").
  $bytes = [IO.File]::ReadAllBytes((Join-Path $repoRoot $RelativePath))
  if ($bytes -contains 13) {
    throw "$RelativePath tiene finales de línea CRLF; conviértelo a LF (git add --renormalize $RelativePath) antes de desplegar."
  }
}

try {
  Write-Step 'Herramientas'
  foreach ($tool in 'docker', 'ssh', 'scp', 'git') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
      throw "No encuentro '$tool' en el PATH. Docker Desktop, Git y el cliente OpenSSH de Windows tienen que estar instalados."
    }
  }
  $dirty = @(git status --porcelain)
  Assert-LastExitCode 'git status'
  if ($dirty.Count -gt 0) {
    Write-Warning "Hay $($dirty.Count) cambio(s) sin commit: la etiqueta del commit no describe exactamente lo que se despliega."
  }

  if (-not $Tag) {
    $Tag = git rev-parse --short=12 HEAD
    Assert-LastExitCode 'git rev-parse'
    $Tag = "$Tag".Trim()
  }
  if ($Tag -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$') {
    throw "Etiqueta no válida: '$Tag' (letras, números, '.', '_' y '-')."
  }
  $packageVersion = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
  $version = "$packageVersion+$Tag"
  $apiImage = "los-papis-api:$Tag"
  $webImage = "los-papis-web:$Tag"
  Write-Host "Etiqueta $Tag · APP_VERSION $version · servidor $SshAlias ($RemoteDir)"

  $upload = $true
  if ($SkipBuild) {
    Write-Step "Sin construir: busco $apiImage y $webImage"
    ssh $SshAlias "docker image inspect $apiImage $webImage >/dev/null 2>&1"
    if ($LASTEXITCODE -eq 0) {
      Write-Host 'El servidor ya tiene las dos imágenes: no hace falta subirlas.'
      $upload = $false
    } else {
      foreach ($image in $apiImage, $webImage) {
        docker image inspect $image > $null
        if ($LASTEXITCODE -ne 0) {
          throw "No existe la imagen $image ni en el servidor ni en este PC. Quita -SkipBuild para construirla."
        }
      }
      Write-Host 'Las imágenes están en este PC: se suben al servidor.'
    }
  } else {
    Write-Step "Construyo $apiImage"
    docker build -f infra/docker/api.Dockerfile --build-arg "APP_VERSION=$version" -t $apiImage .
    Assert-LastExitCode "docker build de $apiImage"
    Write-Step "Construyo $webImage"
    docker build -f infra/docker/web.Dockerfile -t $webImage .
    Assert-LastExitCode "docker build de $webImage"
  }

  if ($upload) {
    Write-Step "Subo las imágenes a $SshAlias (docker save | ssh -C docker load; unos 100 MB comprimidos)"
    # cmd.exe pasa los bytes intactos entre los dos procesos; PowerShell 5.1 los convertiría a texto.
    cmd /c "docker save $apiImage $webImage | ssh -C $SshAlias docker load"
    Assert-LastExitCode 'La subida de las imágenes'
  }

  Write-Step "Copio compose y scripts a ${SshAlias}:${RemoteDir}"
  foreach ($path in 'infra/server/deploy-remote.sh', 'infra/postgres/init/01-roles.sh') { Assert-LineFeedOnly $path }
  ssh $SshAlias "mkdir -p $RemoteDir/infra/postgres/init $RemoteDir/infra/server"
  Assert-LastExitCode 'mkdir en el servidor'
  # .env.example va también: compose.yaml lo declara como env_file obligatorio (la capa del servidor lo anula) y
  # documenta las variables; los valores reales están solo en el .env del servidor.
  scp -q compose.yaml compose.server.yaml .env.example "${SshAlias}:${RemoteDir}/"
  Assert-LastExitCode 'scp de los archivos de compose'
  scp -q infra/postgres/init/01-roles.sh "${SshAlias}:${RemoteDir}/infra/postgres/init/"
  Assert-LastExitCode 'scp de 01-roles.sh'
  scp -q infra/server/deploy-remote.sh "${SshAlias}:${RemoteDir}/infra/server/"
  Assert-LastExitCode 'scp de deploy-remote.sh'

  Write-Step "Despliego en el servidor (deploy-remote.sh, etiqueta $Tag)"
  ssh $SshAlias "IMAGE_TAG=$Tag bash $RemoteDir/infra/server/deploy-remote.sh"
  Assert-LastExitCode 'deploy-remote.sh'

  Write-Step 'Comprobación desde el PC'
  $publicUrl = ssh $SshAlias "grep '^PUBLIC_URL=' $RemoteDir/.env | cut -d= -f2-"
  Assert-LastExitCode 'lectura de PUBLIC_URL'
  $publicUrl = "$publicUrl".Trim()
  if (-not $publicUrl) { throw "No he podido leer PUBLIC_URL de ${RemoteDir}/.env en el servidor." }
  $health = Invoke-RestMethod -Uri "$publicUrl/api/health" -TimeoutSec 30
  Write-Host "$publicUrl/api/health -> estado $($health.status), versión $($health.version), hora $($health.time)"
  $pushConfig = Invoke-RestMethod -Uri "$publicUrl/api/push/config" -TimeoutSec 30
  if ($pushConfig.enabled) { $pushState = 'activados' } else { $pushState = 'DESACTIVADOS' }
  Write-Host "$publicUrl/api/push/config -> avisos push $pushState"

  Write-Host ''
  Write-Host "Listo: $publicUrl (etiqueta $Tag)." -ForegroundColor Green
  Write-Host "Para volver atrás: .\scripts\deploy-pruebas.ps1 -Tag <etiqueta anterior> -SkipBuild"
  Write-Host "Etiquetas en el servidor: ssh $SshAlias docker image ls los-papis-api"
  Write-Host "Registros: ssh $SshAlias `"cd $RemoteDir && docker compose -f compose.yaml -f compose.server.yaml logs -f api`""
} catch {
  Write-Host ''
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
