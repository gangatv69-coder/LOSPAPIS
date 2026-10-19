import type { Locator } from '@playwright/test';

/** Teclea un PIN en el diálogo "¿Quién cobra?" pulsando las teclas de la maqueta. */
export async function typePin(dialog: Locator, pin: string): Promise<void> {
  for (const digit of pin) {
    await dialog.getByRole('button', { name: digit, exact: true }).click();
  }
}
