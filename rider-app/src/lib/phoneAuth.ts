import { Capacitor } from "@capacitor/core";
import { auth } from "./firebase";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";

/**
 * Firebase Phone Auth (native-aware).
 *
 * - Native (Capacitor Android/iOS): uses `@capacitor-firebase/authentication` to drive
 *   the platform Firebase SDK. No reCAPTCHA is needed.
 * - Web: invisible reCAPTCHA + `signInWithPhoneNumber`. The page must render
 *   `<div id="recaptcha-container" />`. Authorized domains must be allow-listed in
 *   the Firebase console.
 */

export interface PhoneConfirmation {
  /** Confirms the SMS code and resolves the Firebase ID token (the phone_token). */
  confirm(code: string): Promise<string>;
}

const RECAPTCHA_CONTAINER_ID = "recaptcha-container";

let webVerifier: RecaptchaVerifier | null = null;

function getRecaptcha(): RecaptchaVerifier {
  if (!auth) throw new Error("Authentication module is not initialized.");
  if (!webVerifier) {
    webVerifier = new RecaptchaVerifier(auth, RECAPTCHA_CONTAINER_ID, {
      size: "invisible",
    });
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
    const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
    const verificationId = await new Promise<string>((resolve, reject) => {
      FirebaseAuthentication.addListener("phoneCodeSent", (event: { verificationId: string }) => {
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

  if (!auth) throw new Error("Authentication module is not initialized.");
  try {
    const result: ConfirmationResult = await signInWithPhoneNumber(auth, e164Phone, getRecaptcha());
    return {
      confirm: async (code: string) => {
        const cred = await result.confirm(code);
        return cred.user.getIdToken();
      },
    };
  } catch (err) {
    resetWebVerifier();
    throw err;
  }
}
