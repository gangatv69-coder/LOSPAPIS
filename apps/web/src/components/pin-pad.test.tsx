import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PinPad } from '@/components/pin-pad';
import i18n from '@/i18n';

/** El PinPad es controlado: este envoltorio guarda el valor como lo haría PinDialog o PinCard. */
function Harness({
  onSubmit,
  disabled,
}: {
  onSubmit: (value: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  return <PinPad value={value} onChange={setValue} onSubmit={onSubmit} disabled={disabled} />;
}

const filledDots = () =>
  screen.getByTestId('pin-dots').querySelectorAll('[data-filled="true"]').length;

const key = (name: string) => screen.getByRole('button', { name });

describe('PinPad', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  it('tiene las 12 teclas de la maqueta (1-9, borrar, 0, confirmar) y 6 puntos vacíos', () => {
    render(<Harness onSubmit={vi.fn()} />);

    const keypad = screen.getByRole('group', { name: 'Teclado del PIN' });
    const names = within(keypad)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(names).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      'Borrar',
      '0',
      'Confirmar',
    ]);
    expect(screen.getByTestId('pin-dots').children).toHaveLength(6);
    expect(filledDots()).toBe(0);
    expect(key('Confirmar')).toBeDisabled();
    expect(key('Borrar')).toBeDisabled();
  });

  it('rellena los puntos al pulsar, borra con la tecla y envía solo al sexto dígito', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await user.click(key('1'));
    await user.click(key('2'));
    await user.click(key('3'));
    expect(filledDots()).toBe(3);
    expect(screen.getByRole('status')).toHaveTextContent('3 de 6 dígitos');

    await user.click(key('Borrar'));
    expect(filledDots()).toBe(2);
    expect(key('Confirmar')).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();

    for (const digit of ['3', '4', '5', '6']) await user.click(key(digit));
    expect(filledDots()).toBe(6);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('123456');

    // Con los 6 dígitos ya puestos, ✓ vuelve a enviarlos (el padre decide si los limpia).
    await user.click(key('Confirmar'));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    // Un séptimo dígito no entra.
    await user.click(key('7'));
    expect(filledDots()).toBe(6);
  });

  it('acepta el teclado físico: dígitos, Retroceso e Intro', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await user.keyboard('12345');
    expect(filledDots()).toBe(5);
    await user.keyboard('{Backspace}');
    expect(filledDots()).toBe(4);
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.keyboard('56');
    expect(onSubmit).toHaveBeenCalledWith('123456');
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('no roba los dígitos que se escriben en un campo de texto', async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="otro campo" />
        <Harness onSubmit={vi.fn()} />
      </>,
    );

    await user.click(screen.getByRole('textbox', { name: 'otro campo' }));
    await user.keyboard('12');

    expect(screen.getByRole('textbox', { name: 'otro campo' })).toHaveValue('12');
    expect(filledDots()).toBe(0);
  });

  it('deshabilitado no reacciona ni a las teclas ni al teclado físico', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} disabled />);

    expect(key('1')).toBeDisabled();
    await user.keyboard('123456');
    expect(filledDots()).toBe(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('anuncia el error que le pasan y admite otro texto sobre los puntos', () => {
    render(
      <PinPad
        value="12"
        onChange={() => {}}
        onSubmit={() => {}}
        error="PIN incorrecto"
        label="Repite el PIN"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('PIN incorrecto');
    expect(screen.getByText('Repite el PIN')).toBeInTheDocument();
    expect(filledDots()).toBe(2);
  });
});
