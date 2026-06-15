import { auth } from "./firebase";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";

// Firebase Phone Auth (web). The page must render <div id="recaptcha-container" /> for the
// invisible reCAPTCHA challenge. confirmationResult.confirm(code) yields the verified phone
// user, whose Firebase ID token carries the phone_number claim the backend trusts.
const RECAPTCHA_CONTAINER_ID = "recaptcha-container";

let verifier: RecaptchaVerifier | null = null;

function getRecaptcha(): RecaptchaVerifier {
  if (!auth) throw new Error("Authentication module is not initialized.");
  if (!verifier) {
    verifier = new RecaptchaVerifier(auth, RECAPTCHA_CONTAINER_ID, {
      size: "invisible",
    });
  }
  return verifier;
}

// Sends an SMS OTP to the E.164 phone and returns a ConfirmationResult.
export async function startPhoneVerification(
  e164Phone: string,
): Promise<ConfirmationResult> {
  if (!auth) throw new Error("Authentication module is not initialized.");
  try {
    return await signInWithPhoneNumber(auth, e164Phone, getRecaptcha());
  } catch (err) {
    // Reset the verifier so a retry starts a fresh challenge instead of reusing a spent one.
    try {
      verifier?.clear();
    } catch {
      /* ignore */
    }
    verifier = null;
    throw err;
  }
}
