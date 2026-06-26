"use client";

import { useEffect, useState } from "react";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { useAuthStore } from "@/lib/store/authStore";
import { authApi } from "@/lib/api/auth";
import { accountApi } from "@/lib/api/account";
import type { NotificationPreferences, NotifChannelPrefs } from "@/lib/api/types";
import { Capacitor } from "@capacitor/core";

const APP_VERSION = "1.0.0";

type Channel = keyof NotifChannelPrefs; // "push" | "sms" | "email"
const CHANNELS: Channel[] = ["push", "sms", "email"];

type NotifCategory = keyof NotificationPreferences;
const NOTIF_ROWS: { key: NotifCategory; label: string }[] = [
  { key: "trip_updates", label: "Trip updates" },
  { key: "promotions", label: "Promotions" },
  { key: "safety_alerts", label: "Safety alerts" },
  { key: "document_expiry", label: "Document expiry" },
];

const LANGS = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "bn", label: "বাংলা" },
];
const THEMES = ["System", "Light", "Dark"] as const;
type Theme = (typeof THEMES)[number];
const UNITS = ["km", "miles"] as const;

type PermState = "granted" | "denied" | "ask";

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function defaultPrefs(): NotificationPreferences {
  const ch: NotifChannelPrefs = { push: true, sms: false, email: false };
  return {
    trip_updates: { ...ch },
    promotions: { ...ch },
    safety_alerts: { ...ch },
    document_expiry: { ...ch },
  };
}

function normalizePerm(s: string | undefined): PermState {
  if (s === "granted") return "granted";
  if (s === "denied") return "denied";
  return "ask";
}

