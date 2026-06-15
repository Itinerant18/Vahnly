import { Capacitor } from "@capacitor/core";
import { auth, googleProvider } from "./firebase";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";

/**
 * Returns a Google-issued OAuth ID token (issuer accounts.google.com) to send to the backend
 * `POST /api/v1/rider/auth/login/google` verifier.
 *
 * - Native (Capacitor iOS/Android): uses `@capacitor-firebase/authentication`, which drives
 *   the platform Google Sign-In SDK.
 * - Web: uses the Firebase JS `signInWithPopup` flow.
 */
export async function getGoogleIdToken(): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const { FirebaseAuthentication } = await import(
      "@capacitor-firebase/authentication"
    );
    const result = await FirebaseAuthentication.signInWithGoogle();
    const idToken = result.credential?.idToken;
    if (!idToken) {
      throw new Error("Native Google sign-in returned no ID token.");
    }
    return idToken;
  }

  if (!auth) {
    throw new Error("Authentication module is not initialized.");
  }
  const result = await signInWithPopup(auth, googleProvider);
  const idToken = GoogleAuthProvider.credentialFromResult(result)?.idToken;
  if (!idToken) {
    throw new Error("No Google ID token found in credential.");
  }
  return idToken;
}
