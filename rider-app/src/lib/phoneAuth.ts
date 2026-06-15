import { Capacitor } from "@capacitor/core";
import { auth } from "./firebase";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";

let recaptchaVerifier: RecaptchaVerifier | null = null;

// Lazily create a single invisible reCAPTCHA bound to a DOM container. Firebase requires
// reCAPTCHA for web phone auth to deter SMS abuse.
function getRecaptcha(containerId: string): RecaptchaVerifier {
  if (!auth) throw new Error("Authentication module is not initialized.");
  if (!recaptchaVerifier) {
    recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
      size: "invisible",
    });
  }
  return recaptchaVerifier;
}

/**
 * Start Firebase Phone Auth: sends an SMS OTP to the E.164 number and returns a confirmation
 * handle. Web-only for now (native Capacitor needs the platform plugin).
 */
export async function startPhoneVerification(
  phoneE164: string,
  recaptchaContainerId: string,
): Promise<ConfirmationResult> {
  if (Capacitor.isNativePlatform()) {
    throw new Error("Phone verification on native is not configured yet.");
  }
  if (!auth) throw new Error("Authentication module is not initialized.");
  const verifier = getRecaptcha(recaptchaContainerId);
  return signInWithPhoneNumber(auth, phoneE164, verifier);
}

/**
 * Confirm the SMS OTP and return the Firebase ID token. The token carries a verified
 * phone_number claim that the backend trusts when creating the rider.
 */
export async function confirmPhoneCode(
  confirmation: ConfirmationResult,
  code: string,
): Promise<string> {
  const cred = await confirmation.confirm(code);
  return cred.user.getIdToken();
}

/** Tear down the verifier (after an error) so a fresh challenge can be issued. */
export function resetRecaptcha(): void {
  try {
    recaptchaVerifier?.clear();
  } catch {
    // ignore
  }
  recaptchaVerifier = null;
}