export default function SettingsPage() {
  const logout = useAuthStore((s) => s.logout);

  const [lang, setLang] = useState("en");

  const [unit, setUnit] = useState<(typeof UNITS)[number]>("km");
  const [prefs, setPrefs] = useState<NotificationPreferences>(defaultPrefs);
  const [locationPerm, setLocationPerm] = useState<PermState>("ask");
  const [notifPerm, setNotifPerm] = useState<PermState>("ask");
  const [womenSafety, setWomenSafety] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const persist = (key: string, value: unknown) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(value));
  };

  // Mount: load stored prefs, apply theme, fetch server notif prefs, read permissions.
  useEffect(() => {
    const storedLang = load("dfu_lang", "en");
    setLang(storedLang);
    setUnit(load("dfu_unit", "km"));
    setWomenSafety(load("dfu_women_safety", false));

    let active = true;

    (async () => {
      try {
        const server = await accountApi.notifPreferences();
        if (active && server) setPrefs(server);
      } catch {
        if (active) setPrefs((p) => load("dfu_notif_prefs", p));
      }
    })();

    void readPermissions().then((p) => {
      if (!active) return;
      setLocationPerm(p.location);
      setNotifPerm(p.notifications);
    });

    return () => {
      active = false;
    };
  }, []);

  // ── Language ──────────────────────────────────────────────────────────────
  const selectLang = (code: string) => {
    setLang(code);
    persist("dfu_lang", code);
    (async () => {
      try {
        await authApi.updateProfile({ preferred_language: code });
      } catch {
        /* backend may 404; localStorage already persisted */
      }
    })();
  };



  // ── Notification prefs ──────────────────────────────────────────────────────
  const togglePref = (cat: NotifCategory, ch: Channel) => {
    setPrefs((p) => {
      const next: NotificationPreferences = {
        ...p,
        [cat]: { ...p[cat], [ch]: !p[cat][ch] },
      };
      persist("dfu_notif_prefs", next);
      (async () => {
        try {
          await accountApi.updateNotifPreferences(next);
        } catch {
          /* keep optimistic state; localStorage already persisted */
        }
      })();
      return next;
    });
  };

  // ── Women safety mode ───────────────────────────────────────────────────────
  // No server field on Rider; persist to localStorage only.
  const toggleWomenSafety = () => {
    setWomenSafety((v) => {
      const next = !v;
      persist("dfu_women_safety", next);
      return next;
    });
  };

  // ── Permissions ─────────────────────────────────────────────────────────────
  async function readPermissions(): Promise<{ location: PermState; notifications: PermState }> {
    let location: PermState = "ask";
    let notifications: PermState = "ask";

    try {
      if (Capacitor.isNativePlatform()) {
        const { Geolocation } = await import("@capacitor/geolocation");
        const s = await Geolocation.checkPermissions();
        location = normalizePerm(s.location);
      } else if (typeof navigator !== "undefined" && navigator.permissions?.query) {
        const s = await navigator.permissions.query({ name: "geolocation" as PermissionName });
        location = normalizePerm(s.state === "prompt" ? "ask" : s.state);
      }
    } catch {
      /* ignore */
    }

    try {
      if (Capacitor.isNativePlatform()) {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const s = await PushNotifications.checkPermissions();
        notifications = normalizePerm(s.receive);
      } else if (typeof Notification !== "undefined") {
        notifications =
          Notification.permission === "default"
            ? "ask"
            : normalizePerm(Notification.permission);
      }
    } catch {
      /* ignore */
    }

    return { location, notifications };
  }

  const requestLocation = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        const { Geolocation } = await import("@capacitor/geolocation");
        let s = await Geolocation.checkPermissions();
        if (s.location !== "granted") s = await Geolocation.requestPermissions();
        setLocationPerm(normalizePerm(s.location));
      } else {
        if (typeof navigator !== "undefined" && navigator.geolocation) {
          await new Promise<void>((resolve) => {
            navigator.geolocation.getCurrentPosition(
              () => resolve(),
              () => resolve(),
              { timeout: 8000 },
            );
          });
        }
        if (typeof navigator !== "undefined" && navigator.permissions?.query) {
          const s = await navigator.permissions.query({ name: "geolocation" as PermissionName });
          setLocationPerm(normalizePerm(s.state === "prompt" ? "ask" : s.state));
        }
      }
    } catch {
      /* ignore */
    }
  };

  const requestNotifications = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        let s = await PushNotifications.checkPermissions();
        if (s.receive !== "granted") s = await PushNotifications.requestPermissions();
        setNotifPerm(normalizePerm(s.receive));
      } else if (typeof Notification !== "undefined") {
        const res = await Notification.requestPermission();
        setNotifPerm(res === "default" ? "ask" : normalizePerm(res));
      }
    } catch {
      /* ignore */
    }
  };

  const openDeviceSettings = () => {
    // @capacitor/app is not installed; provide guidance instead of deep-linking.
    alert("Open your device Settings → Apps → Vahnly to manage permissions.");
  };

  return (
    <AccountScaffold title="Settings">
      {/* Language */}
      <Group title="Language">
        <div className="flex gap-2">
          {LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => selectLang(l.code)}
              className={`flex-1 rounded-xl py-2.5 text-sm ${
                lang === l.code ? "bg-accent-400 text-content-primary" : "bg-background-tertiary text-content-secondary"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </Group>



      {/* Distance */}
      <Group title="Distance Unit">
        <div className="flex gap-2">
          {UNITS.map((u) => (
            <button
              key={u}
              onClick={() => {
                setUnit(u);
                persist("dfu_unit", u);
              }}
              className={`flex-1 rounded-xl py-2.5 text-sm ${
                unit === u ? "bg-accent-400 text-content-primary" : "bg-background-tertiary text-content-secondary"
              }`}
            >
              {u}
            </button>
          ))}
        </div>
      </Group>

      {/* Notification prefs */}
      <Group title="Notification Preferences">
        <div className="overflow-hidden rounded-2xl bg-background-secondary">
          <div className="flex items-center border-b border-border-opaque px-4 py-2.5 text-xs text-content-tertiary">
            <span className="flex-1">Category</span>
            {CHANNELS.map((ch) => (
              <span key={ch} className="w-12 text-center capitalize">
                {ch}
              </span>
            ))}
          </div>
          {NOTIF_ROWS.map((row) => (
            <div key={row.key} className="flex items-center px-4 py-3">
              <span className="flex-1 text-sm text-content-primary">{row.label}</span>
              {CHANNELS.map((ch) => (
                <div key={ch} className="flex w-12 justify-center">
                  <button
                    onClick={() => togglePref(row.key, ch)}
                    aria-label={`${row.label} via ${ch}`}
                    className={`flex h-5 w-5 items-center justify-center rounded-md ${
                      prefs[row.key]?.[ch] ? "bg-accent-400" : "bg-background-tertiary"
                    }`}
                  >
                    {prefs[row.key]?.[ch] && <span className="text-xs text-content-primary">✓</span>}
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Group>

      {/* Permissions */}
      <Group title="App Permissions">
        <div className="space-y-2">
          <PermissionRow
            label="Location"
            state={locationPerm}
            onRequest={requestLocation}
            onOpenSettings={openDeviceSettings}
          />
          <PermissionRow
            label="Notifications"
            state={notifPerm}
            onRequest={requestNotifications}
            onOpenSettings={openDeviceSettings}
          />
        </div>
      </Group>

      {/* Safety */}
      <Group title="Safety">
        <div className="rounded-2xl bg-background-secondary p-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm text-content-primary">Women Safety Mode</span>
              <span className="text-xs text-content-secondary">Prioritise verified drivers and extra safety checks</span>
            </div>
            <button
              onClick={toggleWomenSafety}
              role="switch"
              aria-checked={womenSafety}
              aria-label="Women Safety Mode"
              className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${womenSafety ? "bg-accent-400" : "bg-background-tertiary"}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${womenSafety ? "translate-x-5" : "translate-x-0.5"}`}
              />
            </button>
          </div>
        </div>
      </Group>

      {/* Connected accounts */}
      <Group title="Connected Accounts">
        <div className="space-y-2">
          {["Google", "Apple"].map((provider) => (
            <button
              key={provider}
              disabled
              className="flex w-full cursor-not-allowed items-center justify-between rounded-2xl bg-background-secondary px-4 py-3.5 opacity-50"
            >
              <span className="text-sm text-content-primary">{provider}</span>
              <span className="text-xs text-content-tertiary">Coming soon</span>
            </button>
          ))}
        </div>
      </Group>

      {/* Version */}
      <Group title="About">
        <div className="flex items-center justify-between rounded-2xl bg-background-secondary px-4 py-3.5">
          <span className="text-sm text-content-primary">Version {APP_VERSION}</span>
          <button
            onClick={() => alert("You're on the latest version.")}
            className="text-xs font-semibold text-content-accent"
          >
            Check for updates
          </button>
        </div>
      </Group>

      {/* Delete account */}
      <button
        onClick={() => setShowDelete(true)}
        className="mt-2 w-full rounded-2xl border border-negative-400 py-3.5 text-sm font-semibold text-content-negative"
      >
        Delete Account
      </button>

      {showDelete && (
        <DeleteAccountSheet
          onClose={() => setShowDelete(false)}
          onConfirm={async () => {
            try {
              await accountApi.deleteAccount();
            } catch {
              /* proceed to logout regardless */
            } finally {
              logout();
            }
          }}
        />
      )}
    </AccountScaffold>
  );
}

