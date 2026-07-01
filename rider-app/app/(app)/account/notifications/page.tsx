"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { SkeletonList, EmptyState, ErrorState } from "@/components/account/States";
import { useNotificationStore } from "@/lib/store/notificationStore";
import type { RiderNotificationItem } from "@/lib/api/types";
import { BlurFade } from "@/components/ui/blur-fade";
import { WordRotate } from "@/components/ui/word-rotate";
import { ShineBorder } from "@/components/ui/shine-border";

import { AnimatedIcon } from "@/components/ds/Icon";
import { AnimBell } from "@/assets/icons/animated";

function dayBucket(iso: string): "Today" | "Yesterday" | "Earlier" {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startToday) return "Today";
  if (t >= startToday - 86400000) return "Yesterday";
  return "Earlier";
}

const ORDER = ["Today", "Yesterday", "Earlier"] as const;

export default function NotificationsPage() {
  const notifications = useNotificationStore((s) => s.notifications);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);
  const markRead = useNotificationStore((s) => s.markRead);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = () => {
    setError(false);
    setLoading(true);
    fetchNotifications()
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const markAll = async () => {
    await Promise.all(notifications.filter((n) => !n.is_read).map((n) => markRead(n.id)));
  };

  const groups: Record<string, RiderNotificationItem[]> = {};
  for (const n of notifications) {
    const b = dayBucket(n.created_at);
    (groups[b] ??= []).push(n);
  }

  return (
    <AccountScaffold
      title={<WordRotate words={["Notifications", "Updates", "Alerts"]} duration={3000} />}
      action={
        unreadCount > 0 ? (
          <button onClick={markAll} className="text-xs font-semibold text-content-accent active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]">
            Mark all read
          </button>
        ) : undefined
      }
    >
      {error ? (
        <ErrorState onRetry={load} />
      ) : loading ? (
        <SkeletonList rows={5} height="h-16" />
      ) : (
        <>
          {notifications.length === 0 ? (
            <EmptyState icon={<AnimatedIcon src={AnimBell} size={64} trigger="loop-on-hover" colors="primary:#F59E0B,secondary:#FCD34D" />} title="No notifications yet" message="Trip updates and offers will appear here." />
          ) : (
            <div className="space-y-5">
              {ORDER.filter((b) => groups[b]?.length).map((b) => (
                <BlurFade key={b} delay={0.1}>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-content-tertiary">{b}</p>
                    <div className="space-y-2">
                      {groups[b].map((n) => (
                        <button
                          key={n.id}
                          onClick={() => !n.is_read && markRead(n.id)}
                          className={`group relative block w-full rounded-2xl p-4 overflow-hidden text-left active:scale-[0.99] transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                            n.is_read ? "bg-background-secondary" : "bg-background-tertiary ring-1 ring-border-accent"
                          }`}
                        >
                          <ShineBorder borderWidth={1} duration={8} shineColor="#4A6FA5" className="opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                          <div className="flex items-start gap-2">
                            {!n.is_read && <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-accent-400" />}
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-content-primary">{n.title}</p>
                              <p className="mt-0.5 text-xs text-content-secondary">{n.body}</p>
                              <p className="mt-1 text-[10px] text-content-tertiary">
                                {new Date(n.created_at).toLocaleTimeString("en-IN", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </BlurFade>
              ))}
            </div>
          )}

          <BlurFade delay={0.2}>
            <Link
              href="/account/settings"
              className="mt-6 block rounded-2xl bg-background-secondary py-3.5 text-center text-sm font-semibold text-content-accent active:scale-[0.98] transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
            >
              Notification Preferences →
            </Link>
          </BlurFade>
        </>
      )}
    </AccountScaffold>
  );
}
