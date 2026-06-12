'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/store/useAuthStore';
import {
  getVehicles, createVehicle, uploadVehicleDocument, deleteVehicleNew,
  type DriverVehicleFull, type VehicleDocSlot, type VehicleDocStatus,
} from '@/api/client';

const STATUS_STYLE: Record<VehicleDocStatus, string> = {
  VALID: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10',
  EXPIRING: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
  EXPIRED: 'text-red-400 border-red-400/30 bg-red-400/10',
  MISSING: 'text-zinc-500 border-zinc-800 bg-zinc-900',
};

function DocSlot({ doc, label, onUpload }: { doc: VehicleDocSlot; label: string; onUpload: (type: string, file: File, expiry: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [expiry, setExpiry] = useState('');

  const statusText = doc.status === 'VALID' ? '✓ Valid'
    : doc.status === 'EXPIRING' ? `⚠ ${doc.expiry_date ?? ''}`
    : doc.status === 'EXPIRED' ? '✗ Expired' : '+ Upload';

  return (
    <div className={`flex-1 rounded-xl border p-2.5 text-center ${STATUS_STYLE[doc.status]}`}>
      <span className="block text-[9px] font-mono font-bold uppercase tracking-wider">{label}</span>
      <span className="block text-[10px] font-mono mt-1">{statusText}</span>
      {doc.status === 'MISSING' || doc.status === 'EXPIRED' ? (
        <>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)} />
          {pendingFile ? (
            <div className="mt-2 space-y-1">
              <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded p-1 text-[9px] text-white font-mono" />
              <button onClick={() => onUpload(doc.document_type, pendingFile, expiry)}
                className="w-full bg-white text-black rounded py-1 text-[9px] font-bold uppercase">Save</button>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()}
              className="mt-2 w-full bg-zinc-800 text-zinc-300 rounded py-1 text-[9px] font-bold uppercase">Choose</button>
          )}
        </>
      ) : null}
    </div>
  );
}

export default function DriverVehiclesPage() {
  const t = useTranslations('vehicles');
  const { token } = useAuthStore();
  const [vehicles, setVehicles] = useState<DriverVehicleFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ make: '', model: '', year: '', plate: '', fuel_type: 'PETROL', car_type: 'SEDAN', transmission: 'MANUAL' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    try { setVehicles((await getVehicles(token)).vehicles); }
    catch (e) { console.warn('[Vehicles] load failed', e); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const anyExpired = vehicles.some((v) => v.documents.some((d) => d.status === 'EXPIRED'));
  const anyExpiring = vehicles.some((v) => v.documents.some((d) => d.status === 'EXPIRING'));

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    try {
      await createVehicle(token, { ...form, year: parseInt(form.year || '0', 10) });
      setShowAdd(false);
      setForm({ make: '', model: '', year: '', plate: '', fuel_type: 'PETROL', car_type: 'SEDAN', transmission: 'MANUAL' });
      await load();
    } catch { alert('Could not add vehicle.'); }
    finally { setSaving(false); }
  };

  const handleUpload = async (vehicleId: string, type: string, file: File, expiry: string) => {
    if (!token) return;
    try { await uploadVehicleDocument(token, vehicleId, type, file, expiry); await load(); }
    catch { alert('Upload failed.'); }
  };

  const handleDelete = async (id: string) => {
    if (!token || !confirm('Remove this vehicle?')) return;
    try { await deleteVehicleNew(token, id); await load(); }
    catch (e: unknown) {
      const status = (e as { status?: number })?.status;
      alert(status === 409 ? 'Cannot delete during an active trip.' : 'Delete failed.');
    }
  };

  return (
    <div className="space-y-6 text-left relative pb-20">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">{t('title')}</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">RC • Insurance • PUC</p>
      </div>

      {anyExpired && <div className="rounded-xl border border-red-400/30 bg-red-400/10 text-red-300 px-4 py-2.5 text-[11px] font-mono">⛔ {t('expiredBanner')}</div>}
      {!anyExpired && anyExpiring && <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-300 px-4 py-2.5 text-[11px] font-mono">⚠ {t('expiringBanner')}</div>}

      {loading && <p className="text-[10px] font-mono text-zinc-600">Loading…</p>}
      {!loading && vehicles.length === 0 && <p className="text-[10px] font-mono text-zinc-600">{t('noVehicles')}</p>}

      <div className="space-y-4">
        {vehicles.map((v) => (
          <div key={v.id} className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-white font-bold font-sans">{v.make} {v.model} {v.year ? `· ${v.year}` : ''}</span>
                <span className="block text-zinc-500 text-[10px] font-mono mt-0.5">{v.plate} · {v.transmission}{v.fuel_type ? ` · ${v.fuel_type}` : ''}</span>
              </div>
              <button onClick={() => handleDelete(v.id)} className="text-[9px] font-mono text-red-400/70 hover:text-red-400 uppercase">{t('delete')}</button>
            </div>
            <div className="flex gap-2">
              {v.documents.map((d) => (
                <DocSlot key={d.document_type} doc={d}
                  label={d.document_type === 'RC' ? t('rc') : d.document_type === 'INSURANCE' ? t('insurance') : t('puc')}
                  onUpload={(type, file, expiry) => handleUpload(v.id, type, file, expiry)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Add Vehicle FAB */}
      <button onClick={() => setShowAdd(true)}
        className="fixed bottom-24 right-6 h-14 w-14 rounded-full bg-white text-black text-2xl font-bold shadow-lg flex items-center justify-center z-20">+</button>

      {showAdd && (
        <div className="fixed inset-0 bg-black/70 z-30 flex items-end sm:items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={handleAdd}
            className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5 w-full max-w-md space-y-3">
            <h3 className="text-sm font-bold text-white font-mono uppercase">{t('add')}</h3>
            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <input required placeholder={t('make')} value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white" />
              <input required placeholder={t('model')} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white" />
              <input type="number" placeholder={t('year')} value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white" />
              <input required placeholder={t('plate')} value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white" />
              <select value={form.fuel_type} onChange={(e) => setForm({ ...form, fuel_type: e.target.value })} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white">
                <option>PETROL</option><option>DIESEL</option><option>CNG</option><option>EV</option>
              </select>
              <select value={form.car_type} onChange={(e) => setForm({ ...form, car_type: e.target.value })} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white">
                <option>HATCHBACK</option><option>SEDAN</option><option>SUV</option><option>PREMIUM</option>
              </select>
              <select value={form.transmission} onChange={(e) => setForm({ ...form, transmission: e.target.value })} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white col-span-2">
                <option>MANUAL</option><option>AUTOMATIC</option>
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setShowAdd(false)} className="flex-1 bg-zinc-900 text-zinc-300 rounded-lg py-2.5 text-[10px] font-bold uppercase">{t('cancel')}</button>
              <button type="submit" disabled={saving} className="flex-1 bg-white text-black rounded-lg py-2.5 text-[10px] font-bold uppercase disabled:opacity-50">{saving ? '…' : t('save')}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
