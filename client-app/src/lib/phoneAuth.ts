import { Capacitor } from '@capacitor/core';
import { auth } from './firebase';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';

/**
 * Firebase Phone Auth for the Driver app (native-aware), mirroring the rider flow.
 *
 * Firebase delivers the SMS OTP itself (no backend SMS provider / DLT). The verified
 * `phone_number` lives in the Firebase ID token returned by `confirm()`, which the
 * driver backend trusts via `firebaseauth.VerifyIDToken` — it is never a client field.
 *
 * - Web: invisible reCAPTCHA + `signInWithPhoneNumber`. The page must render
 *   `<div id="recaptcha-container" />`. Authorized domains must be allow-listed in
 *   the Firebase console.
 * - Native (Capacitor): `@capacitor-firebase/authentication` drives the platform SDK
 *   (requires the android/ project + SHA keys; deferred while the app is web-first).
 */

const RECAPTCHA_CONTAINER_ID = 'recaptcha-container';

export interface PhoneConfirmation {
  /** Confirms the SMS code and resolves the Firebase ID token (the phone_token). */
  confirm(code: string): Promise<string>;
}

let webVerifier: RecaptchaVerifier | null = null;

function getRecaptcha(): RecaptchaVerifier {
  if (!auth) throw new Error('Authentication module is not initialized.');
  if (!webVerifier) {
    webVerifier = new RecaptchaVerifier(auth, RECAPTCHA_CONTAINER_ID, { size: 'invisible' });
  }
  return webVerifier;
}

function resetWebVerifier(): void {
  try {
    webVerifier?.clear();
  } catch {
    /* ignore */
  }
  webVerifier = null;
}

// Sends an SMS OTP to the E.164 phone and returns a confirmation handle.
export async function startPhoneVerification(e164Phone: string): Promise<PhoneConfirmation> {
  if (Capacitor.isNativePlatform()) {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    const verificationId = await new Promise<string>((resolve, reject) => {
      FirebaseAuthentication.addListener('phoneCodeSent', (event: { verificationId: string }) => {
        resolve(event.verificationId);
      })
        .then((handle) => {
          FirebaseAuthentication.signInWithPhoneNumber({ phoneNumber: e164Phone }).catch((err) => {
            void handle.remove();
            reject(err);
          });
        })
        .catch(reject);
    });
    return {
      confirm: async (code: string) => {
        await FirebaseAuthentication.confirmVerificationCode({ verificationId, verificationCode: code });
        const { token } = await FirebaseAuthentication.getIdToken();
        return token;
      },
    };
  }

  if (!auth) throw new Error('Authentication module is not initialized.');
  let confirmationResult;
  try {
    confirmationResult = await signInWithPhoneNumber(auth, e164Phone, getRecaptcha());
  } catch (err) {
    // Reset so a retry starts a fresh challenge instead of reusing a spent reCAPTCHA.
    resetWebVerifier();
    throw err;
  }
  return {
    confirm: async (code: string) => {
      const cred = await confirmationResult.confirm(code);
      return cred.user.getIdToken();
    },
  };
}
