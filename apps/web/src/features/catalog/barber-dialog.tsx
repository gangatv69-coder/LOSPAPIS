import {
  BARBER_COLORS,
  type Barber,
  type BarberColor,
  type BarberInput,
  type BarberUpdate,
  barberInputSchema,
  initialsOf,
  type UserSummary,
} from '@los-papis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import type { TFunction } from 'i18next';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BARBER_COLOR_CLASSES } from '@/features/catalog/barber-avatar';
import { createBarber, updateBarber } from '@/features/catalog/catalog.api';
import {
  barberCandidatesQueryOptions,
  barbersQueryOptions,
  invalidateCatalog,
} from '@/features/catalog/catalog.queries';
import { catalogErrorMessage } from '@/features/catalog/catalog-errors';
import { PhotoPicker } from '@/features/catalog/photo-picker';
import type { SaveAction } from '@/features/catalog/service-dialog';

/** Lo que se edita de un perfil ya creado (el usuario no cambia: una persona = un perfil). */
export type BarberFields = Omit<BarberInput, 'userId'>;

const barberFieldsSchema = barberInputSchema.omit({ userId: true });

/** Campos distintos del perfil guardado (el PATCH exige al menos uno); null si nada cambió. */
export function barberChanges(current: Barber, input: BarberFields): BarberUpdate | null {
  const changes: BarberUpdate = {};
  if (input.displayName !== current.displayName) changes.displayName = input.displayName;
  if (input.shortCode !== current.shortCode) changes.shortCode = input.shortCode;
  if (input.color !== current.color) changes.color = input.color;
  if ((input.photoId ?? null) !== current.photoId) changes.photoId = input.photoId ?? null;
  return Object.keys(changes).length > 0 ? changes : null;
}

function fieldMessage(field: PropertyKey | undefined, t: TFunction): string {
  switch (field) {
    case 'userId':
      return t('team.errors.userRequired');
    case 'displayName':
      return t('team.errors.nameRequired');
    case 'shortCode':
      return t('team.errors.codeInvalid');
    default:
      return t('catalog.errors.validation');
  }
}

const selectClass =
  'h-12 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** Botones redondos de la paleta: uno por color, el elegido con anillo. */
function ColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: BarberColor;
  onChange: (color: BarberColor) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <fieldset aria-label={t('team.color')} className="flex flex-wrap gap-3">
      {BARBER_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-pressed={color === value}
          aria-label={t(`team.colors.${color}`)}
          data-testid={`barber-color-${color}`}
          disabled={disabled}
          onClick={() => onChange(color)}
          className={cn(
            'size-12 rounded-full ring-offset-2 ring-offset-background transition-shadow outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
            BARBER_COLOR_CLASSES[color],
            color === value && 'ring-[3px] ring-foreground',
          )}
        />
      ))}
    </fieldset>
  );
}

type BarberFormProps = {
  barber: Barber | null;
  onCancel: () => void;
  onSaved: (barber: Barber, action: SaveAction) => void;
};

