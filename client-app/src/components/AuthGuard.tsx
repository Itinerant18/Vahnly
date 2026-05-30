'use client';
import React, { useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useRouter, usePathname } from 'next/navigation';

export default function AuthGuard({ children, allowedRole }: { children: React.ReactNode, allowedRole: 'RIDER' | 'DRIVER' }) {
  const { isAuthenticated, user } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Bypass auth gates if the user is already loading the login screen
    if (pathname === '/driver/login' || pathname === '/rider/login') {
      return;
    }

    // If not authenticated, kick back to the respective login screen
    if (!isAuthenticated) {
      const loginRoute = allowedRole === 'DRIVER' ? '/driver/login' : '/rider/login';
      router.push(loginRoute);
      return;
    }

    // Role-based access control (RBAC) at the edge
    if (user?.role !== allowedRole) {
      const fallbackRoute = allowedRole === 'DRIVER' ? '/driver/login' : '/rider/login';
      router.push(fallbackRoute);
    }
  }, [isAuthenticated, user, router, allowedRole, pathname]);

  // Bypass visual overlay for login screens
  if (pathname === '/driver/login' || pathname === '/rider/login') {
    return <>{children}</>;
  }

  if (!isAuthenticated || user?.role !== allowedRole) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center font-sans">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 rounded-full border-2 border-canvas-soft border-t-black animate-spin mx-auto" />
          <p className="text-xs text-mute uppercase font-bold tracking-wider">Verifying session...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
