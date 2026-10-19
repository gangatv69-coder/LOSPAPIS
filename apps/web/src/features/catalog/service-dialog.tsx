import {
  SERVICE_MAX_MINUTES,
  SERVICE_MIN_MINUTES,
  type Service,
  type ServiceInput,
  type ServiceUpdate,
  serviceInputSchema,
} from '@los-papis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { createService, updateService } from '@/features/catalog/catalog.api';
import { invalidateCatalog, servicesQueryOptions } from '@/features/catalog/catalog.queries';
import { catalogErrorMessage } from '@/features/catalog/catalog-errors';
import { PriceInput } from '@/features/catalog/price-input';

/** Qué pasó al guardar: con "unchanged" el diálogo se cierra sin llamar a la API. */
export type SaveAction = 'created' | 'updated' | 'unchanged';

/** Campos distintos del servicio guardado (el PATCH exige al menos uno); null si nada cambió. */
export function serviceChanges(current: Service, input: ServiceInput): ServiceUpdate | null {
  const changes: ServiceUpdate = {};
  if (input.nameEs !== current.nameEs) changes.nameEs = input.nameEs;
  if (input.nameIt !== current.nameIt) changes.nameIt = input.nameIt;
  if (input.priceCents !== current.priceCents) changes.priceCents = input.priceCents;
  if (input.durationMinutes !== current.durationMinutes) {
    changes.durationMinutes = input.durationMinutes;
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

function fieldMessage(field: PropertyKey | undefined, t: TFunction): string {
  switch (field) {
    case 'nameEs':
      return t('services.errors.nameEs');
    case 'nameIt':
      return t('services.errors.nameIt');
    case 'priceCents':
      return t('price.required');
    case 'durationMinutes':
      return t('services.errors.duration', { min: SERVICE_MIN_MINUTES, max: SERVICE_MAX_MINUTES });
    default:
      return t('catalog.errors.validation');
  }
}

type ServiceFormProps = {
  service: Service | null;
  onCancel: () => void;
  onSaved: (service: Service, action: SaveAction) => void;
};

/** El formulario vive solo mientras el diálogo está abierto: cada apertura empieza con los datos del servicio. */
function ServiceForm({ service, onCancel, onSaved }: ServiceFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [nameEs, setNameEs] = useState(service?.nameEs ?? '');
  const [nameIt, setNameIt] = useState(service?.nameIt ?? '');
  const [priceCents, setPriceCents] = useState<number | null>(service?.priceCents ?? null);
  const [duration, setDuration] = useState(String(service?.durationMinutes ?? 30));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (input: ServiceInput): Promise<{ saved: Service; action: SaveAction }> => {
      if (!service) return { saved: await createService(input), action: 'created' };
      const changes = serviceChanges(service, input);
      if (!changes) return { saved: service, action: 'unchanged' };
      return { saved: await updateService(service.id, changes), action: 'updated' };
    },
    onSuccess: async ({ action }) => {
      if (action !== 'unchanged')
        await invalidateCatalog(queryClient, servicesQueryOptions.queryKey);
    },
  });
  const busy = save.isPending;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = serviceInputSchema.safeParse({
      nameEs,
      nameIt,
      priceCents,
      durationMinutes: Number(duration),
    });
    if (!parsed.success) {
      setError(fieldMessage(parsed.error.issues[0]?.path[0], t));
      return;
    }
    setError(null);
    try {
      const result = await save.mutateAsync(parsed.data);
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
      <div className="space-y-2">
        <Label htmlFor="service-name-es">{t('services.nameEs')}</Label>
        <Input
          id="service-name-es"
          name="nameEs"
          data-testid="service-name-es"
          autoComplete="off"
          maxLength={60}
          value={nameEs}
          onChange={(event) => setNameEs(event.target.value)}
          disabled={busy}
          className="h-12"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="service-name-it">{t('services.nameIt')}</Label>
        <Input
          id="service-name-it"
          name="nameIt"
          data-testid="service-name-it"
          autoComplete="off"
          maxLength={60}
          value={nameIt}
          onChange={(event) => setNameIt(event.target.value)}
          disabled={busy}
          className="h-12"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="service-price">{t('services.price')}</Label>
          <PriceInput
            id="service-price"
            name="price"
            data-testid="service-price"
            valueCents={priceCents}
            onChange={setPriceCents}
            disabled={busy}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="service-duration">{t('services.duration')}</Label>
          <Input
            id="service-duration"
            name="durationMinutes"
            data-testid="service-duration"
            type="number"
            inputMode="numeric"
            min={SERVICE_MIN_MINUTES}
            max={SERVICE_MAX_MINUTES}
            step={5}
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            disabled={busy}
            className="h-12 tabular-nums"
          />
        </div>
      </div>
      {error ? (
        <p role="alert" data-testid="service-error" className="font-medium text-destructive">
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
          disabled={busy}
          data-testid="service-submit"
        >
          {service ? t('catalog.save') : t('catalog.create')}
        </Button>
      </DialogFooter>
    </form>
  );
}

export type ServiceDialogProps = {
  /** null: cerrado; 'new': alta; un servicio: edición. */
  target: 'new' | Service | null;
  onClose: () => void;
  onSaved: (service: Service, action: SaveAction) => void;
};

/** Alta y edición de un servicio: nombre en los dos idiomas, precio y duración. */
export function ServiceDialog({ target, onClose, onSaved }: ServiceDialogProps) {
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
      <DialogContent data-testid="service-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold tracking-wide">
            {editing
              ? t('services.editTitle', { name: editing.nameEs })
              : t('services.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('services.formHint')}</DialogDescription>
        </DialogHeader>
        {open ? <ServiceForm service={editing} onCancel={onClose} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  );
}
