// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findHardcodedText, formatViolations } from './hardcoded-text.ts';

const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC_DIR = path.join(WEB_ROOT, 'src');

/** Excepciones por archivo (ruta relativa a apps/web, con "/"), cada una con su motivo. Vacía a propósito. */
const IGNORED_FILES: ReadonlySet<string> = new Set<string>([]);

/** Archivos que no son interfaz: pruebas y stories dentro de src. */
const IGNORED_PATTERNS: readonly RegExp[] = [/\.test\.tsx$/, /\.stories\.tsx$/];

function listTsxFiles(): string[] {
  return readdirSync(SRC_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .map((abs) => path.relative(WEB_ROOT, abs).split(path.sep).join('/'))
    .filter((rel) => !IGNORED_FILES.has(rel))
    .filter((rel) => !IGNORED_PATTERNS.some((re) => re.test(rel)))
    .sort();
}

describe('findHardcodedText (el detector en sí)', () => {
  it('señala texto JSX, expresiones literales y atributos visibles', () => {
    const source = [
      'export const A = () => (',
      '  <div>',
      '    Hola',
      '    {"Adiós"}',
      '    {ok ? "Sí" : "No"}',
      '    <input placeholder="Nombre" title={"Pista"} />',
      '    <img alt="Logo" src="/x.png" />',
      '  </div>',
      ');',
    ].join('\n');
    const found = findHardcodedText('src/A.tsx', source);
    expect(found.map((v) => [v.line, v.kind, v.text])).toEqual([
      [3, 'jsx-text', 'Hola'],
      [4, 'jsx-expression', 'Adiós'],
      [5, 'jsx-expression', 'Sí'],
      [5, 'jsx-expression', 'No'],
      [6, 'attribute:placeholder', 'Nombre'],
      [6, 'attribute:title', 'Pista'],
      [7, 'attribute:alt', 'Logo'],
    ]);
  });

  it('no señala t(), símbolos, números, entidades, className ni la marca', () => {
    const source = [
      'export const B = () => (',
      '  <section className="flex items-center" data-testid="caja" aria-label={t("caja.titulo")}>',
      '    {t("nav.register")} · 27,00 € &nbsp; — 2:1:1',
      '    <h1>LOS PAPIS</h1>',
      '    <input placeholder={t("common.search")} alt="" />',
      '    {items.map((i) => <li key="k">{i.name}</li>)}',
      '  </section>',
      ');',
    ].join('\n');
    expect(findHardcodedText('src/B.tsx', source)).toEqual([]);
  });
});

describe('ningún texto de interfaz escrito en apps/web/src', () => {
  it('recorre src/**/*.tsx y no encuentra texto fuera de los JSON', () => {
    const files = listTsxFiles();
    expect(files.length, 'no se encontró ningún .tsx en src').toBeGreaterThan(0);

    const violations = files.flatMap((rel) =>
      findHardcodedText(rel, readFileSync(path.join(WEB_ROOT, rel), 'utf8')),
    );

    const report = [
      `${violations.length} texto(s) escritos directamente en el código.`,
      'Pásalos por t() (o añade la excepción, con motivo, en este archivo):',
      formatViolations(violations),
    ].join('\n');
    expect(violations, report).toHaveLength(0);
  });
});
