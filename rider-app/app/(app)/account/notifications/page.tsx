"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { SkeletonList, EmptyState, ErrorState } from "@/components/account/States";
import { useNotificationStore } from "@/lib/store/notificationStore";
import type { RiderNotificationItem } from "@/lib/api/types";

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
      title="Notifications"
      action={
        unreadCount > 0 ? (
          <button onClick={markAll} className="text-xs font-semibold text-content-accent">
            Mark all read
          </button>
        ) : undefined
      }
    >
      {error ? (
        <ErrorState onRetry={load} />
      ) : loading ? (
        <SkeletonList rows={5} height="h-16" />
      ) : notifications.length === 0 ? (
        <EmptyState icon="🔔" title="No notifications yet" message="Trip updates and offers will appear here." />
      ) : (
        <div className="space-y-5">
          {ORDER.filter((b) => groups[b]?.length).map((b) => (
            <div key={b}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-content-tertiary">{b}</p>
              <div className="space-y-2">
                {groups[b].map((n) => (
                  <button
                    key={n.id}
                    onClick={() => !n.is_read && markRead(n.id)}
                    className={`block w-full rounded-2xl p-4 text-left ${
                      n.is_read ? "bg-background-secondary" : "bg-background-tertiary ring-1 ring-border-accent"
                    }`}
                  >
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
          ))}
        </div>
      )}

      <Link
        href="/account/settings"
        className="mt-6 block rounded-2xl bg-background-secondary py-3.5 text-center text-sm font-semibold text-content-accent"
      >
        Notification Preferences →
      </Link>
    </AccountScaffold>
  );
}
