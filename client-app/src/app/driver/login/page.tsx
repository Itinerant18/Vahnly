'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DriverLoginRedirect() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/login?role=driver');
  }, [router]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center font-sans">
      <div className="text-zinc-500 font-mono text-xs uppercase animate-pulse">
        Redirecting to Unified Fleet Access Portal...
      </div>
    </div>
  );
}
