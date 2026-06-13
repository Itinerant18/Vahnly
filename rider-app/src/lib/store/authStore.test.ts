import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the API + client modules the store wires at import time.
vi.mock('../api/auth', () => ({
  authApi: {
    sendOTP: vi.fn(async () => {}),
    verifyOTP: vi.fn(async () => ({
      token: 'rider-jwt',
      rider: { id: 'r1', phone: '+919876543210' },
      is_new_rider: false,
    })),
    me: vi.fn(async () => ({ id: 'r1', phone: '+919876543210' })),
  },
}));
vi.mock('../api/client', () => ({
  TOKEN_STORAGE_KEY: 'dfu_token',
  setUnauthorizedHandler: vi.fn(),
}));

import { useAuthStore } from './authStore';
import { authApi } from '../api/auth';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useAuthStore.setState({ rider: null, token: null, isNewRider: false, isLoading: false });
  vi.clearAllMocks();
});

describe('rider authStore', () => {
  it('sendOTP forwards the phone to the API', async () => {
    await useAuthStore.getState().sendOTP('9876543210');
    expect(authApi.sendOTP).toHaveBeenCalledWith('9876543210');
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('verifyOTP success stores token + rider and persists the token', async () => {
    const res = await useAuthStore.getState().verifyOTP('+919876543210', '123456');
    expect(res.isNew).toBe(false);
    expect(useAuthStore.getState().token).toBe('rider-jwt');
    expect(useAuthStore.getState().rider).toMatchObject({ id: 'r1' });
    expect(localStorage.getItem('dfu_token')).toBe('rider-jwt');
  });

  it('verifyOTP failure leaves token null and resets loading', async () => {
    (authApi.verifyOTP as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('bad otp'));
    await expect(useAuthStore.getState().verifyOTP('+919876543210', '000000')).rejects.toThrow();
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(localStorage.getItem('dfu_token')).toBeNull();
  });

  it('logout clears token + rider and wipes the persisted token', () => {
    useAuthStore.setState({ token: 'rider-jwt', rider: { id: 'r1', phone: '+919876543210' } as never });
    localStorage.setItem('dfu_token', 'rider-jwt');
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().rider).toBeNull();
    expect(localStorage.getItem('dfu_token')).toBeNull();
  });
});
