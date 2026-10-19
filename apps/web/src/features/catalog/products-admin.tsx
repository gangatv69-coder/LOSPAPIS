import { formatCents, type Product, photoUrl } from '@los-papis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { setProductActive } from '@/features/catalog/catalog.api';
import { invalidateCatalog, productsQueryOptions } from '@/features/catalog/catalog.queries';
import { catalogErrorMessage } from '@/features/catalog/catalog-errors';
import { DeactivateDialog } from '@/features/catalog/deactivate-dialog';
import { ProductDialog } from '@/features/catalog/product-dialog';

const buttonClass = 'h-12 px-3';

/** Miniatura de 48 px de la foto del producto o un marcador si no tiene. */
function ProductThumb({ product }: { product: Product }) {
  const { t } = useTranslation();
  if (!product.photoId) {
    return (
      <span
        title={t('products.noPhoto')}
        className="flex size-12 items-center justify-center rounded-md bg-muted text-muted-foreground"
      >
        <ImageIcon aria-hidden="true" className="size-5" />
        <span className="sr-only">{t('products.noPhoto')}</span>
      </span>
    );
  }
  return (
    <img
      src={photoUrl(product.photoId)}
      alt={product.name}
      width={48}
      height={48}
      data-testid="product-photo"
      className="size-12 rounded-md object-cover"
    />
  );
}

/**
 * Productos a la venta (solo managers): tabla con foto, nombre, precio y estado; alta y edición con
 * foto hecha desde el iPad o elegida en el PC; desactivar (confirmado) y reactivar. Nunca se borra nada.
 */
export function ProductsAdmin() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const products = useQuery(productsQueryOptions);
  const [target, setTarget] = useState<'new' | Product | null>(null);
  const [toDeactivate, setToDeactivate] = useState<Product | null>(null);

  const toggle = useMutation({
    mutationFn: ({ product, active }: { product: Product; active: boolean }) =>
      setProductActive(product.id, active),
    onSuccess: async (_saved, { active }) => {
      toast.success(t(active ? 'products.reactivated' : 'products.deactivated'));
      setToDeactivate(null);
      await invalidateCatalog(queryClient, productsQueryOptions.queryKey);
    },
    onError: (caught) => {
      toast.error(catalogErrorMessage(caught, t));
    },
  });
  const busyId = toggle.isPending ? (toggle.variables?.product.id ?? null) : null;

  return (
    <Card data-testid="products-admin" className="max-w-6xl">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-semibold tracking-wide">
          {t('products.title')}
        </CardTitle>
        <CardDescription>{t('products.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          type="button"
          size="lg"
          className="h-12 px-4"
          data-testid="product-create"
          onClick={() => setTarget('new')}
        >
          <PlusIcon className="size-4" />
          {t('products.create')}
        </Button>
        {products.isPending ? (
          <p role="status" className="text-muted-foreground">
            {t('catalog.loading')}
          </p>
        ) : null}
        {products.isError ? (
          <p role="alert" className="text-destructive">
            {catalogErrorMessage(products.error, t)}
          </p>
        ) : null}
        {products.data && products.data.length === 0 ? (
          <p className="text-muted-foreground">{t('products.empty')}</p>
        ) : null}
        {products.data && products.data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <span className="sr-only">{t('products.columns.photo')}</span>
                </TableHead>
                <TableHead>{t('products.columns.name')}</TableHead>
                <TableHead className="text-right">{t('products.columns.price')}</TableHead>
                <TableHead>{t('products.columns.status')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('products.columns.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.data.map((product) => {
                const busy = busyId === product.id;
                return (
                  <TableRow
                    key={product.id}
                    data-testid="product-row"
                    data-name={product.name}
                    data-active={product.active}
                    className={product.active ? undefined : 'text-muted-foreground'}
                  >
                    <TableCell className="w-16">
                      <ProductThumb product={product} />
                    </TableCell>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell
                      data-testid="product-price-cell"
                      className="text-right font-display text-lg font-semibold tabular-nums"
                    >
                      {formatCents(product.priceCents)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={product.active ? 'secondary' : 'destructive'}
                        data-testid="product-status"
                      >
                        {product.active ? t('catalog.active') : t('catalog.inactive')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="lg"
                          className={buttonClass}
                          disabled={busy}
                          data-testid="product-edit"
                          onClick={() => setTarget(product)}
                        >
                          {t('products.edit')}
                        </Button>
                        {product.active ? (
                          <Button
                            type="button"
                            variant="destructive"
                            size="lg"
                            className={buttonClass}
                            disabled={busy}
                            data-testid="product-deactivate"
                            onClick={() => setToDeactivate(product)}
                          >
                            {t('products.deactivate')}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="lg"
                            className={buttonClass}
                            disabled={busy}
                            data-testid="product-reactivate"
                            onClick={() => toggle.mutate({ product, active: true })}
                          >
                            {t('products.reactivate')}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
      <ProductDialog
        target={target}
        onClose={() => setTarget(null)}
        onSaved={(_saved, action) => {
          setTarget(null);
          if (action === 'created') toast.success(t('products.created'));
          if (action === 'updated') toast.success(t('products.updated'));
        }}
      />
      <DeactivateDialog
        name={toDeactivate?.name ?? null}
        title={t('products.deactivateTitle', { name: toDeactivate?.name ?? '' })}
        hint={t('products.deactivateHint')}
        confirmLabel={t('products.deactivateConfirm')}
        busy={toggle.isPending}
        testId="product-deactivate-dialog"
        onConfirm={() => {
          if (toDeactivate) toggle.mutate({ product: toDeactivate, active: false });
        }}
        onCancel={() => setToDeactivate(null)}
      />
    </Card>
  );
}
