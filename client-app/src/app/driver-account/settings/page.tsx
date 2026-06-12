'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleSwitch, SUPPORTED_LOCALES, type Locale } from '@/i18n/LocaleProvider';
import { getPref, setPref } from '@/lib/prefs';
import { isBiometricAvailable, enrollBiometric } from '@/lib/biometric';
import {
  updateLanguage, updateNotificationPrefs, changeDriverPassword, deleteDriverAccount,
  type NotificationPrefs,
} from '@/api/client';

const NAV_KEY = 'preferred_nav';
const BIO_KEY = 'biometric_enabled';
type NavApp = 'GOOGLE' | 'MAPS' | 'WAZE';

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`h-5 w-10 rounded-full transition relative p-0.5 ${on ? 'bg-white' : 'bg-zinc-800'}`}>
      <div className={`h-4 w-4 rounded-full transition-transform ${on ? 'translate-x-5 bg-black' : 'translate-x-0 bg-zinc-400'}`} />
    </button>
  );
}

export default function DriverSettingsPage() {
  const t = useTranslations('settings');
  const router = useRouter();
  const { token, logout } = useAuthStore();
  const { locale, setLocale } = useLocaleSwitch();

  const [prefs, setPrefs] = useState<NotificationPrefs>({ trip_offers: true, earnings: true, promotions: true, safety: true });
  const [navApp, setNavApp] = useState<NavApp>('GOOGLE');
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [pwd, setPwd] = useState({ current: '', next: '' });
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);
  const [deleteText, setDeleteText] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    void getPref(NAV_KEY).then((v) => { if (v) setNavApp(v as NavApp); });
    void getPref(BIO_KEY).then((v) => setBioEnabled(v === 'true'));
    void isBiometricAvailable().then(setBioAvailable);
  }, []);

  const flash = () => { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1500); };

  const onLanguage = async (l: Locale) => {
    setLocale(l); // persists + re-renders immediately
    if (token) { try { await updateLanguage(token, l); } catch { /* local pref still applies */ } }
  };

  const savePrefs = async (next: NotificationPrefs) => {
    setPrefs(next);
    if (token) { try { await updateNotificationPrefs(token, next); flash(); } catch { /* ignore */ } }
  };

  const onNav = (app: NavApp) => { setNavApp(app); void setPref(NAV_KEY, app); flash(); };

  const onBiometric = async () => {
    if (!bioAvailable) return;
    if (!bioEnabled) {
      // Trigger the real OS biometric prompt; only persist on success.
      const ok = await enrollBiometric(token ?? 'driver');
      if (!ok) { alert(t('biometricUnavailable')); return; }
      setBioEnabled(true);
      void setPref(BIO_KEY, 'true');
    } else {
      setBioEnabled(false);
      void setPref(BIO_KEY, 'false');
    }
    flash();
  };

  const onChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setPwdMsg(null);
    try {
      await changeDriverPassword(token, pwd.current, pwd.next);
      setPwd({ current: '', next: '' });
      setPwdMsg('✓ ' + t('saved'));
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      setPwdMsg(status === 401 ? '⚠ Current password incorrect.' : '⚠ Could not change password.');
    }
  };

  const onDelete = async () => {
    if (!token || deleteText !== 'DELETE') return;
    try {
      await deleteDriverAccount(token);
      logout();
      router.replace('/login');
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      alert(status === 409 ? 'Finish your active trip before deleting.' : 'Could not delete account.');
    }
  };

  const navOptions: NavApp[] = ['GOOGLE', 'MAPS', 'WAZE'];

  return (
    <div className="space-y-6 text-left pb-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-white font-move">{t('title')}</h2>
        {savedFlash && <span className="text-[10px] font-mono text-emerald-400">{t('saved')}</span>}
      </div>

      {/* Language */}
      <section className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">{t('language')}</h4>
        <div className="flex gap-2">
          {SUPPORTED_LOCALES.map((l) => (
            <button key={l.code} onClick={() => onLanguage(l.code)}
              className={`flex-1 py-2 rounded-lg text-xs font-mono ${locale === l.code ? 'bg-white text-black font-bold' : 'bg-zinc-900 text-zinc-400'}`}>
              {l.label}
            </button>
          ))}
        </div>
      </section>

      {/* Notification preferences */}
      <section className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">{t('notifications')}</h4>
        {([['trip_offers', t('tripOffers')], ['earnings', t('earnings')], ['promotions', t('promotions')], ['safety', t('safety')]] as const).map(([key, label]) => (
          <div key={key} className="flex justify-between items-center">
            <span className="text-xs font-mono text-zinc-300">{label}</span>
            <Toggle on={prefs[key]} onClick={() => savePrefs({ ...prefs, [key]: !prefs[key] })} />
          </div>
        ))}
      </section>

      {/* Navigation app */}
      <section className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">{t('navApp')}</h4>
        <div className="flex gap-2">
          {navOptions.map((app) => (
            <button key={app} onClick={() => onNav(app)}
              className={`flex-1 py-2 rounded-lg text-xs font-mono ${navApp === app ? 'bg-white text-black font-bold' : 'bg-zinc-900 text-zinc-400'}`}>
              {app}
            </button>
          ))}
        </div>
      </section>

      {/* Biometric */}
      <section className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 flex justify-between items-center">
        <div>
          <span className="text-xs font-mono text-zinc-300 block">{t('biometric')}</span>
          {!bioAvailable && <span className="text-[9px] font-mono text-zinc-600">{t('biometricUnavailable')}</span>}
        </div>
        <Toggle on={bioEnabled && bioAvailable} onClick={onBiometric} />
      </section>

      {/* Change password */}
      <section className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-3">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">{t('changePassword')}</h4>
        <form onSubmit={onChangePassword} className="space-y-3">
          <input type="password" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} placeholder={t('currentPassword')} required
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs text-white font-mono" />
          <input type="password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} placeholder={t('newPassword')} required minLength={8}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs text-white font-mono" />
          {pwdMsg && <p className="text-[10px] font-mono text-zinc-400">{pwdMsg}</p>}
          <button type="submit" className="w-full bg-white text-black rounded-xl py-2.5 text-[10px] font-bold uppercase">{t('save')}</button>
        </form>
      </section>

      {/* Danger zone */}
      <section className="bg-red-500/5 border border-red-500/30 rounded-2xl p-5 space-y-3">
        <h4 className="text-xs font-bold text-red-300 font-mono uppercase tracking-wider">{t('dangerZone')}</h4>
        <p className="text-[10px] font-mono text-zinc-400 leading-relaxed">{t('deleteWarning')}</p>
        <input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder={t('typeDelete')}
          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-white font-mono" />
        <button onClick={onDelete} disabled={deleteText !== 'DELETE'}
          className="w-full bg-red-500/20 text-red-300 border border-red-500/40 rounded-xl py-2.5 text-[10px] font-bold uppercase disabled:opacity-40 disabled:cursor-not-allowed">
          {t('confirmDelete')}
        </button>
      </section>
    </div>
  );
}
