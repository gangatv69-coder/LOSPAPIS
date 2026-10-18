import { cn } from 'cn';

/** Franja tricolor de marca en proporción 2:1:1 (amarillo, azul, rojo), 4 px. Decorativa. */
export function TricolorStripe({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-testid="tricolor-stripe"
      className={cn('grid h-1 w-full grid-cols-[2fr_1fr_1fr]', className)}
    >
      <div className="bg-brand-yellow" />
      <div className="bg-brand-blue" />
      <div className="bg-brand-red" />
    </div>
  );
}
