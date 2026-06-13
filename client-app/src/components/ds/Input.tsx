'use client';
import React from 'react';

interface InputProps {
  label?: string;
  placeholder?: string;
  error?: string;
  helper?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  filled?: boolean;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
  autoFocus?: boolean;
  id?: string;
  name?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}

export function Input({
  label,
  placeholder,
  error,
  helper,
  leftIcon,
  rightIcon,
  filled = false,
  value,
  onChange,
  type = 'text',
  inputMode,
  maxLength,
  autoFocus,
  id,
  name,
  disabled,
  readOnly,
  className = '',
}: InputProps) {
  const inputBase = [
    'w-full h-12 rounded-sm px-500 font-body text-paragraph-large text-content-primary',
    'placeholder:text-content-tertiary',
    'outline-none transition-base',
    'focus:ring-2 focus:ring-accent-400',
    'disabled:opacity-40 disabled:cursor-not-allowed',
    filled
      ? 'bg-background-secondary border-0'
      : 'bg-background-primary border border-border-opaque focus:border-border-accent',
    error ? 'border-negative-400 focus:ring-negative-400' : '',
    leftIcon ? 'pl-10' : '',
    rightIcon ? 'pr-10' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={id}
          className="block text-label-small text-content-secondary mb-1"
        >
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <span className="absolute left-300 top-1/2 -translate-y-1/2 text-content-tertiary w-5 h-5 flex items-center justify-center pointer-events-none">
            {leftIcon}
          </span>
        )}
        <input
          id={id}
          name={name}
          type={type}
          inputMode={inputMode}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          maxLength={maxLength}
          autoFocus={autoFocus}
          disabled={disabled}
          readOnly={readOnly}
          className={inputBase}
        />
        {rightIcon && (
          <span className="absolute right-300 top-1/2 -translate-y-1/2 text-content-tertiary w-5 h-5 flex items-center justify-center pointer-events-none">
            {rightIcon}
          </span>
        )}
      </div>
      {error && (
        <p className="mt-1 text-label-small text-content-negative">{error}</p>
      )}
      {helper && !error && (
        <p className="mt-1 text-label-small text-content-tertiary">{helper}</p>
      )}
    </div>
  );
}
