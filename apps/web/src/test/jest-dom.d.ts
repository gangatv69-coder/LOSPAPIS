import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// Vitest 5 cambió `Assertion<T>` por `Assertion<R, T>`. La augmentación que trae jest-dom 7.0.1
// sigue usando `Assertion<T>`, así que TypeScript la descarta (issue testing-library/jest-dom#738).
// Cuando jest-dom publique la versión con el PR #742: borrar este archivo e importar
// '@testing-library/jest-dom/vitest' en setup.ts.
declare module 'vitest' {
  interface Assertion<R, T> extends TestingLibraryMatchers<never, R> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
