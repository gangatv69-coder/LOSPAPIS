// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

type Tree = { [key: string]: string | Tree };

const LOCALES_DIR = fileURLToPath(new URL('../../src/locales/', import.meta.url));

const readLocale = (name: string): Tree =>
  JSON.parse(readFileSync(path.join(LOCALES_DIR, name), 'utf8')) as Tree;

/** Aplana {a:{b:"x"}} en Map("a.b" -> "x"). Solo admite objetos y strings. */
function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.set(full, value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of flatten(value, full)) out.set(k, v);
    } else {
      throw new Error(`Valor no admitido en "${full}": solo strings u objetos`);
    }
  }
  return out;
}

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;
const TAG = /<\/?([A-Za-z][\w-]*)[^>]*>/g;

function names(text: string, re: RegExp): string[] {
  return [...text.matchAll(re)].map((m) => m[1] ?? '').sort();
}

const locales = { es: flatten(readLocale('es.json')), it: flatten(readLocale('it.json')) };

describe('es.json e it.json', () => {
  it('tienen exactamente las mismas claves', () => {
    const esKeys = [...locales.es.keys()].sort();
    const itKeys = [...locales.it.keys()].sort();
    const missingInIt = esKeys.filter((k) => !locales.it.has(k));
    const missingInEs = itKeys.filter((k) => !locales.es.has(k));
    expect({ missingInIt, missingInEs }).toEqual({ missingInIt: [], missingInEs: [] });
  });

  it('no tienen cadenas vacías', () => {
    const empty = Object.entries(locales).flatMap(([lng, map]) =>
      [...map].filter(([, v]) => v.trim() === '').map(([k]) => `${lng}:${k}`),
    );
    expect(empty).toEqual([]);
  });

  it("no usan en las claves los separadores reservados ':' ni segmentos vacíos", () => {
    const bad = Object.entries(locales).flatMap(([lng, map]) =>
      [...map.keys()]
        .flatMap((k) => k.split('.'))
        .filter((part) => part === '' || part.includes(':'))
        .map((part) => `${lng}:${JSON.stringify(part)}`),
    );
    expect(bad).toEqual([]);
  });

  it('usan los mismos {{valores}} y <etiquetas> en cada clave', () => {
    const diffs: string[] = [];
    for (const [key, esText] of locales.es) {
      const itText = locales.it.get(key);
      if (itText === undefined) continue; // ya lo reporta la prueba de claves
      const esVars = names(esText, PLACEHOLDER);
      const itVars = names(itText, PLACEHOLDER);
      if (esVars.join() !== itVars.join()) diffs.push(`${key}: {{ }} es=${esVars} it=${itVars}`);
      const esTags = names(esText, TAG);
      const itTags = names(itText, TAG);
      if (esTags.join() !== itTags.join()) diffs.push(`${key}: <> es=${esTags} it=${itTags}`);
    }
    expect(diffs).toEqual([]);
  });
});
