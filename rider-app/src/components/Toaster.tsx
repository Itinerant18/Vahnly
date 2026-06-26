"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useToastStore, type ToastType } from "@/lib/store/useToastStore";

const TYPE_STYLE: Record<ToastType, { container: string; icon: string }> = {
  success: { container: "bg-surface-positive border-positive-200 text-content-positive", icon: "✓" },
  error: { container: "bg-surface-negative border-negative-200 text-content-negative", icon: "✕" },
  info: { container: "bg-background-secondary border-border-opaque text-content-primary", icon: "ℹ" },
};

export const Toaster: React.FC = () => {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      className="fixed bottom-4 inset-x-0 z-[1000001] flex flex-col items-center gap-2 px-4 pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const style = TYPE_STYLE[toast.type];
          return (
            <motion.button
              key={toast.id}
              type="button"
              onClick={() => dismiss(toast.id)}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              role="status"
              className={`pointer-events-auto w-full max-w-sm flex items-start gap-2.5 rounded-xl border
                px-4 py-3 text-left text-xs shadow-elevation-3 cursor-pointer ${style.container}`}
            >
              <span className="text-sm leading-none mt-0.5">{style.icon}</span>
              <span className="flex-1 leading-snug">{toast.message}</span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
