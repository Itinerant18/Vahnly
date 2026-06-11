"use client";

import { useEffect, useState } from "react";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { SkeletonList, EmptyState, ErrorState } from "@/components/account/States";
import { accountApi, type EmergencyContactInput } from "@/lib/api/account";
import type { EmergencyContact } from "@/lib/api/types";

const INPUT =
  "w-full rounded-xl bg-[#1E1E1E] px-4 py-3 text-sm text-white outline-none placeholder:text-[#6B7280] focus:ring-1 focus:ring-[#FF6B35]";

export default function EmergencyPage() {
  const [contacts, setContacts] = useState<EmergencyContact[] | null>(null);
  const [error, setError] = useState(false);
  const [autoShare, setAutoShare] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = () => {
    setError(false);
    setContacts(null);
    accountApi
      .listEmergency()
      .then((list) => {
        setContacts(list);
        setAutoShare(list.some((c) => c.auto_share_trip));
      })
      .catch(() => setError(true));
  };
  useEffect(load, []);

  const remove = async (id: string) => {
    await accountApi.removeEmergency(id);
    load();
  };

  const atMax = (contacts?.length ?? 0) >= 3;

  return (
    <AccountScaffold title="Emergency Contacts">
      {/* Auto-share toggle */}
      <div className="mb-4 rounded-2xl bg-[#141414] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-white">Auto-share trip</span>
            <button onClick={() => setShowTip((v) => !v)} className="text-xs text-[#9CA3AF]">
              ⓘ
            </button>
          </div>
          <button
            onClick={() => setAutoShare((v) => !v)}
            className={`relative h-6 w-11 rounded-full transition-colors ${autoShare ? "bg-[#FF6B35]" : "bg-[#3A3A3A]"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${autoShare ? "translate-x-5" : "translate-x-0.5"}`}
            />
          </button>
        </div>
        {showTip && (
          <p className="mt-2 rounded-lg bg-[#1E1E1E] p-2.5 text-xs text-[#9CA3AF]">
            When on, your live trip link is automatically shared with these contacts whenever a trip starts.
          </p>
        )}
      </div>

      {error ? (
        <ErrorState onRetry={load} />
      ) : contacts === null ? (
        <SkeletonList rows={3} height="h-16" />
      ) : (
        <div className="space-y-3">
          {contacts.length === 0 && (
            <EmptyState icon="🆘" title="No contacts yet" message="Add up to 3 people to alert on SOS." />
          )}
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-2xl bg-[#141414] p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EF4444]/15 text-sm font-bold text-[#EF4444]">
                {c.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{c.name}</p>
                <p className="text-xs text-[#9CA3AF]">
                  {c.phone}
                  {c.relationship ? ` · ${c.relationship}` : ""}
                </p>
              </div>
              <button onClick={() => remove(c.id)} className="text-xs font-semibold text-[#EF4444]">
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {!atMax &&
        (adding ? (
          <AddContactForm
            order={contacts?.length ?? 0}
            autoShare={autoShare}
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              load();
            }}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="mt-4 w-full rounded-2xl bg-[#FF6B35] py-3.5 text-sm font-bold text-white"
          >
            + Add Contact
          </button>
        ))}
      {atMax && <p className="mt-4 text-center text-xs text-[#6B7280]">Maximum of 3 contacts reached</p>}
    </AccountScaffold>
  );
}

function AddContactForm({
  order,
  autoShare,
  onCancel,
  onSaved,
}: {
  order: number;
  autoShare: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [saving, setSaving] = useState(false);

  const validate = () => {
    const e: { name?: string; phone?: string } = {};
    if (name.trim().length < 2) e.name = "Enter a name";
    if (!/^\d{10}$/.test(phone)) e.phone = "Enter a 10-digit number";
    return e;
  };

  const save = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length || saving) return;
    setSaving(true);
    const payload: EmergencyContactInput = {
      name: name.trim(),
      phone,
      relationship: relationship.trim() || undefined,
      auto_share_trip: autoShare,
      display_order: order,
    };
    try {
      await accountApi.addEmergency(payload);
      onSaved();
    } catch {
      setErrors({ name: "Could not save. Try again." });
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 rounded-2xl bg-[#141414] p-4">
      <div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setErrors((x) => ({ ...x, ...validate() }))}
          placeholder="Name"
          className={INPUT}
        />
        {errors.name && <p className="mt-1 text-xs text-[#EF4444]">{errors.name}</p>}
      </div>
      <div>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
          onBlur={() => setErrors((x) => ({ ...x, ...validate() }))}
          placeholder="10-digit phone"
          inputMode="numeric"
          className={INPUT}
        />
        {errors.phone && <p className="mt-1 text-xs text-[#EF4444]">{errors.phone}</p>}
      </div>
      <input
        value={relationship}
        onChange={(e) => setRelationship(e.target.value)}
        placeholder="Relationship (optional)"
        className={INPUT}
      />
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-xl bg-[#1E1E1E] py-3 text-sm text-[#9CA3AF]">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex-1 rounded-xl bg-[#FF6B35] py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