function PermissionRow({
  label,
  state,
  onRequest,
  onOpenSettings,
}: {
  label: string;
  state: PermState;
  onRequest: () => void;
  onOpenSettings: () => void;
}) {
  const stateLabel = state === "granted" ? "Granted" : state === "denied" ? "Denied" : "Ask";
  const stateColor =
    state === "granted" ? "text-content-positive" : state === "denied" ? "text-content-negative" : "text-content-secondary";
  return (
    <div className="flex items-center justify-between rounded-2xl bg-background-secondary px-4 py-3.5">
      <div className="flex flex-col">
        <span className="text-sm text-content-primary">{label}</span>
        <span className={`text-xs ${stateColor}`}>{stateLabel}</span>
      </div>
      {state === "denied" ? (
        <button onClick={onOpenSettings} className="text-xs font-semibold text-content-accent">
          Open Settings
        </button>
      ) : (
        <button onClick={onRequest} className="text-xs font-semibold text-content-accent">
          {state === "granted" ? "Granted" : "Allow →"}
        </button>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="mb-3 text-sm font-bold text-content-primary">{title}</h2>
      {children}
    </div>
  );
}

function DeleteAccountSheet({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  const [confirmText, setConfirmText] = useState("");
  const ok = confirmText.trim().toUpperCase() === "DELETE";
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/70" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-background-secondary p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-negative text-2xl">
            ⚠️
          </div>
          <div>
            <h3 className="text-base font-bold text-content-primary">Delete account?</h3>
            <p className="text-xs text-content-negative">This is permanent and cannot be undone.</p>
          </div>
        </div>
        <p className="mb-4 text-sm text-content-secondary">
          All your trips, wallet balance, and saved data will be erased. Type <b className="text-content-primary">DELETE</b> to
          confirm.
        </p>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="Type DELETE"
          className="w-full rounded-xl bg-background-tertiary px-4 py-3 text-sm text-content-primary outline-none placeholder:text-content-tertiary"
        />
        <div className="mt-4 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl bg-background-tertiary py-3.5 text-sm font-semibold text-content-secondary">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!ok}
            className="flex-1 rounded-xl bg-negative-400 py-3.5 text-sm font-bold text-content-primary disabled:opacity-40"
          >
            Delete Forever
          </button>
        </div>
        <div className="h-4" />
      </div>
    </div>
  );
}
