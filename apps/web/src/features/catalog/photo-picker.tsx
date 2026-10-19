import { photoUrl } from '@los-papis/shared';
import { CameraIcon, ImageIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { uploadPhoto } from '@/features/catalog/catalog.api';
import { catalogErrorMessage } from '@/features/catalog/catalog-errors';
import { ImageDecodeError, resizeImage } from '@/features/catalog/image-resize';

export type PhotoPickerProps = {
  /** Foto guardada (id de /api/photos) o null. */
  photoId: string | null;
  /** Se llama con el id de la foto recién subida, o con null al quitarla. */
  onChange: (photoId: string | null) => void;
  disabled?: boolean;
  /** Prefijo de los id de los elementos (varios selectores en la misma página). */
  idPrefix?: string;
};

/**
 * Miniatura + "Hacer foto / Elegir imagen" (en el iPad abre la cámara; en el PC, el selector de archivos).
 * Al elegir: se reduce en el dispositivo (image-resize.ts), se sube a POST /api/photos y se entrega el id.
 * La vista previa es el propio JPEG reducido, sin esperar a la API.
 */
export function PhotoPicker({
  photoId,
  onChange,
  disabled = false,
  idPrefix = 'photo',
}: PhotoPickerProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El objeto URL de la vista previa se libera al sustituirla o al desmontar.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await resizeImage(file);
      const photo = await uploadPhoto(blob);
      setPreview(URL.createObjectURL(blob));
      onChange(photo.id);
    } catch (caught) {
      setError(
        caught instanceof ImageDecodeError
          ? t('photo.errors.unreadable')
          : catalogErrorMessage(caught, t),
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function remove() {
    setPreview(null);
    setError(null);
    onChange(null);
  }

  const src = preview ?? (photoId ? photoUrl(photoId) : null);
  const inputId = `${idPrefix}-file`;

  return (
    <div data-testid="photo-picker" className="flex flex-wrap items-start gap-4">
      <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
        {src ? (
          <img
            src={src}
            alt={t('photo.previewAlt')}
            data-testid="photo-preview"
            className="size-full object-cover"
          />
        ) : (
          <ImageIcon aria-hidden="true" className="size-8 text-muted-foreground" />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <input
          ref={inputRef}
          id={inputId}
          name="photo"
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          data-testid="photo-file"
          onChange={(event) => {
            void handleFiles(event.target.files);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-12 px-4"
            disabled={disabled || busy}
            data-testid="photo-pick"
            onClick={() => inputRef.current?.click()}
          >
            <CameraIcon className="size-4" />
            {src ? t('photo.change') : t('photo.pick')}
          </Button>
          {src ? (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="h-12 px-4"
              disabled={disabled || busy}
              data-testid="photo-remove"
              onClick={remove}
            >
              <Trash2Icon className="size-4" />
              {t('photo.remove')}
            </Button>
          ) : null}
        </div>
        {busy ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('photo.uploading')}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            data-testid="photo-error"
            className="text-sm font-medium text-destructive"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
