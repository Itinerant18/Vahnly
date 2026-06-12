"use client";

import { useCallback, useEffect, useState } from "react";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { cmsApi } from "@/lib/api/cms";
import type { CMSDocument, CMSDocumentType } from "@/lib/api/types";
import { Capacitor } from "@capacitor/core";

const TABS: { type: CMSDocumentType; label: string }[] = [
  { type: "TERMS_OF_SERVICE", label: "Terms of Service" },
  { type: "PRIVACY_POLICY", label: "Privacy Policy" },
  { type: "CANCELLATION_POLICY", label: "Cancellation Policy" },
  { type: "REFUND_POLICY", label: "Refund Policy" },
];

const CACHE_TTL = 24 * 60 * 60 * 1000;
const cacheKey = (type: CMSDocumentType) => `dfu_legal_${type}`;

type CacheEntry = { doc: CMSDocument; ts: number };

function readCache(type: CMSDocumentType): CacheEntry | null {
  try {
    const raw = localStorage.getItem(cacheKey(type));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (parsed && parsed.doc && typeof parsed.ts === "number") return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeCache(type: CMSDocumentType, doc: CMSDocument): void {
  try {
    const entry: CacheEntry = { doc, ts: Date.now() };
    localStorage.setItem(cacheKey(type), JSON.stringify(entry));
  } catch {
    // Ignore quota / serialization failures — cache is best-effort.
  }
}

function stripHtml(html: string): string {
  if (typeof document === "undefined") return html.replace(/<[^>]*>/g, " ").trim();
  const el = document.createElement("div");
  el.innerHTML = html;
  return (el.textContent || el.innerText || "").replace(/\s+\n/g, "\n").trim();
}

function formatDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function LegalPage() {
  const [active, setActive] = useState<CMSDocumentType>("TERMS_OF_SERVICE");
  const [doc, setDoc] = useState<CMSDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);

  const loadDoc = useCallback(
    async (type: CMSDocumentType, opts?: { force?: boolean }) => {
      const force = opts?.force ?? false;
      setErrored(false);

      const cached = readCache(type);
      if (!force && cached && Date.now() - cached.ts < CACHE_TTL) {
        setDoc(cached.doc);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const fresh = await cmsApi.document(type);
        if (fresh && fresh.html && fresh.html.trim().length > 0) {
          setDoc(fresh);
          writeCache(type, fresh);
        } else if (cached) {
          setDoc(cached.doc);
        } else {
          setDoc(null);
          setErrored(true);
        }
      } catch {
        if (cached) {
          setDoc(cached.doc);
        } else {
          setDoc(null);
          setErrored(true);
        }
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadDoc(active);
  }, [active, loadDoc]);

  const onDownload = useCallback(async () => {
    if (!doc) return;
    if (Capacitor.isNativePlatform()) {
      try {
        const { Share } = await import("@capacitor/share");
        await Share.share({
          title: doc.title,
          text: stripHtml(doc.html),
          dialogTitle: "Share document",
        });
      } catch {
        // User cancelled or share unavailable — no-op.
      }
    } else {
      const prevTitle = document.title;
      document.title = doc.title;
      try {
        window.print();
      } finally {
        document.title = prevTitle;
      }
    }
  }, [doc]);

  const updated = formatDate(doc?.updated_at);
  const showShimmer = loading && !doc;
  const showPlaceholder = !loading && !doc && errored;

  return (
    <AccountScaffold title="Legal">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const isActive = tab.type === active;
            return (
              <button
                key={tab.type}
                onClick={() => setActive(tab.type)}
                className={
                  "rounded-xl px-3 py-2 text-sm font-medium transition-colors " +
                  (isActive
                    ? "bg-[#FF6B35] text-white"
                    : "bg-[#1E1E1E] text-[#9CA3AF] hover:text-white")
                }
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="rounded-2xl bg-[#141414] p-4">
          {doc && (
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white">{doc.title}</h2>
                {updated && (
                  <p className="mt-1 text-xs text-[#6B7280]">Last updated {updated}</p>
                )}
              </div>
              <button
                onClick={onDownload}
                disabled={!doc}
                className="shrink-0 rounded-xl bg-[#1E1E1E] px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
              >
                Download as PDF
              </button>
            </div>
          )}

          {showShimmer && (
            <div className="h-40 animate-pulse rounded-2xl bg-[#1E1E1E]" />
          )}

          {showPlaceholder && (
            <div className="rounded-2xl bg-[#1E1E1E] p-6 text-center">
              <p className="text-sm text-[#9CA3AF]">Document loading…</p>
              <button
                onClick={() => void loadDoc(active, { force: true })}
                className="mt-4 rounded-xl bg-[#FF6B35] px-4 py-2 text-sm font-medium text-white"
              >
                Retry
              </button>
            </div>
          )}

          {doc && doc.html && (
            <div className="max-h-[60vh] overflow-y-auto pr-1">
              <div
                className="text-sm leading-relaxed text-[#D1D5DB] space-y-3 [&_h2]:text-white [&_h2]:font-bold [&_h3]:text-white [&_h3]:font-semibold [&_a]:text-[#FF6B35] [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                dangerouslySetInnerHTML={{ __html: doc.html }}
              />
            </div>
          )}
        </div>
      </div>
    </AccountScaffold>
  );
}
