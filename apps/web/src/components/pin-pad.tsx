import { cn } from 'cn';
import { Check, Delete } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

export const PIN_LENGTH = 6;

/** Posiciones de los 6 puntos (valores fijos para no usar el índice como key). */
const DOTS = [1, 2, 3, 4, 5, 6] as const;

/** Teclado de la maqueta: 3 columnas x 4 filas, con borrar y confirmar en la última fila. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'delete', '0', 'submit'] as const;
type Key = (typeof KEYS)[number];

export type PinPadProps = {
  /** Dígitos tecleados hasta ahora (controlado por el padre). */
  value: string;
  onChange: (value: string) => void;
  /** Se llama solo al llegar a 6 dígitos (o con ✓ / Intro con 6 dígitos). */
  onSubmit: (value: string) => void;
  disabled?: boolean;
  /** Texto de error ya traducido; se anuncia con role="alert". */
  error?: string | null;
  /** Texto sobre los puntos (por defecto "PIN de 6 dígitos"). */
  label?: string;
  /** Teclado físico (dígitos, Retroceso, Intro) mientras el componente está montado. */
  keyboard?: boolean;
};

/**
 * Teclado de PIN de la maqueta ("¿Quién cobra?"): 6 puntos de 14 px que se rellenan y 12 teclas de 60 px.
 * Componente puro: el valor vive en el padre; con 6 dígitos se envía solo. Lo usan el diálogo de la caja
 * (PinDialog) y la tarjeta de Ajustes para establecer el PIN (PinCard).
 */
export function PinPad({
  value,
  onChange,
  onSubmit,
  disabled = false,
  error = null,
  label,
  keyboard = true,
}: PinPadProps) {
  const { t } = useTranslation();
  const padRef = useRef<HTMLDivElement>(null);

  const push = (digit: string) => {
    if (disabled || value.length >= PIN_LENGTH) return;
    const next = value + digit;
    onChange(next);
    if (next.length === PIN_LENGTH) onSubmit(next);
  };

  const pop = () => {
    if (disabled || value.length === 0) return;
    onChange(value.slice(0, -1));
  };

  const submit = () => {
    if (disabled || value.length !== PIN_LENGTH) return;
    onSubmit(value);
  };

  useEffect(() => {
    if (!keyboard || disabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      // Lo que se escribe en un campo de texto no es para el PIN.
      if (target && (target.closest('input, textarea, select') || target.isContentEditable)) return;
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        push(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        pop();
      } else if (event.key === 'Enter') {
        // Intro sobre una tecla del propio teclado ya la pulsa como botón: no se duplica.
        if (target && padRef.current?.contains(target)) return;
        event.preventDefault();
        submit();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  const renderKey = (key: Key) => {
    if (key === 'delete') {
      return (
        <Button
          key={key}
          type="button"
          variant="outline"
          size="lg"
          className="size-15 rounded-xl"
          aria-label={t('pin.delete')}
          data-testid="pin-key-delete"
          disabled={disabled || value.length === 0}
          onClick={pop}
        >
          <Delete className="size-6" />
        </Button>
      );
    }
    if (key === 'submit') {
      return (
        <Button
          key={key}
          type="button"
          size="lg"
          className="size-15 rounded-xl"
          aria-label={t('pin.confirm')}
          data-testid="pin-key-submit"
          disabled={disabled || value.length !== PIN_LENGTH}
          onClick={submit}
        >
          <Check className="size-6" />
        </Button>
      );
    }
    return (
      <Button
        key={key}
        type="button"
        variant="outline"
        size="lg"
        className="size-15 rounded-xl font-display text-2xl font-semibold"
        data-testid={`pin-key-${key}`}
        disabled={disabled}
        onClick={() => push(key)}
      >
        {key}
      </Button>
    );
  };

  return (
    <div ref={padRef} data-testid="pin-pad" className="flex flex-col items-center gap-4">
      <p className="text-sm text-muted-foreground">{label ?? t('pin.sixDigits')}</p>
      <div data-testid="pin-dots" aria-hidden="true" className="flex items-center gap-3">
        {DOTS.map((slot) => (
          <span
            key={slot}
            data-filled={slot <= value.length}
            className={cn(
              'size-3.5 rounded-full border-2 border-foreground/50 transition-colors',
              slot <= value.length && 'border-foreground bg-foreground',
            )}
          />
        ))}
      </div>
      <p role="status" className="sr-only">
        {t('pin.entered', { digits: value.length, total: PIN_LENGTH })}
      </p>
      <fieldset aria-label={t('pin.keypad')} className="grid min-w-0 grid-cols-3 gap-2">
        {KEYS.map(renderKey)}
      </fieldset>
      {error ? (
        <p
          role="alert"
          data-testid="pin-error"
          className="text-center font-medium text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
