import { create } from 'zustand';

export type OrderStatus = 
  | 'CREATED' 
  | 'ASSIGNED' 
  | 'ARRIVED_AT_PICKUP' 
  | 'IN_TRIP' 
  | 'COMPLETED';

export type DriverState = 
  | 'OFFLINE' 
  | 'ONLINE_AVAILABLE' 
  | 'ONLINE_BUSY';

export interface AppState {
  // Order lifecycle
  currentOrderId: string | null;
  orderStatus: OrderStatus;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;

  // Driver lifecycle
  driverId: string | null;
  driverState: DriverState;
  driverName: string;
  driverRating: number;
  vehiclePlate: string;

  // Surge pricing
  surgeMultiplier: number;

  // Connection state (for resilience)
  isConnected: boolean;
  isReconnecting: boolean;

  // Actions
  setOrderStatus: (status: OrderStatus) => void;
  setDriverState: (state: DriverState) => void;
  setSurgeMultiplier: (multiplier: number) => void;
  setConnected: (connected: boolean) => void;
  setReconnecting: (reconnecting: boolean) => void;
}

export const useAppState = create<AppState>((set) => ({
  // Initial state
  currentOrderId: null,
  orderStatus: 'CREATED',
  pickupLat: 0,
  pickupLng: 0,
  dropoffLat: 0,
  dropoffLng: 0,
  driverId: null,
  driverState: 'OFFLINE',
  driverName: '',
  driverRating: 0,
  vehiclePlate: '',
  surgeMultiplier: 1.0,
  isConnected: false,
  isReconnecting: false,

  // Actions
  setOrderStatus: (status) => set({ orderStatus: status }),
  setDriverState: (state) => set({ driverState: state }),
  setSurgeMultiplier: (multiplier) => set({ surgeMultiplier: multiplier }),
  setConnected: (connected) => set({ isConnected: connected }),
  setReconnecting: (reconnecting) => set({ isReconnecting: reconnecting }),
}));
