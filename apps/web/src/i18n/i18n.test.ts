import { beforeEach, describe, expect, it } from 'vitest';

import i18n, { isSupportedLanguage, languageStorageKey } from './index';

describe('inicialización de i18next', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('arranca en español (fallback) y deja <html lang> puesto', async () => {
    await i18n.changeLanguage('es');
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.resolvedLanguage).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(i18n.t('nav.register')).toBe('Caja');
  });

  it('al cambiar a italiano actualiza <html lang> y guarda la elección', async () => {
    await i18n.changeLanguage('it');
    expect(i18n.resolvedLanguage).toBe('it');
    expect(document.documentElement.lang).toBe('it');
    expect(localStorage.getItem(languageStorageKey)).toBe('it');
    expect(i18n.t('nav.register')).toBe('Cassa');
  });

  it('un código regional (it-IT) se resuelve al idioma soportado (it)', async () => {
    await i18n.changeLanguage('it-IT');
    expect(i18n.resolvedLanguage).toBe('it');
    expect(document.documentElement.lang).toBe('it');
    expect(localStorage.getItem(languageStorageKey)).toBe('it');
  });

  it('un idioma no soportado cae al fallback', async () => {
    await i18n.changeLanguage('de');
    expect(i18n.resolvedLanguage).toBe('es');
  });

  it('vuelve a detectar desde localStorage cuando se llama sin argumento', async () => {
    localStorage.setItem(languageStorageKey, 'it');
    await i18n.changeLanguage();
    expect(i18n.resolvedLanguage).toBe('it');
  });

  it('distingue los idiomas soportados de los demás', () => {
    expect(isSupportedLanguage('es')).toBe(true);
    expect(isSupportedLanguage('it')).toBe(true);
    expect(isSupportedLanguage('it-IT')).toBe(false);
    expect(isSupportedLanguage('de')).toBe(false);
  });
});
