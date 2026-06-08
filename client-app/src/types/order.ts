export interface Order {
  id: string;
  riderName: string;
  pickupAddress: string;
  dropAddress: string;
  eta: number;
  otpHash: string; // Used for client-side validation logic
  tripType: 'CITY' | 'OUTSTATION' | 'MINI_OUTSTATION';
  carType: 'SEDAN' | 'SUV' | 'HATCH';
}
