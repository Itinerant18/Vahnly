import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuthStore } from '@/store/useAuthStore';

// Driver phone-verification gate tests (mirrors the deep-verification plan):
//  1. Direct login with phone_verified=false -> must clear an OTP gate before /driver.
//  2. Google sign-in for an unregistered driver -> mandatory OTP before the account is created.

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/api/client', () => ({
  driverLogin: vi.fn(),
  driverGoogleLogin: vi.fn(),
  driverRegister: vi.fn(),
  sendDriverOTP: vi.fn(),
  verifyDriverOTP: vi.fn(),
}));

vi.mock('@/lib/googleAuth', () => ({ getGoogleIdToken: vi.fn() }));
vi.mock('@/services/notifications', () => ({
  registerDriverPushNotifications: vi.fn().mockResolvedValue(undefined),
}));

import UnifiedLogin from './page';
import {
  driverLogin,
  driverGoogleLogin,
  driverRegister,
  sendDriverOTP,
  verifyDriverOTP,
} from '@/api/client';
import { getGoogleIdToken } from '@/lib/googleAuth';

const driver = { id: 'd1', role: 'DRIVER' as const, name: 'Test Driver', current_state: '', phone: '+919876543210' };

async function fillOtp(code: string) {
  // The 6 boxes carry aria-label "OTP digit N"; typing the 6th triggers auto-submit.
  for (let i = 0; i < 6; i++) {
    const box = screen.getByLabelText(`OTP digit ${i + 1}`);
    await userEvent.type(box, code[i]);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  pushMock.mockReset();
  useAuthStore.setState({ token: null, user: null, isAuthenticated: false });
  localStorage.clear();
  vi.mocked(sendDriverOTP).mockResolvedValue({ message: 'sent', expires_in_seconds: 300 });
});

describe('Driver phone-verification gate', () => {
  it('Test 1 — direct login with unverified phone forces the OTP gate, then routes to /driver', async () => {
    vi.mocked(driverLogin).mockResolvedValue({
      token: 'login-token',
      user: { ...driver },
      phone_verified: false,
    } as never);
    vi.mocked(verifyDriverOTP).mockResolvedValue({
      is_new_driver: false,
      token: 'session-token',
      user: { ...driver, phone_verified: true },
      phone_verified: true,
    } as never);

    render(<UnifiedLogin />);

    await userEvent.type(screen.getByPlaceholderText('99999 88888'), '9876543210');
    await userEvent.type(screen.getByPlaceholderText('••••••••'), 'SecretPin1');
    await userEvent.click(screen.getByRole('button', { name: /Authenticate & Access/i }));

    // Gate: login succeeded but phone_verified=false -> OTP challenge shown, NOT /driver.
    await waitFor(() => expect(sendDriverOTP).toHaveBeenCalledWith('9876543210'));
    expect(screen.getByLabelText('OTP digit 1')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();

    await fillOtp('025052');

    await waitFor(() => expect(verifyDriverOTP).toHaveBeenCalledWith('9876543210', '025052'));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/driver'));
    expect(useAuthStore.getState().token).toBe('session-token');
    expect(useAuthStore.getState().user?.phone_verified).toBe(true);
  });

  it('Test 2 — Google sign-in for an unregistered driver requires OTP before registration', async () => {
    vi.mocked(getGoogleIdToken).mockResolvedValue('google-id-token');
    // First call (no regData) -> not registered; second call (with phoneToken) -> session issued.
    vi.mocked(driverGoogleLogin)
      .mockResolvedValueOnce({ registered: false, email: 'd@x.com', name: 'Test Driver' } as never)
      .mockResolvedValueOnce({ token: 'g-session', user: { ...driver }, phone_verified: true } as never);
    vi.mocked(verifyDriverOTP).mockResolvedValue({
      is_new_driver: true,
      phone_token: 'phone-token',
      phone: '+919876543210',
    } as never);

    render(<UnifiedLogin />);

    await userEvent.click(screen.getByRole('button', { name: /Google Sign-In/i }));

    // Unregistered -> extra-details form; supply the phone then continue.
    await waitFor(() => expect(screen.getByRole('button', { name: /Complete Registration/i })).toBeInTheDocument());
    await userEvent.type(screen.getByPlaceholderText('99999 88888'), '9876543210');
    await userEvent.click(screen.getByRole('button', { name: /Complete Registration/i }));

    await waitFor(() => expect(sendDriverOTP).toHaveBeenCalledWith('9876543210'));
    await fillOtp('025052');

    // OTP verified -> phone_token passed back into the Google registration call.
    await waitFor(() => expect(verifyDriverOTP).toHaveBeenCalledWith('9876543210', '025052'));
    await waitFor(() => expect(driverGoogleLogin).toHaveBeenCalledTimes(2));
    expect(vi.mocked(driverGoogleLogin).mock.calls[1][1]).toMatchObject({ phoneToken: 'phone-token' });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/driver-onboarding'));
    expect(driverRegister).not.toHaveBeenCalled();
  });
});
