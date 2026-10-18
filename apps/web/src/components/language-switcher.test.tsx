import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { LanguageSwitcher } from '@/components/language-switcher';
import i18n, { languageStorageKey } from '@/i18n';

describe('LanguageSwitcher', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('es');
  });

  it('ofrece español e italiano con el idioma activo seleccionado', () => {
    render(<LanguageSwitcher />);

    const select = screen.getByRole('combobox', { name: 'Idioma' });
    expect(select).toHaveValue('es');
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Español', 'Italiano']);
  });

  it('al elegir italiano cambia el idioma, <html lang> y lo guarda en localStorage', async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Idioma' }), 'it');

    expect(i18n.resolvedLanguage).toBe('it');
    expect(document.documentElement.lang).toBe('it');
    expect(localStorage.getItem(languageStorageKey)).toBe('it');
    expect(screen.getByRole('combobox', { name: 'Lingua' })).toHaveValue('it');
  });
});
