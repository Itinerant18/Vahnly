'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export default function RiderLoginRedirect() {
  const t = useTranslations('riderLogin');
  const router = useRouter();

  useEffect(() => {
    router.replace('/login?role=rider');
  }, [router]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center font-sans text-content-secondary">
      <div className="font-mono text-xs uppercase animate-pulse">
        {t('redirecting')}
      </div>
    </div>
  );
}