function BarberForm({ barber, onCancel, onSaved }: BarberFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // Solo en el alta: usuarios activos con cuenta y sin perfil todavía.
  const candidates = useQuery({ ...barberCandidatesQueryOptions, enabled: barber === null });
  const [userId, setUserId] = useState(barber?.userId ?? '');
  const [displayName, setDisplayName] = useState(barber?.displayName ?? '');
  const [shortCode, setShortCode] = useState(barber?.shortCode ?? '');
  const [color, setColor] = useState<BarberColor>(barber?.color ?? 'yellow');
  const [photoId, setPhotoId] = useState<string | null>(barber?.photoId ?? null);
  // Mientras no se toquen, el nombre y el código se proponen a partir del usuario elegido.
  const [nameTouched, setNameTouched] = useState(barber !== null);
  const [codeTouched, setCodeTouched] = useState(barber !== null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (input: BarberInput): Promise<{ saved: Barber; action: SaveAction }> => {
      if (!barber) return { saved: await createBarber(input), action: 'created' };
      const changes = barberChanges(barber, input);
      if (!changes) return { saved: barber, action: 'unchanged' };
      return { saved: await updateBarber(barber.id, changes), action: 'updated' };
    },
    onSuccess: async ({ action }) => {
      if (action !== 'unchanged')
        await invalidateCatalog(queryClient, barbersQueryOptions.queryKey);
    },
  });
  const busy = save.isPending;
  const noCandidates =
    barber === null && candidates.data !== undefined && candidates.data.length === 0;

  function chooseCandidate(candidate: UserSummary | undefined) {
    setUserId(candidate?.id ?? '');
    if (!candidate) return;
    if (!nameTouched) setDisplayName(candidate.displayName);
    if (!codeTouched) setShortCode(initialsOf(candidate.displayName));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = { displayName, shortCode, color, photoId };
    const parsed = barber
      ? barberFieldsSchema.safeParse(fields)
      : barberInputSchema.safeParse({ userId, ...fields });
    if (!parsed.success) {
      setError(fieldMessage(parsed.error.issues[0]?.path[0], t));
      return;
    }
    setError(null);
    try {
      const input: BarberInput = { userId: barber?.userId ?? userId, ...parsed.data };
      const result = await save.mutateAsync(input);
      onSaved(result.saved, result.action);
    } catch (caught) {
      setError(catalogErrorMessage(caught, t));
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
      className="space-y-4"
    >
      {barber === null ? (
        <div className="space-y-2">
          <Label htmlFor="barber-user">{t('team.user')}</Label>
          <select
            id="barber-user"
            name="userId"
            data-testid="barber-user"
            value={userId}
            onChange={(event) =>
              chooseCandidate(candidates.data?.find((user) => user.id === event.target.value))
            }
            disabled={busy || candidates.isPending || noCandidates}
            className={selectClass}
          >
            <option value="">{t('team.chooseUser')}</option>
            {(candidates.data ?? []).map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {t('team.candidateOption', {
                  name: candidate.displayName,
                  username: candidate.username,
                })}
              </option>
            ))}
          </select>
          {candidates.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {catalogErrorMessage(candidates.error, t)}
            </p>
          ) : null}
          {noCandidates ? (
            <p
              data-testid="barber-no-candidates"
              className="flex flex-wrap gap-x-2 text-sm text-muted-foreground"
            >
              <span>{t('team.noCandidates')}</span>
              <Link
                to="/ajustes"
                search={{ paso: 'usuarios' }}
                className="font-medium text-brand-blue underline-offset-4 hover:underline dark:text-primary"
              >
                {t('team.goUsers')}
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="barber-name">{t('team.displayName')}</Label>
        <Input
          id="barber-name"
          name="displayName"
          data-testid="barber-name"
          autoComplete="off"
          maxLength={40}
          value={displayName}
          onChange={(event) => {
            setNameTouched(true);
            setDisplayName(event.target.value);
          }}
          disabled={busy}
          className="h-12"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="barber-code">{t('team.shortCode')}</Label>
        <Input
          id="barber-code"
          name="shortCode"
          data-testid="barber-code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={3}
          value={shortCode}
          onChange={(event) => {
            setCodeTouched(true);
            setShortCode(event.target.value.toUpperCase());
          }}
          disabled={busy}
          className="h-12 max-w-32 font-display text-xl tracking-widest uppercase"
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('team.color')}</p>
        <ColorPicker value={color} onChange={setColor} disabled={busy} />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('team.photo')}</p>
        <PhotoPicker
          photoId={photoId}
          onChange={setPhotoId}
          disabled={busy}
          idPrefix="barber-photo"
        />
      </div>
      {error ? (
        <p role="alert" data-testid="barber-error" className="font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-12 px-4"
          disabled={busy}
          onClick={onCancel}
        >
          {t('catalog.cancel')}
        </Button>
        <Button
          type="submit"
          size="lg"
          className="h-12 px-4"
          disabled={busy || noCandidates}
          data-testid="barber-submit"
        >
          {barber ? t('catalog.save') : t('catalog.create')}
        </Button>
      </DialogFooter>
    </form>
  );
}

export type BarberDialogProps = {
  /** null: cerrado; 'new': alta; un barbero: edición. */
  target: 'new' | Barber | null;
  onClose: () => void;
  onSaved: (barber: Barber, action: SaveAction) => void;
};

/** Alta (usuario de la lista de candidatos) y edición del perfil: nombre visible, código, color y foto. */
export function BarberDialog({ target, onClose, onSaved }: BarberDialogProps) {
  const { t } = useTranslation();
  const open = target !== null;
  const editing = target !== null && target !== 'new' ? target : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent data-testid="barber-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold tracking-wide">
            {editing ? t('team.editTitle', { name: editing.displayName }) : t('team.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('team.formHint')}</DialogDescription>
        </DialogHeader>
        {open ? <BarberForm barber={editing} onCancel={onClose} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  );
}
