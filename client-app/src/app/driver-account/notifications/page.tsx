'use client';

import React, { useState } from 'react';
import { registerDeviceToken, DevicePlatform } from '@/api/client';
import { useAuthStore } from '@/store/useAuthStore';

export default function DriverNotificationsPage() {
  const { token } = useAuthStore();
  const [tab, setTab] = useState<'ALL' | 'TRIPS' | 'EARNINGS' | 'SYSTEM'>('ALL');
  const [logs, setLogs] = useState<string[]>([]);
  const [deviceStatus, setDeviceStatus] = useState<string | null>(null);
  const [notifications, setNotifications] = useState([
    { id: '1', type: 'TRIPS', title: 'New Match Completed', body: 'Ride trp-2209 completed! Payout ₹832.00 added to your account ledger.', date: '2026-06-03 22:10', read: false },
    { id: '2', type: 'EARNINGS', title: 'Withdrawal Settled', body: 'Payout request PAY-8821 for ₹4,500.00 settled instantly to your linked UPI address.', date: '2026-06-01 10:45', read: true },
    { id: '3', type: 'SYSTEM', title: 'KYC Verification Update', body: 'Your Driving License OCR scans have been verified by auto review reviewer nodes.', date: '2026-05-24 14:20', read: true },
    { id: '4', type: 'SYSTEM', title: 'Fatigue Monitoring Alert', body: 'Safety check: Remember to take a rest break after 10 continuous on-duty hours.', date: '2026-05-22 09:00', read: true }
  ]);

  const logNotificationEvent = (action: string, id: string, title: string) => {
    const logStr = `[NOTIFICATION_AUDIT] ${new Date().toISOString()} | Action: ${action} | Notification ID: ${id} | Title: "${title}"`;
    console.log(logStr);
    setLogs((prev) => [logStr, ...prev]);
  };

  const handleMarkAllRead = () => {
    setNotifications((prev) =>
      prev.map((n) => {
        if (!n.read) {
          logNotificationEvent('MARK_READ', n.id, n.title);
        }
        return { ...n, read: true };
      })
    );
    alert('All notifications marked as read.');
  };

  const handleRegisterDevice = async () => {
    if (!token) {
      setDeviceStatus('Sign in again before registering a device token.');
      return;
    }

    const deviceToken = prompt('Paste the FCM/APNS device token for this device:');
    if (!deviceToken) return;

    const platformInput = prompt('Platform type: ANDROID_FCM or IOS_APNS', 'ANDROID_FCM') || 'ANDROID_FCM';
    const platform = platformInput.toUpperCase() as DevicePlatform;
    if (platform !== 'ANDROID_FCM' && platform !== 'IOS_APNS') {
      setDeviceStatus('Unsupported platform type.');
      return;
    }

    try {
      await registerDeviceToken(token, deviceToken, platform);
      setDeviceStatus(`Device token registered for ${platform}.`);
      logNotificationEvent('DEVICE_TOKEN_REGISTERED', 'device-token', platform);
    } catch (err) {
      console.warn('[DriverNotifications] Device token registration failed:', err);
      setDeviceStatus('Device token registration failed.');
    }
  };

  const dismissNotification = (id: string, title: string) => {
    logNotificationEvent('DISMISSED', id, title);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const filtered = tab === 'ALL'
    ? notifications
    : notifications.filter((n) => n.type === tab);

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div className="flex justify-between items-center pb-4 border-b border-zinc-900">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white font-move">Notification Inbox</h2>
          <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Filter alerts, read system updates, or dismiss promo banners</p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleRegisterDevice}
            className="text-zinc-400 hover:text-white text-[9px] font-mono font-bold uppercase tracking-wider cursor-pointer"
          >
            Register device
          </button>
          <button
            onClick={handleMarkAllRead}
            className="text-zinc-400 hover:text-white text-[9px] font-mono font-bold uppercase tracking-wider cursor-pointer"
          >
            Mark all read
          </button>
        </div>
      </div>

      {deviceStatus && (
        <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-3 text-[10px] font-mono text-zinc-400">
          {deviceStatus}
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-900 max-w-sm font-mono text-[9px]">
        {(['ALL', 'TRIPS', 'EARNINGS', 'SYSTEM'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 font-bold uppercase rounded-lg transition-all ${
              tab === t ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-500 italic font-mono">
            No notifications found in this inbox folder.
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              className={`bg-zinc-950 border border-zinc-900 p-5 rounded-2xl flex justify-between gap-4 transition-all relative ${
                !item.read ? 'border-l-4 border-l-white' : ''
              }`}
            >
              <div className="space-y-1.5 text-xs text-zinc-400 leading-relaxed max-w-[85%] font-sans">
                <div className="flex items-center gap-2 font-mono text-[9px]">
                  <span className="bg-zinc-900 text-zinc-500 px-2 py-0.5 rounded uppercase tracking-wider">
                    {item.type}
                  </span>
                  <span className="text-zinc-600">{item.date}</span>
                </div>
                <h4 className="font-bold text-white text-xs">{item.title}</h4>
                <p className="text-[11px] text-zinc-400 font-sans leading-normal">{item.body}</p>
              </div>

              <button
                onClick={() => dismissNotification(item.id, item.title)}
                className="text-zinc-600 hover:text-zinc-400 font-mono text-[8px] uppercase tracking-widest cursor-pointer self-start border border-zinc-900 hover:border-zinc-800 p-1.5 rounded"
              >
                Dismiss
              </button>
            </div>
          ))
        )}
      </div>

      {/* Logs preview panel */}
      {logs.length > 0 && (
        <div className="border-t border-zinc-900 pt-4 text-left font-mono">
          <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">Notification Action logs stream:</span>
          <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-3 max-h-24 overflow-y-auto text-[8px] text-zinc-500 space-y-1 scrollbar-thin">
            {logs.map((lg, i) => (
              <div key={i} className="truncate select-all leading-normal">{lg}</div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
