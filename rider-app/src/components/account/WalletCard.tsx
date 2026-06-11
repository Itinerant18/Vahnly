"use client";

import type { Wallet } from "@/lib/api/types";
import { formatCurrency } from "@/lib/utils/formatCurrency";

export function WalletCard({ wallet }: { wallet: Wallet | null }) {
  return (
    <div className="rounded-xl bg-gradient-to-br from-[#0073E6] to-[#0056B3] p-5">
      <p className="text-xs text-white/70">Wallet balance</p>
      <p className="mt-1 text-2xl font-bold text-white">
        {wallet ? formatCurrency(wallet.balance_paise) : "₹0.00"}
      </p>
    </div>
  );
}
