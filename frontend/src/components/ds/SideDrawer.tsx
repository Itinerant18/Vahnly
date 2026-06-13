import React, { useEffect } from 'react';

interface SideDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: number;
  footer?: React.ReactNode;
}

export function SideDrawer({ isOpen, onClose, title, children, width = 480, footer }: SideDrawerProps) {
  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`fixed right-0 top-0 bottom-0 z-50 flex flex-col bg-background-primary border-l border-border-opaque shadow-elevation-3 transition-transform duration-300 ease-out-quint ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ width: typeof window !== 'undefined' && window.innerWidth < 640 ? '100%' : `${width}px` }}
      >
        {/* Header */}
        <div className="h-14 flex-shrink-0 border-b border-border-opaque px-700 flex items-center justify-between">
          <h2 className="text-heading-medium text-content-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="w-8 h-8 rounded-pill flex items-center justify-center text-content-tertiary hover:bg-background-secondary hover:text-content-primary transition-base cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-700 py-600">
          {children}
        </div>

        {/* Footer (optional) */}
        {footer && (
          <div className="flex-shrink-0 border-t border-border-opaque px-700 py-400">
            {footer}
          </div>
        )}
      </div>
    </>
  );
}
