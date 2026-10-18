import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      {count}
    </button>
  );
}

describe('entorno de pruebas de web', () => {
  it('renderiza en jsdom, usa jest-dom y responde a user-event', async () => {
    const user = userEvent.setup();
    render(<Counter />);

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveTextContent('1');
  });
});
