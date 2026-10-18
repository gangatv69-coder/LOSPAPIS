import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { THEME_STORAGE_KEY, ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import i18n from '@/i18n';

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('ThemeToggle', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    await i18n.changeLanguage('es');
  });

  it('sigue al sistema (claro) y pasa a oscuro al pulsar, recordando la elección', async () => {
    const user = userEvent.setup();
    renderToggle();

    const button = screen.getByRole('button', { name: 'Pasar a modo oscuro' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(document.documentElement).not.toHaveClass('dark');

    await user.click(button);

    expect(document.documentElement).toHaveClass('dark');
    expect(button).toHaveAccessibleName('Pasar a modo claro');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('arranca con el tema guardado y vuelve a claro al pulsar', async () => {
    const user = userEvent.setup();
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderToggle();

    expect(document.documentElement).toHaveClass('dark');

    await user.click(screen.getByRole('button', { name: 'Pasar a modo claro' }));

    expect(document.documentElement).not.toHaveClass('dark');
    expect(screen.getByRole('button', { name: 'Pasar a modo oscuro' })).toBeInTheDocument();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
});
