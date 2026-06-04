'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RiderLoginRedirect() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/login?role=rider');
  }, [router]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center font-sans text-zinc-400">
      <div className="font-mono text-xs uppercase animate-pulse">
        Redirecting to Unified Ride Access Portal...
      </div>
    </div>
  );
}
