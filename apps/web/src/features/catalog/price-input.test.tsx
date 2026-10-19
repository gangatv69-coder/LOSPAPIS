import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PriceInput, parsePrice } from '@/features/catalog/price-input';
import i18n from '@/i18n';

function renderInput(valueCents: number | null = null, error: string | null = null) {
  const onChange = vi.fn();
  render(
    <>
      <label htmlFor="price">Precio</label>
      <PriceInput id="price" valueCents={valueCents} onChange={onChange} error={error} />
    </>,
  );
  return { onChange, input: screen.getByLabelText('Precio') };
}

describe('parsePrice', () => {
  it('entiende los formatos de la caja y aplica el tope del catálogo', () => {
    expect(parsePrice('15')).toEqual({ ok: true, cents: 1500 });
    expect(parsePrice('15,5')).toEqual({ ok: true, cents: 1550 });
    expect(parsePrice('15.50')).toEqual({ ok: true, cents: 1550 });
    expect(parsePrice('1.234,50')).toEqual({ ok: true, cents: 123450 });
    expect(parsePrice('')).toEqual({ ok: false, code: 'empty' });
    expect(parsePrice('abc')).toEqual({ ok: false, code: 'invalid_format' });
    expect(parsePrice('-3')).toEqual({ ok: false, code: 'negative_not_allowed' });
    expect(parsePrice('100.000,01')).toEqual({ ok: false, code: 'too_high' });
  });
});

describe('PriceInput', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  it('pinta el valor inicial sin símbolo y entrega céntimos mientras se escribe', async () => {
    const user = userEvent.setup();
    const { onChange, input } = renderInput(1500);

    expect(input).toHaveValue('15,00');
    expect(input).toHaveAttribute('inputmode', 'decimal');

    await user.clear(input);
    await user.type(input, '9,5');

    expect(onChange).toHaveBeenLastCalledWith(950);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('al salir del campo normaliza a dos decimales', async () => {
    const user = userEvent.setup();
    const { onChange, input } = renderInput();

    await user.type(input, '10');
    await user.tab();

    expect(input).toHaveValue('10,00');
    expect(onChange).toHaveBeenLastCalledWith(1000);
  });

  it('explica un texto que no se entiende y lo retira al corregirlo', async () => {
    const user = userEvent.setup();
    const { onChange, input } = renderInput();

    await user.type(input, 'abc');
    await user.tab();

    expect(screen.getByRole('alert')).toHaveTextContent('No se entiende el precio');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).toHaveBeenLastCalledWith(null);

    await user.clear(input);
    await user.type(input, '12');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(1200);
  });

  it('rechaza un precio por encima del tope', async () => {
    const user = userEvent.setup();
    const { input } = renderInput();

    await user.type(input, '200000');
    await user.tab();

    expect(screen.getByRole('alert')).toHaveTextContent('100.000,00 €');
  });

  it('el error del formulario manda sobre el de formato', () => {
    renderInput(null, 'Escribe un precio.');
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe un precio.');
  });
});
