import 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    db: { ownerUrl: string; appUrl: string; migrationsApplied: number };
  }
}
