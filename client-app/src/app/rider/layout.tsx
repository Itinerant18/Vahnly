'use client';
import React from 'react';
import AuthGuard from '../../components/AuthGuard';

export default function RiderLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard allowedRole="RIDER">
      {children}
    </AuthGuard>
  );
}
