"use client";

import React, { useEffect, useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { getDriverNotifications, markNotificationRead, DriverNotification } from "@/api/client";

export default function NotificationsClient() {
  const { token } = useAuthStore();
  const [activeTab, setActiveTab] = useState<"ALL" | "TRIPS" | "EARNINGS" | "PROMOTIONS" | "SYSTEM">("ALL");
  const [notifications, setNotifications] = useState<DriverNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const fallbackNotifications: DriverNotification[] = [
    {
      id: "1",
      category: "EARNINGS",
      title: "Bonus Achieved!",
      body: "Completed 10 trips milestone! ₹500 added to your balance.",
      is_read: false,
      timestamp: "1 hour ago",
    },
    {
      id: "2",
      category: "TRIPS",
      title: "Trip Adjustment Cleared",
      body: "Odometer variance audit finalized by admin. Fare recalculated successfully.",
      is_read: true,
      timestamp: "Yesterday",
    },
  ];

  useEffect(() => {
    if (!token) {
      setNotifications(fallbackNotifications);
      setLoading(false);
      return;
    }

    getDriverNotifications(token)
      .then((data) => {
        // Map the fields if needed, or set directly
        const mapped = data.map((item) => ({
          ...item,
          // Format ISO timestamp if it exists, otherwise keep
          timestamp: item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Recently"
        }));
        setNotifications(mapped);
      })
      .catch((err) => {
        console.warn("Failed to fetch live notifications:", err);
        setNotifications(fallbackNotifications);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token]);

  const tabs: ("ALL" | "TRIPS" | "EARNINGS" | "PROMOTIONS" | "SYSTEM")[] = [
    "ALL", "TRIPS", "EARNINGS", "PROMOTIONS", "SYSTEM"
  ];

  const filteredNotifications = notifications.filter(
    n => activeTab === "ALL" || n.category === activeTab
  );

  const toggleReadStatus = (id: string) => {
    const target = notifications.find(n => n.id === id);
    if (!target || target.is_read) return; // already read — nothing to sync

    // Optimistically mark read, then persist; revert on failure.
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, is_read: true } : n))
    );

    if (!token) return;
    markNotificationRead(token, id).catch((err) => {
      console.warn("Failed to mark notification read:", err);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, is_read: false } : n))
      );
    });
  };

  const handleMarkAllRead = () => {
    const unread = notifications.filter(n => !n.is_read);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    if (!token) return;
    unread.forEach(n => {
      markNotificationRead(token, n.id).catch((err) =>
        console.warn("Failed to mark notification read:", err)
      );
    });
  };

  return (
    <div className="flex flex-col h-full bg-black max-w-md mx-auto rounded-2xl border border-border-opaque overflow-hidden font-mono text-left select-none">
      {/* Header Context Bar */}
      <div className="bg-background-primary px-5 py-5 border-b border-border-opaque flex justify-between items-center">
        <h1 className="text-xs font-bold text-white uppercase tracking-wider">Notifications</h1>
        <button 
          onClick={handleMarkAllRead}
          className="text-[9px] text-content-secondary hover:text-white font-bold uppercase tracking-wider transition cursor-pointer"
        >
          Mark all read
        </button>
      </div>

      {/* Categories Horizontal Scrolling Container */}
      <div className="flex border-b border-border-opaque bg-background-primary overflow-x-auto divide-x divide-border-opaque text-center scrollbar-none text-[8px] font-bold uppercase tracking-wider">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 min-w-[70px] py-3.5 transition-all cursor-pointer ${
              activeTab === tab ? "bg-white text-black font-extrabold" : "text-content-tertiary bg-black hover:text-content-secondary hover:bg-background-secondary"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Notifications Render List */}
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 bg-black min-h-[400px]">
        {loading ? (
          <div className="text-center text-[10px] text-content-tertiary py-12 uppercase tracking-widest animate-pulse">
            Syncing inbox alerts...
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="text-center text-[10px] text-content-tertiary py-12 uppercase tracking-widest italic">
            No notifications found
          </div>
        ) : (
          filteredNotifications.map(notification => (
            <div
              key={notification.id}
              onClick={() => toggleReadStatus(notification.id)}
              className={`p-5 bg-background-primary rounded-2xl border border-border-opaque relative shadow-xl cursor-pointer transition-all hover:scale-[1.01] hover:border-border-opaque ${
                !notification.is_read ? "border-l-2 border-l-white font-medium" : "opacity-60"
              }`}
            >
              <div className="flex justify-between items-start mb-2 gap-3">
                <h4 className="text-[11px] font-bold text-white uppercase tracking-tight leading-snug">{notification.title}</h4>
                <span className="text-[7px] bg-background-secondary text-content-tertiary font-extrabold px-2 py-0.5 rounded uppercase tracking-wider">
                  {notification.category}
                </span>
              </div>
              <p className="text-[10px] text-content-secondary font-sans leading-relaxed mb-2.5">{notification.body}</p>
              <span className="text-[8px] text-content-tertiary font-bold uppercase">{notification.timestamp}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
