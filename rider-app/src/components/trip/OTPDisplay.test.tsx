import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Controllable trip-store state — OTPDisplay only renders at ARRIVED_AT_PICKUP.
const state: { tripStatus: string; otp: string | null } = {
  tripStatus: 'ARRIVED_AT_PICKUP',
  otp: '4821',
};
vi.mock('@/lib/store/tripStore', () => ({
  useTripStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

import { OTPDisplay } from './OTPDisplay';

beforeEach(() => {
  state.tripStatus = 'ARRIVED_AT_PICKUP';
  state.otp = '4821';
});

describe('OTPDisplay', () => {
  it('shows the 4 OTP digits once the driver has arrived', () => {
    render(<OTPDisplay />);
    expect(screen.getByText('Share this code with your driver')).toBeInTheDocument();
    for (const digit of ['4', '8', '2', '1']) {
      expect(screen.getAllByText(digit).length).toBeGreaterThan(0);
    }
  });

  it('renders the digits in mono (JetBrains)', () => {
    render(<OTPDisplay />);
    const four = screen.getAllByText('4')[0];
    expect(four).toHaveClass('font-mono');
  });

  it('renders nothing before arrival', () => {
    state.tripStatus = 'EN_ROUTE';
    const { container } = render(<OTPDisplay />);
    expect(container).toBeEmptyDOMElement();
  });
});
