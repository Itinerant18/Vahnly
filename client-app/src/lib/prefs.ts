import { Preferences } from "@capacitor/preferences";

// Thin wrapper over Capacitor Preferences (persists on native via the OS key store,
// on web via localStorage). Used for locale, nav-app, and biometric flags so they
// survive app restarts.
export async function getPref(key: string): Promise<string | null> {
  try {
    return (await Preferences.get({ key })).value;
  } catch {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  }
}

export async function setPref(key: string, value: string): Promise<void> {
  try {
    await Preferences.set({ key, value });
  } catch {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  }
}

export async function removePref(key: string): Promise<void> {
  try {
    await Preferences.remove({ key });
  } catch {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  }
}
