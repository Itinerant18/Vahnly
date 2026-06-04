// Shared trip audit dataset — consumed by the history list (inline detail) and the
// deep-linkable /driver-account/trip-history/[tripId] route. Single source so the two
// views never drift. Mock data stands in until the trips audit API is wired.

export interface BillBreakdown {
  base: number;
  tolls: number;
  parking: number;
  waiting: number;
  surge: number;
  deductions: number;
  net: number;
}

export interface TripItem {
  id: string;
  date: string;
  type: 'CITY' | 'OUTSTATION';
  route: string;
  fare: number;
  status: string;
  car: string;
  rider: string;
  duration: number;
  distance: number;
  ratingGiven: number;
  ratingReceived: number;
  commentReceived: string;
  pickup: string;
  dropoff: string;
  bill: BillBreakdown;
}

export const TRIP_HISTORY: TripItem[] = [
  {
    id: 'trp-2209',
    date: '2026-06-03 21:30',
    type: 'CITY',
    route: 'Salt Lake Sector V ➔ Park Street Dining Grid',
    fare: 780.0,
    status: 'Completed',
    car: 'Audi A6 (Automatic) • WB-02-AK-9988',
    rider: 'Anirban Das',
    duration: 38,
    distance: 14.8,
    ratingGiven: 5,
    ratingReceived: 5,
    commentReceived: 'Very smooth driver, polite and clean vehicle care',
    pickup: 'Salt Lake Sector V Tech Hub, Kolkata',
    dropoff: 'Park Street Dining Grid, Kolkata',
    bill: { base: 780.0, tolls: 50.0, parking: 30.0, waiting: 0, surge: 50.0, deductions: 78.0, net: 832.0 },
  },
  {
    id: 'trp-2188',
    date: '2026-06-03 14:15',
    type: 'CITY',
    route: 'Howrah Junction ➔ Ballygunge Complex',
    fare: 560.0,
    status: 'Completed',
    car: 'Swift Dzire (Manual) • KA-03-MD-4561',
    rider: 'Rohan Sen',
    duration: 25,
    distance: 9.2,
    ratingGiven: 5,
    ratingReceived: 5,
    commentReceived: 'Punctual and helpful with luggage support.',
    pickup: 'Howrah Junction Railway Station, Kolkata',
    dropoff: 'Ballygunge Cultural Complex, Kolkata',
    bill: { base: 560.0, tolls: 0, parking: 0, waiting: 15.0, surge: 0, deductions: 56.0, net: 519.0 },
  },
  {
    id: 'trp-2122',
    date: '2026-06-02 18:40',
    type: 'OUTSTATION',
    route: 'Kolkata Airport ➔ Digha Beach Resort',
    fare: 3200.0,
    status: 'Completed',
    car: 'Audi A6 (Automatic) • WB-02-AK-9988',
    rider: 'Priya Dey',
    duration: 180,
    distance: 175.4,
    ratingGiven: 5,
    ratingReceived: 4,
    commentReceived: 'Great driver. Safe highway speed thresholds kept.',
    pickup: 'Netaji Subhash Chandra Bose Int. Airport, Kolkata',
    dropoff: 'Digha Beach Resort Front Office, West Bengal',
    bill: { base: 3200.0, tolls: 240.0, parking: 50.0, waiting: 0, surge: 100.0, deductions: 320.0, net: 3270.0 },
  },
  {
    id: 'trp-2015',
    date: '2026-05-30 11:20',
    type: 'CITY',
    route: 'Alipore Hub ➔ Central Park Kolkata',
    fare: 480.0,
    status: 'Completed',
    car: 'Swift Dzire (Manual) • KA-03-MD-4561',
    rider: 'Vikram Seth',
    duration: 18,
    distance: 7.5,
    ratingGiven: 4,
    ratingReceived: 5,
    commentReceived: 'Clean cabin, polite language.',
    pickup: 'Alipore Police Bodyguard Line Hub, Kolkata',
    dropoff: 'Central Park Salt Lake Metro Gate, Kolkata',
    bill: { base: 480.0, tolls: 0, parking: 0, waiting: 0, surge: 0, deductions: 48.0, net: 432.0 },
  },
];

export function getTripById(id: string): TripItem | undefined {
  return TRIP_HISTORY.find((t) => t.id === id);
}
