import {
  createUserRequestSchema,
  type TemporaryPasswordResponse,
  type UserRole,
  type UserSummary,
  userRoleSchema,
} from '@los-papis/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  createUser,
  deactivateUser,
  reactivateUser,
  resetUserPassword,
  unlockPin,
} from '@/features/auth/auth.api';
import { managersQueryOptions, usersQueryOptions } from '@/features/auth/auth.queries';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { useAuth } from '@/features/auth/use-auth';
import { ReauthCancelledError, useReauth } from '@/features/auth/use-reauth';
import { fallbackLanguage } from '@/i18n';
import { isApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';

const ROLES = userRoleSchema.options;

type RowAction = 'users.deactivated' | 'users.reactivated' | 'users.pinUnlocked';

type CreateUserDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: <T>(action: () => Promise<T>) => Promise<T>;
  onCreated: (result: TemporaryPasswordResponse) => void;
};

function CreateUserDialog({ open, onOpenChange, run, onCreated }: CreateUserDialogProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('barber');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setUsername('');
    setDisplayName('');
    setRole('barber');
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createUserRequestSchema.safeParse({ username, displayName, role });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      setError(
        field === 'displayName' ? t('auth.errors.invalidName') : t('auth.errors.invalidUsername'),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await run(() => createUser(parsed.data));
      reset();
      onCreated(result);
    } catch (caught) {
      if (caught instanceof ReauthCancelledError) return;
      if (isApiError(caught, 'username_taken')) setError(t('users.errors.usernameTaken'));
      else if (isApiError(caught, 'validation')) setError(t('auth.errors.invalidUsername'));
      else setError(authErrorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent data-testid="user-create-dialog">
        <DialogHeader>
          <DialogTitle>{t('users.createTitle')}</DialogTitle>
          <DialogDescription>{t('users.createHint')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(event) => {
            void submit(event);
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="user-username">{t('users.username')}</Label>
            <Input
              id="user-username"
              name="username"
              data-testid="user-username"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={busy}
              className="h-12"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-name">{t('users.displayName')}</Label>
            <Input
              id="user-name"
              name="displayName"
              data-testid="user-name"
              autoComplete="off"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={busy}
              className="h-12"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-role">{t('users.roleLabel')}</Label>
            <select
              id="user-role"
              name="role"
              data-testid="user-role"
              value={role}
              onChange={(event) => {
                const parsed = userRoleSchema.safeParse(event.target.value);
                if (parsed.success) setRole(parsed.data);
              }}
              disabled={busy}
              className="h-12 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {ROLES.map((option) => (
                <option key={option} value={option}>
                  {t(`auth.role.${option}`)}
                </option>
              ))}
            </select>
          </div>
          {error ? (
            <p role="alert" data-testid="user-error" className="font-medium text-destructive">
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
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              {t('users.cancel')}
            </Button>
            <Button
              type="submit"
              size="lg"
              className="h-12 px-4"
              disabled={busy}
              data-testid="user-submit"
            >
              {t('users.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** La contraseña temporal recién creada: se enseña UNA vez; al cerrar desaparece. */
function TemporaryPasswordDialog({
  result,
  onClose,
}: {
  result: TemporaryPasswordResponse | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.temporaryPassword);
      toast.success(t('users.copied'));
    } catch {
      toast.error(t('users.copyFailed'));
    }
  }

  return (
    <Dialog
      open={result !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="temporary-password-dialog">
        <DialogHeader>
          <DialogTitle>
            {t('users.temporaryTitle', { name: result?.user.displayName ?? '' })}
          </DialogTitle>
          <DialogDescription>{t('users.temporaryHint')}</DialogDescription>
        </DialogHeader>
        <code
          data-testid="temporary-password"
          className="block rounded-md bg-muted px-3 py-3 text-center font-mono text-2xl tracking-wider select-all"
        >
          {result?.temporaryPassword ?? ''}
        </code>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-12 px-4"
            data-testid="temporary-password-copy"
            onClick={() => {
              void copy();
            }}
          >
            <Copy className="size-4" />
            {t('users.copy')}
          </Button>
          <Button
            type="button"
            size="lg"
            className="h-12 px-4"
            data-testid="temporary-password-close"
            onClick={onClose}
          >
            {t('users.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Usuarios de la barbería (solo managers): tabla, alta con contraseña temporal, restablecer,
 * desactivar/reactivar (nunca borrar) y desbloquear el PIN. Las acciones sensibles pueden pedir
 * reautenticación (la API responde reauth_required y se repite tras el código).
 */
export function UsersAdmin() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? fallbackLanguage;
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const users = useQuery(usersQueryOptions);
  const { run, dialog: reauthDialog } = useReauth();
  const [createOpen, setCreateOpen] = useState(false);
  const [temporary, setTemporary] = useState<TemporaryPasswordResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: usersQueryOptions.queryKey }),
      queryClient.invalidateQueries({ queryKey: managersQueryOptions.queryKey }),
    ]);
  }

  async function act(target: UserSummary, action: () => Promise<void>, done: RowAction) {
    setBusyId(target.id);
    try {
      await run(action);
      toast.success(t(done));
      await refresh();
    } catch (caught) {
      if (caught instanceof ReauthCancelledError) return;
      toast.error(
        isApiError(caught) && caught.status === 409
          ? t('users.errors.self')
          : authErrorMessage(caught, t),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function reset(target: UserSummary) {
    setBusyId(target.id);
    try {
      const result = await run(() => resetUserPassword(target.id));
      toast.success(t('users.resetDone'));
      setTemporary(result);
      await refresh();
    } catch (caught) {
      if (!(caught instanceof ReauthCancelledError)) toast.error(authErrorMessage(caught, t));
    } finally {
      setBusyId(null);
    }
  }

  const buttonClass = 'h-12 px-3';

  return (
    <Card data-testid="users-admin" className="max-w-6xl">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-semibold tracking-wide">
          {t('users.title')}
        </CardTitle>
        <CardDescription>{t('users.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          type="button"
          size="lg"
          className="h-12 px-4"
          data-testid="users-create"
          onClick={() => setCreateOpen(true)}
        >
          <UserPlus className="size-4" />
          {t('users.create')}
        </Button>
        {users.isPending ? (
          <p role="status" className="text-muted-foreground">
            {t('users.loading')}
          </p>
        ) : null}
        {users.isError ? (
          <p role="alert" className="text-destructive">
            {t('auth.errors.generic')}
          </p>
        ) : null}
        {users.data ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('users.columns.username')}</TableHead>
                <TableHead>{t('users.columns.displayName')}</TableHead>
                <TableHead>{t('users.columns.role')}</TableHead>
                <TableHead>{t('users.columns.status')}</TableHead>
                <TableHead>{t('users.columns.totp')}</TableHead>
                <TableHead>{t('users.columns.pin')}</TableHead>
                <TableHead>{t('users.columns.lastLogin')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('users.columns.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.map((entry) => {
                const isMe = entry.id === me?.id;
                const busy = busyId === entry.id;
                return (
                  <TableRow key={entry.id} data-testid="user-row" data-username={entry.username}>
                    <TableCell className="font-medium">
                      {entry.username}
                      {isMe ? (
                        <span className="ml-1 text-muted-foreground">{t('users.you')}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>{entry.displayName}</TableCell>
                    <TableCell>{t(`auth.role.${entry.role}`)}</TableCell>
                    <TableCell>
                      <Badge variant={entry.active ? 'secondary' : 'destructive'}>
                        {entry.active ? t('users.active') : t('users.inactive')}
                      </Badge>
                    </TableCell>
                    <TableCell>{entry.totpEnabled ? t('users.yes') : t('users.no')}</TableCell>
                    <TableCell>
                      {entry.pinLocked ? (
                        <Badge variant="destructive" data-testid="user-pin-locked">
                          {t('users.pinLocked')}
                        </Badge>
                      ) : entry.pinSet ? (
                        t('users.yes')
                      ) : (
                        t('users.no')
                      )}
                    </TableCell>
                    <TableCell>
                      {entry.lastLoginAt
                        ? formatDateTime(entry.lastLoginAt, locale)
                        : t('users.never')}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        {entry.pinLocked ? (
                          <Button
                            type="button"
                            size="lg"
                            className={buttonClass}
                            disabled={busy}
                            data-testid="user-unlock-pin"
                            onClick={() => {
                              void act(entry, () => unlockPin(entry.id), 'users.pinUnlocked');
                            }}
                          >
                            {t('users.unlockPin')}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="lg"
                          className={buttonClass}
                          disabled={busy || !entry.active}
                          data-testid="user-reset-password"
                          onClick={() => {
                            void reset(entry);
                          }}
                        >
                          {t('users.resetPassword')}
                        </Button>
                        {entry.active ? (
                          <Button
                            type="button"
                            variant="destructive"
                            size="lg"
                            className={buttonClass}
                            disabled={busy || isMe}
                            data-testid="user-deactivate"
                            onClick={() => {
                              void act(entry, () => deactivateUser(entry.id), 'users.deactivated');
                            }}
                          >
                            {t('users.deactivate')}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="lg"
                            className={buttonClass}
                            disabled={busy}
                            data-testid="user-reactivate"
                            onClick={() => {
                              void act(entry, () => reactivateUser(entry.id), 'users.reactivated');
                            }}
                          >
                            {t('users.reactivate')}
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
      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        run={run}
        onCreated={(result) => {
          setCreateOpen(false);
          setTemporary(result);
          toast.success(t('users.created'));
          void refresh();
        }}
      />
      <TemporaryPasswordDialog result={temporary} onClose={() => setTemporary(null)} />
      {reauthDialog}
    </Card>
  );
}
