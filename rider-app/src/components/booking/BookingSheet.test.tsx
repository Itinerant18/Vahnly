import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/api/garage', () => ({ garageApi: { list: vi.fn(async () => []) } }));
vi.mock('./QuickTiles', () => ({ QuickTiles: () => <div data-testid="quick-tiles" /> }));
// CoolMode paints particles on a <canvas>; jsdom has no 2D context. Passthrough it.
vi.mock('@/components/ui/cool-mode', () => ({ CoolMode: ({ children }: { children?: ReactNode }) => children }));

// Shared mock booking-store actions (asserted on).
const setTripType = vi.fn();
const validatePromo = vi.fn(async () => {});
const bookDriver = vi.fn(async () => ({ order: { id: 'order-9' } }));

type Store = Record<string, unknown>;
let storeState: Store;
vi.mock('@/lib/store/bookingStore', () => ({
  useBookingStore: () => storeState,
}));

import { BookingSheet } from './BookingSheet';

function baseStore(overrides: Store = {}): Store {
  return {
    pickup: null, dropoff: null, tripType: 'IN_CITY_ROUND', durationHours: 4, personsCount: 1,
    d4mCare: false, promoCode: '', paymentMethod: 'CASH', fareEstimate: null, isSearching: false,
    scheduledAt: null, selectedCarId: null,
    setPickup: vi.fn(), setDropoff: vi.fn(), setTripType, setDurationHours: vi.fn(),
    setPersonsCount: vi.fn(), setScheduledAt: vi.fn(), setD4mCare: vi.fn(), setPromoCode: vi.fn(),
    setPaymentMethod: vi.fn(), validatePromo, bookDriver, setSelectedCar: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storeState = baseStore();
});

describe('BookingSheet', () => {
  it('disables "Book Driver" until a pickup is set', () => {
    render(<BookingSheet />);
    expect(screen.getByRole('button', { name: 'Book Driver' })).toBeDisabled();
  });

  it('enables "Book Driver" once a pickup exists', () => {
    storeState = baseStore({ pickup: { lat: 22.5, lng: 88.3, address: 'Home' } });
    render(<BookingSheet />);
    expect(screen.getByRole('button', { name: 'Book Driver' })).toBeEnabled();
  });

  it('changing the trip type updates the store', async () => {
    render(<BookingSheet />);
    await userEvent.click(screen.getByRole('button', { name: 'One-Way' }));
    expect(setTripType).toHaveBeenCalledWith('IN_CITY_ONE_WAY');
  });

  it('shows the fare shimmer while a quote is loading', () => {
    storeState = baseStore({ isSearching: true, fareEstimate: null });
    const { container } = render(<BookingSheet />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders the FareDisplay once a fare estimate arrives', () => {
    storeState = baseStore({
      pickup: { lat: 22.5, lng: 88.3, address: 'Home' },
      fareEstimate: {
        fare_breakdown: { estimated_total_paise: 48000, surge_multiplier: 1, promo_discount_paise: 0 },
        surge_active: false, driver_availability: 'HIGH', estimated_pickup_eta_minutes: 5,
      },
    });
    render(<BookingSheet />);
    expect(screen.getByLabelText('₹480.00')).toBeInTheDocument();
  });

  it('shows an error when promo validation rejects', async () => {
    validatePromo.mockRejectedValueOnce(new Error('invalid'));
    render(<BookingSheet />);
    await userEvent.type(screen.getByPlaceholderText('Enter promo code'), 'NOPE');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('Invalid or expired code')).toBeInTheDocument();
  });

  it('shows a success tick when promo validation resolves', async () => {
    render(<BookingSheet />);
    await userEvent.type(screen.getByPlaceholderText('Enter promo code'), 'TESTCODE');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByLabelText('Promo applied')).toBeInTheDocument();
    expect(validatePromo).toHaveBeenCalled();
  });
});
