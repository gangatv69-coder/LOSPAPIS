import { describe, expect, it } from 'vitest';

import { ACTIONS, type Action, can, PERMISSIONS } from './permissions.ts';

/** Una fila por acción de la tabla del PRD §5 ("Qué puede hacer cada rol"): [acción, ¿barbero?]. */
const PRD_ROWS: ReadonlyArray<[Action, boolean, string]> = [
  ['cobrar', false, 'Cobrar servicios y productos'],
  ['descuento', false, 'Dar descuentos y autorizar cortes gratis, con motivo'],
  ['anular', false, 'Anular un cobro con motivo (borrar, nunca)'],
  ['cierre', false, 'Hacer el cierre de caja y registrar salidas de dinero'],
  ['inventario', false, 'Gestionar inventario y precios'],
  ['avisar_insumo', true, 'Avisar que se acabó un insumo'],
  ['ver_citas_todas', false, 'Ver las citas del día de todos'],
  ['ver_citas_propias', true, 'Ver las citas del día: solo las suyas'],
  ['mover_citas_todas', false, 'Cancelar o mover citas de todos'],
  ['mover_citas_propias', true, 'Cancelar o mover citas: solo las suyas'],
  ['ver_facturado_todo', false, 'Ver cuánto se ha facturado, de todos'],
  ['ver_facturado_propio', true, 'Ver cuánto se ha facturado: solo lo suyo'],
  ['estadisticas', false, 'Ver estadísticas, valoraciones, gastos y ganancia'],
  ['usuarios', false, 'Crear cuentas, restablecer contraseñas, desactivar'],
  ['dispositivos', false, 'Autorizar y revocar dispositivos de caja'],
  ['pin_desbloquear', false, 'Desbloquear el PIN de un manager'],
];

describe('matriz de permisos (PRD §5)', () => {
  it.each(PRD_ROWS)('%s: manager sí, barbero %s (%s)', (action, barber) => {
    expect(can('manager', action)).toBe(true);
    expect(can('barber', action)).toBe(barber);
  });

  it('la tabla cubre todas las acciones conocidas y el barbero solo tiene las cuatro suyas', () => {
    expect(PRD_ROWS.map(([action]) => action).sort()).toEqual([...ACTIONS].sort());
    expect([...PERMISSIONS.barber].sort()).toEqual([
      'avisar_insumo',
      'mover_citas_propias',
      'ver_citas_propias',
      'ver_facturado_propio',
    ]);
    expect(PERMISSIONS.manager.size).toBe(ACTIONS.length);
  });

  it('toda acción desconocida se niega, sea cual sea el rol', () => {
    const unknown = 'volar' as Action;
    expect(can('manager', unknown)).toBe(false);
    expect(can('barber', unknown)).toBe(false);
  });
});
