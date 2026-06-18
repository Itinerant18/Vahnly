// EnRoute State
export interface TripEnRouteProps {
  rider: { name: string; photo: string; rating: number; maskedPhone: string };
  destination: { lat: number; lng: number; address: string };
  eta: number; // minutes
}

// Odometer & OTP Capture (The "Start" Guard)
export interface StartTripPayload {
  odometerReading: number;
  fuelPercentage: number;
  otp: string;
  photoUrl?: string; // Captured at point of arrival
  carPlate?: string; // plate read off the car — verified against the rider's registered car
}
