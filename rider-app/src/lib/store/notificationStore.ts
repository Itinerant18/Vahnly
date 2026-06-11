import { create } from "zustand";
import { accountApi } from "../api/account";
import type { RiderNotificationItem } from "../api/types";

export interface NotificationState {
  notifications: RiderNotificationItem[];
  unreadCount: number;

  fetchNotifications: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  addNotification: (n: RiderNotificationItem) => void;
}

function countUnread(items: RiderNotificationItem[]): number {
  return items.reduce((acc, n) => acc + (n.is_read ? 0 : 1), 0);
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,

  fetchNotifications: async () => {
    const items = await accountApi.notifications();
    set({ notifications: items, unreadCount: countUnread(items) });
  },

  markRead: async (id) => {
    await accountApi.markNotificationRead(id);
    const next = get().notifications.map((n) =>
      n.id === id ? { ...n, is_read: true } : n,
    );
    set({ notifications: next, unreadCount: countUnread(next) });
  },

  // Called from the WebSocket on a rider.notification frame.
  addNotification: (n) => {
    const next = [n, ...get().notifications];
    set({ notifications: next, unreadCount: countUnread(next) });
  },
}));
