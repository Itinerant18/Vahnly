import type { Env } from '../types';
import { toE164, isTestNumber } from './stytch';

export interface TwilioSendOTPResponse {
  success: boolean;
  service_sid?: string;
  status: string;
  channel: 'sms' | 'whatsapp';
  is_test_mode?: boolean;
}

export interface TwilioVerifyOTPResponse {
  verified: boolean;
  phone_number?: string;
  status?: string;
}

function getTwilioBasicAuth(accountSid: string, authToken: string): string {
  return btoa(`${accountSid}:${authToken}`);
}

/**
 * Sends a verification code via Twilio Verify API (or SMS fallback).
 */
export async function sendTwilioOTP(
  env: Env,
  phone: string,
  channel: 'sms' | 'whatsapp' = 'sms'
): Promise<TwilioSendOTPResponse> {
  const e164 = toE164(phone);

  // Dedicated test number bypass: prevents toll billing, bypasses SMS delay, guarantees instant testing
  if (isTestNumber(phone)) {
    return {
      success: true,
      service_sid: `dev-twilio-test-${e164}`,
      status: 'pending',
      channel,
      is_test_mode: true,
    };
  }

  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const verifyServiceSid = env.TWILIO_VERIFY_SERVICE_SID;

  if (!accountSid || !authToken || !verifyServiceSid) {
    throw new Error('Twilio credentials not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID)');
  }

  const twilioUrl = `https://verify.twilio.com/v2/Services/${verifyServiceSid}/Verifications`;

  const body = new URLSearchParams();
  body.append('To', e164);
  body.append('Channel', channel === 'whatsapp' ? 'whatsapp' : 'sms');

  const res = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${getTwilioBasicAuth(accountSid, authToken)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const errorMsg = data?.message || `Twilio Verify error: ${res.status}`;
    throw new Error(errorMsg);
  }

  return {
    success: true,
    service_sid: data.service_sid || verifyServiceSid,
    status: data.status,
    channel,
    is_test_mode: false,
  };
}

/**
 * Verifies a 6-digit code against Twilio Verify API.
 */
export async function verifyTwilioOTP(
  env: Env,
  params: { code: string; phone: string }
): Promise<TwilioVerifyOTPResponse> {
  const { code, phone } = params;
  const e164 = toE164(phone);

  if (isTestNumber(phone) && (code === '123456' || code === '000000')) {
    return {
      verified: true,
      phone_number: e164,
      status: 'approved',
    };
  }

  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const verifyServiceSid = env.TWILIO_VERIFY_SERVICE_SID;

  if (!accountSid || !authToken || !verifyServiceSid) {
    throw new Error('Twilio credentials not configured');
  }

  const twilioUrl = `https://verify.twilio.com/v2/Services/${verifyServiceSid}/VerificationCheck`;

  const body = new URLSearchParams();
  body.append('To', e164);
  body.append('Code', code);

  const res = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${getTwilioBasicAuth(accountSid, authToken)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const errorMsg = data?.message || 'Invalid or expired OTP code';
    throw new Error(errorMsg);
  }

  const isApproved = data.status === 'approved' && data.valid === true;
  if (!isApproved) {
    throw new Error('Invalid or expired OTP code');
  }

  return {
    verified: true,
    phone_number: data.to || e164,
    status: data.status,
  };
}

