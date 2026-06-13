'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export default function DriverLoginRedirect() {
  const t = useTranslations('driverLogin');
  const router = useRouter();

  useEffect(() => {
    router.replace('/login?role=driver');
  }, [router]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center font-sans">
      <div className="text-content-tertiary font-mono text-xs uppercase animate-pulse">
        {t('redirecting')}
      </div>
    </div>
  );
}
