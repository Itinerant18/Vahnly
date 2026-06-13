import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FareDisplay } from './FareDisplay';

describe('FareDisplay', () => {
  it('formats 24000 paise as ₹240.00', () => {
    render(<FareDisplay amount={24000} />);
    expect(screen.getByLabelText('₹240.00')).toHaveTextContent('₹240.00');
  });

  it('formats 0 paise as ₹0.00', () => {
    render(<FareDisplay amount={0} />);
    expect(screen.getByLabelText('₹0.00')).toHaveTextContent('₹0.00');
  });

  it('formats 99 paise as ₹0.99', () => {
    render(<FareDisplay amount={99} />);
    expect(screen.getByLabelText('₹0.99')).toHaveTextContent('₹0.99');
  });

  it('always renders in JetBrains Mono (font-mono)', () => {
    render(<FareDisplay amount={100} />);
    expect(screen.getByLabelText('₹1.00')).toHaveClass('font-mono');
  });

  it('applies the display size class when size="display"', () => {
    render(<FareDisplay amount={100} size="display" />);
    expect(screen.getByLabelText('₹1.00')).toHaveClass('text-display-medium');
  });

  it('omits the ₹ symbol when showSymbol is false', () => {
    render(<FareDisplay amount={24000} showSymbol={false} />);
    const el = screen.getByLabelText('₹240.00');
    expect(el).toHaveTextContent('240.00');
    expect(el.textContent).not.toContain('₹');
  });
});
