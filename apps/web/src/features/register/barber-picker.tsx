import type { Barber } from '@los-papis/shared';
import { cn } from 'cn';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BarberAvatar } from '@/features/catalog/barber-avatar';

export type BarberPickerProps = {
  barbers: readonly Barber[];
  selectedId: string | null;
  onSelect: (barberId: string) => void;
  disabled?: boolean;
};

/**
 * "BARBERO" de la maqueta: chips grandes con el avatar y el nombre; el elegido lleva el anillo amarillo y
 * el check. Un cobro es de un solo barbero (todas sus líneas).
 */
export function BarberPicker({
  barbers,
  selectedId,
  onSelect,
  disabled = false,
}: BarberPickerProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {t('register.barber')}
      </p>
      {barbers.length === 0 ? (
        <p className="text-muted-foreground">{t('register.noBarbers')}</p>
      ) : (
        <fieldset aria-label={t('register.barber')} className="flex flex-wrap gap-3">
          {barbers.map((barber) => {
            const selected = barber.id === selectedId;
            return (
              <button
                key={barber.id}
                type="button"
                aria-pressed={selected}
                data-testid="catalog-barber"
                data-code={barber.shortCode}
                disabled={disabled}
                onClick={() => onSelect(barber.id)}
                className={cn(
                  'flex h-16 min-w-48 items-center gap-3 rounded-xl border-2 bg-card pr-4 pl-3 text-left transition-colors outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
                  selected ? 'border-brand-yellow' : 'border-border hover:bg-muted',
                )}
              >
                <BarberAvatar barber={barber} size="md" />
                <span className="min-w-0 flex-1 truncate font-medium">{barber.displayName}</span>
                {selected ? (
                  <Check aria-hidden="true" className="size-5 shrink-0 text-brand-yellow" />
                ) : null}
              </button>
            );
          })}
        </fieldset>
      )}
    </div>
  );
}
