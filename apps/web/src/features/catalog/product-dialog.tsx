import {
  type Product,
  type ProductInput,
  type ProductUpdate,
  productInputSchema,
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
import { createProduct, updateProduct } from '@/features/catalog/catalog.api';
import { invalidateCatalog, productsQueryOptions } from '@/features/catalog/catalog.queries';
import { catalogErrorMessage } from '@/features/catalog/catalog-errors';
import { PhotoPicker } from '@/features/catalog/photo-picker';
import { PriceInput } from '@/features/catalog/price-input';
import type { SaveAction } from '@/features/catalog/service-dialog';

/** Campos distintos del producto guardado (el PATCH exige al menos uno); null si nada cambió. */
export function productChanges(current: Product, input: ProductInput): ProductUpdate | null {
  const changes: ProductUpdate = {};
  if (input.name !== current.name) changes.name = input.name;
  if (input.priceCents !== current.priceCents) changes.priceCents = input.priceCents;
  if ((input.photoId ?? null) !== current.photoId) changes.photoId = input.photoId ?? null;
  return Object.keys(changes).length > 0 ? changes : null;
}

function fieldMessage(field: PropertyKey | undefined, t: TFunction): string {
  switch (field) {
    case 'name':
      return t('products.errors.name');
    case 'priceCents':
      return t('price.required');
    default:
      return t('catalog.errors.validation');
  }
}

type ProductFormProps = {
  product: Product | null;
  onCancel: () => void;
  onSaved: (product: Product, action: SaveAction) => void;
};

function ProductForm({ product, onCancel, onSaved }: ProductFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(product?.name ?? '');
  const [priceCents, setPriceCents] = useState<number | null>(product?.priceCents ?? null);
  const [photoId, setPhotoId] = useState<string | null>(product?.photoId ?? null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (input: ProductInput): Promise<{ saved: Product; action: SaveAction }> => {
      if (!product) return { saved: await createProduct(input), action: 'created' };
      const changes = productChanges(product, input);
      if (!changes) return { saved: product, action: 'unchanged' };
      return { saved: await updateProduct(product.id, changes), action: 'updated' };
    },
    onSuccess: async ({ action }) => {
      if (action !== 'unchanged')
        await invalidateCatalog(queryClient, productsQueryOptions.queryKey);
    },
  });
  const busy = save.isPending;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = productInputSchema.safeParse({ name, priceCents, photoId });
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
        <Label htmlFor="product-name">{t('products.name')}</Label>
        <Input
          id="product-name"
          name="name"
          data-testid="product-name"
          autoComplete="off"
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
          className="h-12"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="product-price">{t('products.price')}</Label>
        <PriceInput
          id="product-price"
          name="price"
          data-testid="product-price"
          valueCents={priceCents}
          onChange={setPriceCents}
          disabled={busy}
          className="max-w-48"
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('products.photo')}</p>
        <PhotoPicker
          photoId={photoId}
          onChange={setPhotoId}
          disabled={busy}
          idPrefix="product-photo"
        />
      </div>
      {error ? (
        <p role="alert" data-testid="product-error" className="font-medium text-destructive">
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
          data-testid="product-submit"
        >
          {product ? t('catalog.save') : t('catalog.create')}
        </Button>
      </DialogFooter>
    </form>
  );
}

export type ProductDialogProps = {
  /** null: cerrado; 'new': alta; un producto: edición. */
  target: 'new' | Product | null;
  onClose: () => void;
  onSaved: (product: Product, action: SaveAction) => void;
};

/** Alta y edición de un producto: nombre, precio y foto (reducida en el dispositivo). */
export function ProductDialog({ target, onClose, onSaved }: ProductDialogProps) {
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
      <DialogContent data-testid="product-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold tracking-wide">
            {editing ? t('products.editTitle', { name: editing.name }) : t('products.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('products.formHint')}</DialogDescription>
        </DialogHeader>
        {open ? <ProductForm product={editing} onCancel={onClose} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  );
}
