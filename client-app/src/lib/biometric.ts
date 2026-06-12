// Biometric login via the WebAuthn platform authenticator (Touch ID / Face ID /
// Windows Hello). Works in the local web build without any native plugin and
// degrades gracefully on devices/browsers that don't support it (rule #3). When the
// app is later wrapped for native, a Capacitor biometric plugin can swap in behind
// this same interface.

// isBiometricAvailable reports whether a platform authenticator (built-in
// fingerprint/face) is present.
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    if (typeof window === "undefined" || !("PublicKeyCredential" in window)) return false;
    const pkc = window.PublicKeyCredential as unknown as {
      isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
    };
    if (typeof pkc.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return false;
    return await pkc.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// enrollBiometric triggers the actual OS biometric prompt to register a platform
// credential. Returns true only on a successful, user-verified enrolment so the
// caller persists the "enabled" flag only when the user really completed it.
export async function enrollBiometric(driverHandle: string): Promise<boolean> {
  if (!(await isBiometricAvailable())) return false;
  try {
    const challenge = window.crypto.getRandomValues(new Uint8Array(32));
    const userId = new TextEncoder().encode(driverHandle || "driver").slice(0, 64);
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "Drivers-For-U" },
        user: { id: userId, name: driverHandle || "driver", displayName: "Driver" },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
        timeout: 60000,
      },
    });
    return Boolean(cred);
  } catch {
    // User cancelled or the device rejected the ceremony — treat as not enabled.
    return false;
  }
}
