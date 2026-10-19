import type { UserRole } from '@los-papis/shared';

/**
 * Matriz de permisos del PRD §5 ("Qué puede hacer cada rol"). El servidor niega por defecto: toda ruta nueva
 * bajo /api lleva requireUser(), requireDevice() o requirePermission(); lo público se lista explícitamente.
 */
export type Action =
  | 'cobrar'
  | 'descuento'
  | 'anular'
  | 'cierre'
  | 'inventario'
  | 'avisar_insumo'
  | 'ver_citas_todas'
  | 'ver_citas_propias'
  | 'mover_citas_todas'
  | 'mover_citas_propias'
  | 'ver_facturado_todo'
  | 'ver_facturado_propio'
  | 'estadisticas'
  | 'usuarios'
  | 'dispositivos'
  | 'pin_desbloquear';

export const ACTIONS: readonly Action[] = [
  'cobrar',
  'descuento',
  'anular',
  'cierre',
  'inventario',
  'avisar_insumo',
  'ver_citas_todas',
  'ver_citas_propias',
  'mover_citas_todas',
  'mover_citas_propias',
  'ver_facturado_todo',
  'ver_facturado_propio',
  'estadisticas',
  'usuarios',
  'dispositivos',
  'pin_desbloquear',
];

/** El manager puede todo; el barbero solo lo suyo (y avisar de que se acabó un insumo). */
export const PERMISSIONS: Record<UserRole, ReadonlySet<Action>> = {
  manager: new Set<Action>(ACTIONS),
  barber: new Set<Action>([
    'avisar_insumo',
    'ver_citas_propias',
    'mover_citas_propias',
    'ver_facturado_propio',
  ]),
};

export const can = (role: UserRole, action: Action): boolean =>
  PERMISSIONS[role]?.has(action) ?? false;
