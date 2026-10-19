import fc from 'fast-check';

// 200 casos por propiedad (100 por defecto): tarda décimas de segundo y encuentra más esquinas.
// configureGlobal REEMPLAZA toda la configuración global: no llamarlo en los tests.
fc.configureGlobal({ numRuns: 200 });
