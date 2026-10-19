import { type Barber, type BarberColor, photoUrl } from '@los-papis/shared';
import { cn } from 'cn';

/** Color de la paleta -> fondo y texto. Los tres primeros son los de la marca (globals.css). */
export const BARBER_COLOR_CLASSES: Record<BarberColor, string> = {
  yellow: 'bg-brand-yellow text-brand-yellow-foreground',
  blue: 'bg-brand-blue text-brand-blue-foreground',
  red: 'bg-brand-red text-brand-red-foreground',
  green: 'bg-green-500 text-white',
  purple: 'bg-purple-500 text-white',
  orange: 'bg-orange-500 text-white',
  teal: 'bg-teal-500 text-white',
  pink: 'bg-pink-500 text-white',
};

const SIZE_CLASSES = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-lg',
} as const;

export type BarberAvatarProps = {
  barber: Pick<Barber, 'displayName' | 'shortCode' | 'color' | 'photoId'>;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
};

/**
 * Círculo del barbero como en la maqueta: su foto o, si no tiene, el código corto ("B1") sobre su color.
 * El nombre va siempre al lado en quien lo usa; la foto lleva el nombre como texto alternativo.
 */
export function BarberAvatar({ barber, size = 'md', className }: BarberAvatarProps) {
  return (
    <span
      data-testid="barber-avatar"
      data-color={barber.color}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-display font-bold tracking-wide',
        SIZE_CLASSES[size],
        BARBER_COLOR_CLASSES[barber.color],
        className,
      )}
    >
      {barber.photoId ? (
        <img
          src={photoUrl(barber.photoId)}
          alt={barber.displayName}
          className="size-full object-cover"
        />
      ) : (
        <span aria-hidden="true">{barber.shortCode}</span>
      )}
    </span>
  );
}
