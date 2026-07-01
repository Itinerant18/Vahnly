import { describe, it, expect, vi } from 'vitest';
import { bookingBlocker, tripNeedsDropoff, useBookingStore } from './bookingStore';
import type { FareEstimate, LocationPoint, TripType } from '../api/types';

vi.mock('../api/fare', () => ({
  fareApi: { estimate: vi.fn(async () => ({ fare_breakdown: {} })) },
}));

const pickup: LocationPoint = { lat: 22.5, lng: 88.3, address: 'Home' };
const dropoff: LocationPoint = { lat: 22.6, lng: 88.4, address: 'Work' };
const fare = { fare_breakdown: {} } as FareEstimate;

function state(overrides: Partial<Parameters<typeof bookingBlocker>[0]> = {}) {
  return {
    pickup: null,
    dropoff: null,
    tripType: 'IN_CITY_ONE_WAY' as TripType,
    selectedCarId: null,
    oneTimeCar: null,
    fareEstimate: null,
    ...overrides,
  };
}

describe('bookingBlocker', () => {
  it('blocks on missing pickup first', () => {
    expect(bookingBlocker(state())).toBe('pickup');
  });

  it('requires a drop-off for point-to-point trips', () => {
    expect(bookingBlocker(state({ pickup, tripType: 'IN_CITY_ONE_WAY' }))).toBe('dropoff');
  });

  it('does NOT require a drop-off for round/hourly trips (next blocker is the car)', () => {
    expect(bookingBlocker(state({ pickup, tripType: 'IN_CITY_ROUND' }))).toBe('car');
    expect(bookingBlocker(state({ pickup, tripType: 'IN_CITY_HOURLY' }))).toBe('car');
  });

  it('requires a car once locations are set', () => {
    expect(bookingBlocker(state({ pickup, dropoff }))).toBe('car');
  });

  it('requires a fare estimate once a car is chosen', () => {
    expect(bookingBlocker(state({ pickup, dropoff, selectedCarId: 'c1' }))).toBe('fare');
  });

  it('is ready (null) when every required field is present', () => {
    expect(bookingBlocker(state({ pickup, dropoff, selectedCarId: 'c1', fareEstimate: fare }))).toBeNull();
    // one-time car satisfies the car requirement too
    expect(bookingBlocker(state({ pickup, dropoff, oneTimeCar: {} as never, fareEstimate: fare }))).toBeNull();
  });
});

describe('fare freshness (Phase 4)', () => {
  it('clears the fare estimate the moment a fare input changes', () => {
    useBookingStore.setState({ pickup, fareEstimate: fare });
    useBookingStore.getState().setDropoff(dropoff);
    expect(useBookingStore.getState().fareEstimate).toBeNull();
  });
});

describe('tripNeedsDropoff', () => {
  it('is true only for point-to-point and outstation trips', () => {
    expect(tripNeedsDropoff('IN_CITY_ONE_WAY')).toBe(true);
    expect(tripNeedsDropoff('MINI_OUTSTATION')).toBe(true);
    expect(tripNeedsDropoff('OUTSTATION')).toBe(true);
    expect(tripNeedsDropoff('IN_CITY_ROUND')).toBe(false);
    expect(tripNeedsDropoff('IN_CITY_HOURLY')).toBe(false);
    expect(tripNeedsDropoff('MONTHLY')).toBe(false);
  });
});
