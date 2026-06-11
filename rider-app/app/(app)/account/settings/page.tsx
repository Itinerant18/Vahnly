"use client";

import { useEffect, useState } from "react";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { useAuthStore } from "@/lib/store/authStore";

const APP_VERSION = "1.0.0";

type Channel = "push" | "sms" | "email";
const NOTIF_CATS = ["Trip updates", "Promotions", "Safety alerts"] as const;
const CHANNELS: Channel[] = ["push", "sms", "email"];

const LANGS = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "bn", label: "বাংলা" },
];
const THEMES = ["System", "Light", "Dark"] as const;
const UNITS = ["km", "miles"] as const;

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function SettingsPage() {
  const logout = useAuthStore((s) => s.logout);

  const [lang, setLang] = useState("en");
  const [theme, setTheme] = useState<(typeof THEMES)[number]>("Dark");
  const [unit, setUnit] = useState<(typeof UNITS)[number]>("km");
  const [prefs, setPrefs] = useState<Record<string, Record<Channel, boolean>>>(() =>
    Object.fromEntries(NOTIF_CATS.map((c) => [c, { push: true, sms: false, email: false }])),
  );
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    setLang(load("dfu_lang", "en"));
    setTheme(load("dfu_theme", "Dark"));
    setUnit(load("dfu_unit", "km"));
    setPrefs((p) => load("dfu_notif_prefs", p));
  }, []);

  const persist = (key: string, value: unknown) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(value));
  };

  const togglePref = (cat: string, ch: Channel) => {
    setPrefs((p) => {
      const next = { ...p, [cat]: { ...p[cat], [ch]: !p[cat][ch] } };
      persist("dfu_notif_prefs", next);
      return next;
    });
  };

  const openDeviceSettings = () => {
    // Capacitor App plugin would deep-link here; fall back to guidance on web.
    alert("Open your device Settings → Apps → Drivers-for-U to manage permissions.");
  };

  return (
    <AccountScaffold title="Settings">
      {/* Language */}
      <Group title="Language">
        <div className="flex gap-2">
          {LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => {
                setLang(l.code);
                persist("dfu_lang", l.code);
              }}
              className={`flex-1 rounded-xl py-2.5 text-sm ${
                lang === l.code ? "bg-[#FF6B35] text-white" : "bg-[#1E1E1E] text-[#9CA3AF]"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </Group>

      {/* Theme */}
      <Group title="Theme">
        <div className="flex gap-2">
          {THEMES.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTheme(t);
                persist("dfu_theme", t);
              }}
              className={`flex-1 rounded-xl py-2.5 text-sm ${
                theme === t ? "bg-[#FF6B35] text-white" : "bg-[#1E1E1E] text-[#9CA3AF]"
              }`}
            >
              {t}
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
                unit === u ? "bg-[#FF6B35] text-white" : "bg-[#1E1E1E] text-[#9CA3AF]"
              }`}
            >
              {u}
            </button>
          ))}
        </div>
      </Group>

      {/* Notification prefs */}
      <Group title="Notification Preferences">
        <div className="overflow-hidden rounded-2xl bg-[#141414]">
          <div className="flex items-center border-b border-white/6 px-4 py-2.5 text-xs text-[#6B7280]">
            <span className="flex-1">Category</span>
            {CHANNELS.map((ch) => (
              <span key={ch} className="w-12 text-center capitalize">
                {ch}
              </span>
            ))}
          </div>
          {NOTIF_CATS.map((cat) => (
            <div key={cat} className="flex items-center px-4 py-3">
              <span className="flex-1 text-sm text-white">{cat}</span>
              {CHANNELS.map((ch) => (
                <div key={ch} className="flex w-12 justify-center">
                  <button
                    onClick={() => togglePref(cat, ch)}
                    className={`h-5 w-5 rounded-md ${
                      prefs[cat]?.[ch] ? "bg-[#FF6B35]" : "bg-[#3A3A3A]"
                    }`}
                  >
                    {prefs[cat]?.[ch] && <span className="text-xs text-white">✓</span>}
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
          {["Location", "Notifications", "Contacts"].map((p) => (
            <button
              key={p}
              onClick={openDeviceSettings}
              className="flex w-full items-center justify-between rounded-2xl bg-[#141414] px-4 py-3.5"
            >
              <span className="text-sm text-white">{p}</span>
              <span className="text-xs text-[#FF6B35]">Manage →</span>
            </button>
          ))}
        </div>
      </Group>

      {/* Version */}
      <Group title="About">
        <div className="flex items-center justify-between rounded-2xl bg-[#141414] px-4 py-3.5">
          <span className="text-sm text-white">Version {APP_VERSION}</span>
          <button
            onClick={() => alert("You're on the latest version.")}
            className="text-xs font-semibold text-[#FF6B35]"
          >
            Check for updates
          </button>
        </div>
      </Group>

      {/* Delete account */}
      <button
        onClick={() => setShowDelete(true)}
        className="mt-2 w-full rounded-2xl border border-[#EF4444]/40 py-3.5 text-sm font-semibold text-[#EF4444]"
      >
        Delete Account
      </button>

      {showDelete && <DeleteAccountSheet onClose={() => setShowDelete(false)} onConfirm={logout} />}
    </AccountScaffold>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="mb-3 text-sm font-bold text-white">{title}</h2>
      {children}
    </div>
  );
}

function DeleteAccountSheet({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  const [confirmText, setConfirmText] = useState("");
  const ok = confirmText.trim().toUpperCase() === "DELETE";
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/70" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-[#141414] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EF4444]/20 text-2xl">
            ⚠️
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Delete account?</h3>
            <p className="text-xs text-[#EF4444]">This is permanent and cannot be undone.</p>
          </div>
        </div>
        <p className="mb-4 text-sm text-[#9CA3AF]">
          All your trips, wallet balance, and saved data will be erased. Type <b className="text-white">DELETE</b> to
          confirm.
        </p>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="Type DELETE"
          className="w-full rounded-xl bg-[#1E1E1E] px-4 py-3 text-sm text-white outline-none placeholder:text-[#6B7280]"
        />
        <div className="mt-4 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl bg-[#1E1E1E] py-3.5 text-sm font-semibold text-[#9CA3AF]">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!ok}
            className="flex-1 rounded-xl bg-[#EF4444] py-3.5 text-sm font-bold text-white disabled:opacity-40"
          >
            Delete Forever
          </button>
        </div>
        <div className="h-4" />
      </div>
    </div>
  );
}
