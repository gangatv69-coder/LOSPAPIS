import { BRAND_NAME } from '@los-papis/shared';
import { cn } from 'cn';

/** Marca escrita mientras no hay logo (Barlow Condensed 700, letter-spacing 0.08em). */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-display text-3xl font-bold uppercase tracking-[0.08em]', className)}>
      {BRAND_NAME}
    </span>
  );
}
