'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';

export default function RiderNotificationsPage() {
  const t = useTranslations('accountNotifications');
  const [logs, setLogs] = useState<string[]>([]);
  const [notifications, setNotifications] = useState([
    { id: '1', type: 'TRIP', title: 'Driver Assigned', body: 'Pilot Aniket Karmakar is en route to guide your Audi A6 Sedan. ETA: 4 mins.', date: '2026-06-03 14:05', read: false },
    { id: '2', type: 'PROMO', title: 'Weekend Surcharge Exemption', body: 'Use coupon FREE50 to save ₹100 on city hourly transits this weekend!', date: '2026-06-02 10:00', read: true },
    { id: '3', type: 'SYSTEM', title: 'Invoice Dispatched', body: 'Tax receipt statement for ride trp-2122 (₹3,200.00) dispatched to email address.', date: '2026-06-02 09:30', read: true }
  ]);

  const [pushTrip, setPushTrip] = useState(true);
  const [smsTrip, setSmsTrip] = useState(true);
  const [emailTrip, setEmailTrip] = useState(false);

  const logEvent = (action: string, id: string, title: string) => {
    const str = `[RIDER_ALERT_LOG] ${new Date().toISOString()} | Action: ${action} | Alert ID: ${id} | Title: "${title}"`;
    console.log(str);
    setLogs((prev) => [str, ...prev]);
  };

  const handleMarkAllRead = () => {
    setNotifications((prev) =>
      prev.map((n) => {
        if (!n.read) logEvent('MARK_READ', n.id, n.title);
        return { ...n, read: true };
      })
    );
    alert(t('allMarkedRead'));
  };

  const handleDelete = (id: string, title: string) => {
    logEvent('DELETED', id, title);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div className="flex justify-between items-center pb-4 border-b border-border-opaque">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white font-move">{t('title')}</h2>
          <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">{t('subtitle')}</p>
        </div>

        <button
          onClick={handleMarkAllRead}
          className="text-content-secondary hover:text-white text-[9px] font-mono font-bold uppercase tracking-wider"
        >
          {t('markAllRead')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Alerts Inbox list (Left 2 columns on desktop) */}
        <div className="md:col-span-2 space-y-3">
          {notifications.length === 0 ? (
            <div className="py-8 text-center text-xs text-content-tertiary italic font-mono">
              {t('inboxEmpty')}
            </div>
          ) : (
            notifications.map((item) => (
              <div
                key={item.id}
                className={`bg-background-primary border border-border-opaque p-5 rounded-2xl flex justify-between gap-4 transition-all relative ${
                  !item.read ? 'border-l-4 border-l-white' : ''
                }`}
              >
                <div className="space-y-1.5 text-xs text-content-secondary leading-relaxed max-w-[85%] font-sans">
                  <div className="flex items-center gap-2 font-mono text-[9px]">
                    <span className="bg-background-secondary text-content-tertiary px-2 py-0.5 rounded uppercase tracking-wider">
                      {item.type}
                    </span>
                    <span className="text-content-tertiary">{item.date}</span>
                  </div>
                  <h4 className="font-bold text-white text-xs font-sans">{item.title}</h4>
                  <p className="text-[11px] text-content-secondary font-sans leading-normal">{item.body}</p>
                </div>

                <button
                  onClick={() => handleDelete(item.id, item.title)}
                  className="text-content-tertiary hover:text-content-secondary font-mono text-[8px] uppercase tracking-widest cursor-pointer self-start border border-border-opaque hover:border-border-opaque p-1.5 rounded"
                >
                  {t('dismiss')}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Preferences settings */}
        <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-4 h-max">
          <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
            {t('alertPreferences')}
          </h4>

          <div className="space-y-4 text-xs font-mono text-content-secondary">
            <div className="flex justify-between items-center border-b border-border-opaque pb-2">
              <span className="text-white font-sans font-medium">{t('pushNotifications')}</span>
              <button
                type="button"
                onClick={() => setPushTrip(!pushTrip)}
                className={`h-5 w-10 rounded-full transition relative p-0.5 ${pushTrip ? 'bg-white' : 'bg-background-tertiary'}`}
              >
                <div className={`h-4 w-4 rounded-full shadow transition-transform ${pushTrip ? 'translate-x-5 bg-black' : 'translate-x-0 bg-background-tertiary'}`} />
              </button>
            </div>

            <div className="flex justify-between items-center border-b border-border-opaque pb-2">
              <span className="text-white font-sans font-medium">{t('smsTextCodes')}</span>
              <button
                type="button"
                onClick={() => setSmsTrip(!smsTrip)}
                className={`h-5 w-10 rounded-full transition relative p-0.5 ${smsTrip ? 'bg-white' : 'bg-background-tertiary'}`}
              >
                <div className={`h-4 w-4 rounded-full shadow transition-transform ${smsTrip ? 'translate-x-5 bg-black' : 'translate-x-0 bg-background-tertiary'}`} />
              </button>
            </div>

            <div className="flex justify-between items-center border-b border-border-opaque pb-2">
              <span className="text-white font-sans font-medium">{t('emailNewsletter')}</span>
              <button
                type="button"
                onClick={() => setEmailTrip(!emailTrip)}
                className={`h-5 w-10 rounded-full transition relative p-0.5 ${emailTrip ? 'bg-white' : 'bg-background-tertiary'}`}
              >
                <div className={`h-4 w-4 rounded-full shadow transition-transform ${emailTrip ? 'translate-x-5 bg-black' : 'translate-x-0 bg-background-tertiary'}`} />
              </button>
            </div>
          </div>
        </div>

      </div>

      {/* Audit Log preview */}
      {logs.length > 0 && (
        <div className="border-t border-border-opaque pt-4 text-left font-mono">
          <span className="text-[8px] font-bold text-content-tertiary uppercase tracking-widest block mb-2">{t('deliveryAudit')}</span>
          <div className="bg-background-primary border border-border-opaque rounded-xl p-3 max-h-24 overflow-y-auto text-[8px] text-content-tertiary space-y-1 scrollbar-thin">
            {logs.map((lg, i) => (
              <div key={i} className="truncate select-all leading-normal">{lg}</div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
