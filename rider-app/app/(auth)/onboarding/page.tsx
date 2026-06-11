"use client";

import { useRouter } from "next/navigation";

export default function OnboardingPage() {
  const router = useRouter();
  return (
    <main className="flex min-h-screen flex-col justify-center px-6">
      <h1 className="mb-2 text-2xl font-bold">Welcome aboard!</h1>
      <p className="mb-8 text-sm text-slate-400">
        Add your car and a few details to start booking drivers. You can do this
        now or later from your account.
      </p>
      <button
        className="w-full rounded-lg bg-[#0073E6] py-3 font-semibold"
        onClick={() => router.replace("/account/garage")}
      >
        Add my car
      </button>
      <button
        className="mt-3 w-full py-3 text-sm text-slate-400"
        onClick={() => router.replace("/home")}
      >
        Skip for now
      </button>
    </main>
  );
}
