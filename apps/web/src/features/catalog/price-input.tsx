import {
  formatCents,
  MAX_PRICE_CENTS,
  MoneyParseError,
  type MoneyParseErrorCode,
  parseCents,
} from '@los-papis/shared';
import { cn } from 'cn';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';

export type PriceErrorCode = MoneyParseErrorCode | 'too_high';

export type ParsedPrice = { ok: true; cents: number } | { ok: false; code: PriceErrorCode };

/** "15" | "15,5" | "15.50" | "1.234,50" -> céntimos (parseCents) con el tope del catálogo. */
export function parsePrice(value: string): ParsedPrice {
  try {
    const cents = parseCents(value);
    return cents > MAX_PRICE_CENTS ? { ok: false, code: 'too_high' } : { ok: true, cents };
  } catch (caught) {
    if (caught instanceof MoneyParseError) return { ok: false, code: caught.code };
    throw caught;
  }
}

/** Vacío no es un error de formato: si el precio es obligatorio lo dice el formulario. */
function messageFor(code: PriceErrorCode, t: TFunction): string | null {
  switch (code) {
    case 'empty':
      return null;
    case 'negative_not_allowed':
      return t('price.negative');
    case 'out_of_range':
    case 'too_high':
      return t('price.tooHigh', { max: formatCents(MAX_PRICE_CENTS) });
    default:
      return t('price.invalid');
  }
}

const toText = (cents: number | null): string =>
  cents === null ? '' : formatCents(cents, { withSymbol: false });

export type PriceInputProps = {
  id: string;
  name?: string;
  valueCents: number | null;
  /** Céntimos en cuanto el texto se entiende; null mientras no se entienda (o esté vacío). */
  onChange: (cents: number | null) => void;
  /** Error del formulario (p. ej. "escribe un precio"); mientras exista sustituye al de formato. */
  error?: string | null;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
};

/**
 * Precio en euros como texto (inputMode decimal: el iPad enseña el teclado numérico con coma). Acepta
 * "15", "15,5", "15.50" o "1.234,50"; al salir del campo se normaliza a "15,50" o se explica el error.
 * El valor que viaja a la API son céntimos enteros: nunca coma flotante.
 */
export function PriceInput({
  id,
  name = 'price',
  valueCents,
  onChange,
  error = null,
  disabled = false,
  className,
  'data-testid': testId,
}: PriceInputProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => toText(valueCents));
  const [formatError, setFormatError] = useState<string | null>(null);
  const shownError = error ?? formatError;
  const errorId = `${id}-error`;

  function handleChange(value: string) {
    setText(value);
    setFormatError(null);
    const parsed = parsePrice(value);
    onChange(parsed.ok ? parsed.cents : null);
  }

  function handleBlur() {
    const parsed = parsePrice(text);
    if (parsed.ok) {
      setText(toText(parsed.cents));
      setFormatError(null);
    } else {
      setFormatError(messageFor(parsed.code, t));
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="relative">
        <Input
          id={id}
          name={name}
          data-testid={testId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={handleBlur}
          disabled={disabled}
          aria-invalid={shownError !== null}
          aria-describedby={shownError ? errorId : undefined}
          className="h-12 pr-9 text-right font-display text-xl tabular-nums"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"
        >
          €
        </span>
      </div>
      {shownError ? (
        <p
          id={errorId}
          role="alert"
          data-testid={testId ? `${testId}-error` : undefined}
          className="text-sm font-medium text-destructive"
        >
          {shownError}
        </p>
      ) : null}
    </div>
  );
}
