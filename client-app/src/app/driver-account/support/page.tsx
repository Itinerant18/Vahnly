'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/store/useAuthStore';
import {
  createSupportTicket, getSupportTickets, getSupportTicket, replySupportTicket,
  uploadSupportAttachment, getTripHistory,
  type SupportTicketListItem, type SupportTicketMessage, type TicketCategory, type DriverTrip,
} from '@/api/client';
import { formatCompactDate } from '@/lib/format';

const HOTLINE = '+911800123456';

const STATUS_STYLE: Record<string, string> = {
  OPEN: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  PENDING: 'text-sky-400 bg-sky-400/10 border-sky-400/30',
  RESOLVED: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  CLOSED: 'text-zinc-400 bg-zinc-800 border-zinc-700',
};

type CatTile = { key: TicketCategory; label: string; icon: string };

export default function DriverSupportPage() {
  const t = useTranslations('support');
  const { token } = useAuthStore();
  const [view, setView] = useState<'new' | 'list' | 'thread'>('new');
  const [tickets, setTickets] = useState<SupportTicketListItem[]>([]);

  // New ticket state
  const [category, setCategory] = useState<TicketCategory | null>(null);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [orderId, setOrderId] = useState('');
  const [trips, setTrips] = useState<DriverTrip[]>([]);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [createdNumber, setCreatedNumber] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Thread state
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<{ ticket: SupportTicketListItem; description: string; messages: SupportTicketMessage[] } | null>(null);
  const [replyMsg, setReplyMsg] = useState('');

  const cats: CatTile[] = [
    { key: 'TRIP', label: t('catTrip'), icon: '🚗' },
    { key: 'PAYMENT', label: t('catPayment'), icon: '💳' },
    { key: 'VEHICLE', label: t('catVehicle'), icon: '🔧' },
    { key: 'ACCOUNT', label: t('catAccount'), icon: '👤' },
    { key: 'SAFETY', label: t('catSafety'), icon: '🛡️' },
    { key: 'OTHER', label: t('catOther'), icon: '❓' },
  ];

  const loadTickets = useCallback(async () => {
    if (!token) return;
    try { setTickets((await getSupportTickets(token)).tickets); } catch (e) { console.warn(e); }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void loadTickets();
    getTripHistory(token, 10, 0).then((r) => setTrips(r.trips)).catch(() => {});
  }, [token, loadTickets]);

  const openThread = async (id: string) => {
    if (!token) return;
    setActiveId(id); setView('thread'); setThread(null);
    try { setThread(await getSupportTicket(token, id)); } catch (e) { console.warn(e); }
  };

  const handleAttach = async (file: File) => {
    if (!token) return;
    try { const { url } = await uploadSupportAttachment(token, file); setAttachments((a) => [...a, url]); }
    catch { alert('Attachment upload failed.'); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !category) return;
    setSubmitting(true);
    try {
      const res = await createSupportTicket(token, {
        category, subject: subject || category, description,
        order_id: orderId || undefined, attachments,
      });
      setCreatedNumber(res.ticket_number);
      setCategory(null); setSubject(''); setDescription(''); setOrderId(''); setAttachments([]);
      await loadTickets();
    } catch { alert('Could not submit ticket.'); }
    finally { setSubmitting(false); }
  };

  const handleReply = async () => {
    if (!token || !activeId || !replyMsg.trim()) return;
    try { await replySupportTicket(token, activeId, replyMsg); setReplyMsg(''); await openThread(activeId); }
    catch { alert('Reply failed.'); }
  };

  return (
    <div className="space-y-5 text-left pb-6">
      {/* Hotline always visible */}
      <a href={`tel:${HOTLINE}`} className="flex items-center justify-center gap-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 py-3 text-xs font-mono font-bold uppercase tracking-wider">
        📞 {t('hotline')}
      </a>

      <div className="flex gap-2 font-mono text-[10px]">
        <button onClick={() => { setView('new'); setCreatedNumber(null); }} className={`flex-1 py-2 rounded-lg font-bold uppercase ${view === 'new' ? 'bg-white text-black' : 'bg-zinc-900 text-zinc-400'}`}>{t('newTicket')}</button>
        <button onClick={() => setView('list')} className={`flex-1 py-2 rounded-lg font-bold uppercase ${view === 'list' || view === 'thread' ? 'bg-white text-black' : 'bg-zinc-900 text-zinc-400'}`}>{t('myTickets')}</button>
      </div>

      {/* NEW TICKET */}
      {view === 'new' && (createdNumber ? (
        <div className="bg-zinc-950 border border-emerald-500/30 rounded-2xl p-8 text-center space-y-3">
          <div className="text-4xl">✓</div>
          <p className="text-white font-bold">{t('ticketCreated')}</p>
          <p className="text-emerald-400 font-mono text-lg">{createdNumber}</p>
          <button onClick={() => { setCreatedNumber(null); setView('list'); }} className="text-[10px] font-mono text-zinc-400 underline">{t('myTickets')}</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase font-mono mb-2">{t('category')}</label>
            <div className="grid grid-cols-3 gap-2">
              {cats.map((c, i) => (
                <button key={i} type="button" onClick={() => setCategory(c.key)}
                  className={`rounded-xl border p-3 text-center transition ${category === c.key ? 'border-white bg-zinc-900' : 'border-zinc-800 bg-zinc-950'}`}>
                  <div className="text-xl">{c.icon}</div>
                  <div className="text-[9px] font-mono text-zinc-400 mt-1">{c.label}</div>
                </button>
              ))}
            </div>
          </div>

          {(category === 'TRIP') && trips.length > 0 && (
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase font-mono mb-2">{t('selectTrip')}</label>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {trips.map((tr) => (
                  <label key={tr.id} className="flex items-center gap-2 text-[10px] font-mono text-zinc-300 bg-zinc-950 border border-zinc-900 rounded-lg p-2 cursor-pointer">
                    <input type="radio" name="trip" checked={orderId === tr.id} onChange={() => setOrderId(tr.id)} />
                    <span>{tr.id.slice(0, 8)} · {tr.status}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('subject')}
            className="w-full bg-zinc-950 border border-zinc-900 rounded-xl p-3 text-xs text-white font-mono" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('description')} rows={4} required
            className="w-full bg-zinc-950 border border-zinc-900 rounded-xl p-3 text-xs text-white font-mono" />

          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleAttach(e.target.files[0])} />
            <button type="button" onClick={() => fileRef.current?.click()} className="bg-zinc-900 text-zinc-300 border border-zinc-800 rounded-xl px-4 py-2 text-[10px] font-mono uppercase">📎 {t('attachPhoto')}</button>
            {attachments.length > 0 && <span className="text-[10px] font-mono text-emerald-400">{attachments.length} attached</span>}
          </div>

          <button type="submit" disabled={!category || submitting}
            className="w-full bg-white text-black rounded-xl py-3.5 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
            {submitting ? '…' : t('submit')}
          </button>
        </form>
      ))}

      {/* MY TICKETS */}
      {view === 'list' && (
        <div className="space-y-2">
          {tickets.length === 0 && <p className="text-[10px] font-mono text-zinc-600 text-center py-4">{t('noTickets')}</p>}
          {tickets.map((tk) => (
            <button key={tk.ticket_number} onClick={() => openThread(tk.ticket_number)}
              className="w-full bg-zinc-950 border border-zinc-900 rounded-xl p-4 flex justify-between items-center text-left">
              <div>
                <span className="text-white font-mono text-xs font-bold">{tk.ticket_number}</span>
                <span className="block text-zinc-500 text-[9px] font-mono mt-0.5">{tk.category} · {formatCompactDate(tk.updated_at)}</span>
              </div>
              <span className={`text-[8px] font-mono uppercase font-bold px-2 py-1 rounded-full border ${STATUS_STYLE[tk.status] ?? STATUS_STYLE.OPEN}`}>{tk.status}</span>
            </button>
          ))}
        </div>
      )}

      {/* THREAD */}
      {view === 'thread' && (
        <div className="space-y-3">
          <button onClick={() => setView('list')} className="text-[10px] font-mono text-zinc-400">← {t('myTickets')}</button>
          {!thread && <p className="text-[10px] font-mono text-zinc-600">Loading…</p>}
          {thread && (
            <>
              <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-3">
                <span className="text-white font-mono text-xs font-bold">{thread.ticket.ticket_number}</span>
                <span className="block text-zinc-500 text-[9px] font-mono">{thread.ticket.subject}</span>
              </div>
              <div className="space-y-2">
                {thread.messages.map((m, i) => (
                  <div key={i} className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs ${m.sender_type === 'DRIVER' ? 'ml-auto bg-white text-black' : 'bg-zinc-900 text-zinc-200'}`}>
                    <p>{m.content}</p>
                    <span className="block text-[8px] opacity-60 mt-1 font-mono">{m.sender_name} · {formatCompactDate(m.created_at)}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 sticky bottom-0">
                <input value={replyMsg} onChange={(e) => setReplyMsg(e.target.value)} placeholder={t('reply')}
                  onKeyDown={(e) => e.key === 'Enter' && handleReply()}
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-white font-mono" />
                <button onClick={handleReply} className="bg-white text-black rounded-xl px-4 text-[10px] font-bold uppercase">{t('send')}</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
