"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "./messages/en.json";
import hi from "./messages/hi.json";
import bn from "./messages/bn.json";
import { getPref, setPref } from "@/lib/prefs";

const MESSAGES = { en, hi, bn } as const;
export type Locale = keyof typeof MESSAGES;
export const SUPPORTED_LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "bn", label: "বাংলা" },
];

const LOCALE_KEY = "driver_locale";

const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({
  locale: "en",
  setLocale: () => {},
});

export const useLocaleSwitch = () => useContext(LocaleContext);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  // Restore the persisted locale on mount (survives app restarts — rule #2).
  useEffect(() => {
    void getPref(LOCALE_KEY).then((v) => {
      if (v && v in MESSAGES) setLocaleState(v as Locale);
    });
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    void setPref(LOCALE_KEY, l);
    if (typeof document !== "undefined") document.documentElement.lang = l;
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <NextIntlClientProvider
        locale={locale}
        messages={MESSAGES[locale]}
        timeZone="Asia/Kolkata"
        now={new Date()}
        onError={() => {}}
        getMessageFallback={({ key }) => key}
      >
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}
