import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

// Registra los matchers de jest-dom (toBeInTheDocument, toHaveTextContent, ...).
// Los tipos se declaran en ./jest-dom.d.ts (los de jest-dom 7.0.1 no encajan con Vitest 5).
expect.extend(matchers);

if (typeof window !== 'undefined') {
  // jsdom no implementa matchMedia y ThemeProvider lo consulta para seguir al sistema.
  // El stub responde "no coincide" a todo: la app arranca en claro, igual que Playwright por defecto.
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
  // jsdom tampoco implementa scrollTo (solo avisa por consola); TanStack Router lo llama al navegar.
  window.scrollTo = () => {};
}

// Sin `globals: true`, Testing Library no limpia el DOM entre tests por sí sola.
afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});
