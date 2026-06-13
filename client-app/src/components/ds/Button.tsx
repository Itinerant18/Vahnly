'use client';
import React from 'react';

type Variant = 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'accent';
type Size = 'compact' | 'default' | 'large';

export interface ButtonProps {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  loading?: boolean;
  disabled?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  /** Pin to bottom of screen as mobile primary CTA */
  pinned?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-interactive-primary text-interactive-primary-text hover:opacity-90 active:opacity-75 disabled:bg-background-tertiary disabled:text-content-secondary',
  secondary:
    'bg-background-tertiary text-content-primary border border-border-opaque hover:bg-background-tertiary active:bg-background-tertiary disabled:opacity-40',
  tertiary:
    'bg-transparent text-content-primary hover:bg-background-secondary active:bg-background-tertiary disabled:opacity-40',
  destructive:
    'bg-negative-400 text-white hover:bg-negative-500 active:bg-negative-600 disabled:opacity-40',
  accent:
    'bg-accent-400 text-white hover:bg-accent-500 active:bg-accent-600 disabled:opacity-40',
};

const sizeClasses: Record<Size, string> = {
  compact: 'h-8 px-300 text-label-small',
  default: 'h-12 px-500 text-label-large',
  large: 'h-14 px-500 text-label-large',
};

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export function Button({
  variant = 'primary',
  size = 'default',
  fullWidth = false,
  loading = false,
  disabled = false,
  leftIcon,
  rightIcon,
  children,
  onClick,
  type = 'button',
  className = '',
  pinned = false,
}: ButtonProps) {
  const base = [
    'inline-flex items-center justify-center gap-300 rounded-sm font-body font-medium',
    'transition-base',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2',
    variantClasses[variant],
    sizeClasses[size],
    fullWidth ? 'w-full' : '',
    disabled || loading ? 'cursor-not-allowed' : 'cursor-pointer',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const button = (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={base}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {loading ? (
        <Spinner />
      ) : (
        <>
          {leftIcon && (
            <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
              {leftIcon}
            </span>
          )}
          <span>{children}</span>
          {rightIcon && (
            <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
              {rightIcon}
            </span>
          )}
        </>
      )}
    </button>
  );

  if (pinned) {
    return (
      <div className="fixed bottom-0 left-0 right-0 p-500 pb-[calc(var(--space-500)+env(safe-area-inset-bottom,0px))] bg-background-primary border-t border-border-opaque z-30">
        <button
          type={type}
          onClick={onClick}
          disabled={disabled || loading}
          className={[
            'w-full h-14 inline-flex items-center justify-center gap-300 rounded-sm font-body font-medium',
            'transition-base',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2',
            variantClasses[variant],
            disabled || loading ? 'cursor-not-allowed' : 'cursor-pointer',
          ].join(' ')}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          {loading ? <Spinner /> : children}
        </button>
      </div>
    );
  }

  return button;
}
