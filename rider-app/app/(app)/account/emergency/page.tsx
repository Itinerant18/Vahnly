"use client";

import { useEffect, useState } from "react";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { SkeletonList, EmptyState, ErrorState } from "@/components/account/States";
import { accountApi, type EmergencyContactInput } from "@/lib/api/account";
import type { EmergencyContact } from "@/lib/api/types";
import { InfoIcon, SirenIcon } from "@/components/ds/Icon";

const INPUT =
  "w-full rounded-xl bg-background-tertiary px-4 py-3 text-sm text-content-primary outline-none placeholder:text-content-tertiary focus:ring-1 focus:ring-border-accent";

export default function EmergencyPage() {
  const [contacts, setContacts] = useState<EmergencyContact[] | null>(null);
  const [error, setError] = useState(false);
  const [autoShare, setAutoShare] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EmergencyContact | null>(null);

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
      <div className="mb-4 rounded-2xl bg-background-secondary p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-content-primary">Auto-share trip</span>
            <button onClick={() => setShowTip((v) => !v)} aria-label="Auto-share info" className="text-xs text-content-secondary">
              <InfoIcon size={16} />
            </button>
          </div>
          <button
            onClick={() => setAutoShare((v) => !v)}
            className={`relative h-6 w-11 rounded-full transition-colors ${autoShare ? "bg-accent-400" : "bg-background-tertiary"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${autoShare ? "translate-x-5" : "translate-x-0.5"}`}
            />
          </button>
        </div>
        {showTip && (
          <p className="mt-2 rounded-lg bg-background-tertiary p-2.5 text-xs text-content-secondary">
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
            <EmptyState icon={<SirenIcon size={64} />} title="No contacts yet" message="Add up to 3 people to alert on SOS." />
          )}
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-2xl bg-background-secondary p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-negative text-sm font-bold text-content-negative">
                {c.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-content-primary">{c.name}</p>
                <p className="text-xs text-content-secondary">
                  {c.phone}
                  {c.relationship ? ` · ${c.relationship}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setEditing(c);
                    setAdding(false);
                  }}
                  className="text-xs font-semibold text-content-accent"
                >
                  Edit
                </button>
                <button onClick={() => remove(c.id)} className="text-xs font-semibold text-content-negative">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <AddContactForm
          editing={editing}
          order={editing.display_order ?? 0}
          autoShare={autoShare}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : (
        <>
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
                className="mt-4 w-full rounded-2xl bg-interactive-primary py-3.5 text-sm font-bold text-interactive-primary-text"
              >
                + Add Contact
              </button>
            ))}
          {atMax && <p className="mt-4 text-center text-xs text-content-tertiary">Maximum of 3 contacts reached</p>}
        </>
      )}
    </AccountScaffold>
  );
}

function AddContactForm({
  editing,
  order,
  autoShare,
  onCancel,
  onSaved,
}: {
  editing?: EmergencyContact;
  order: number;
  autoShare: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [relationship, setRelationship] = useState(editing?.relationship ?? "");
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
      auto_share_trip: editing ? editing.auto_share_trip : autoShare,
      display_order: order,
    };
    try {
      if (editing) {
        await accountApi.updateEmergency(editing.id, payload);
      } else {
        await accountApi.addEmergency(payload);
      }
      onSaved();
    } catch {
      setErrors({ name: "Could not save. Try again." });
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 rounded-2xl bg-background-secondary p-4">
      <div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setErrors((x) => ({ ...x, ...validate() }))}
          placeholder="Name"
          className={INPUT}
        />
        {errors.name && <p className="mt-1 text-xs text-content-negative">{errors.name}</p>}
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
        {errors.phone && <p className="mt-1 text-xs text-content-negative">{errors.phone}</p>}
      </div>
      <input
        value={relationship}
        onChange={(e) => setRelationship(e.target.value)}
        placeholder="Relationship (optional)"
        className={INPUT}
      />
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-xl bg-background-tertiary py-3 text-sm text-content-secondary">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex-1 rounded-xl bg-interactive-primary py-3 text-sm font-bold text-interactive-primary-text disabled:opacity-50"
        >
          {saving ? "Saving…" : editing ? "Update" : "Save"}
        </button>
      </div>
    </div>
  );
}
