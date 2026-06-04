'use client';

import React, { useState } from 'react';

export default function RiderEmergencyPage() {
  const [contacts, setContacts] = useState([
    { id: '1', name: 'John Connor', relation: 'Son', phone: '+91 99999 11111' },
    { id: '2', name: 'Kyle Reese', relation: 'Partner', phone: '+91 99999 22222' }
  ]);

  const [autoShare, setAutoShare] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRelation, setNewRelation] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const handleAddContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (contacts.length >= 3) {
      alert('Maximum of 3 emergency contacts can be registered for safety checks.');
      return;
    }
    if (!newName.trim() || !newPhone.trim()) return;

    setContacts((prev) => [
      ...prev,
      { id: `${Date.now()}`, name: newName, relation: newRelation, phone: newPhone }
    ]);
    setNewName('');
    setNewRelation('');
    setNewPhone('');
    setShowAddForm(false);
    alert('Emergency contact added.');
  };

  const handleRemoveContact = (id: string) => {
    if (confirm('Remove this emergency contact?')) {
      setContacts((prev) => prev.filter((c) => c.id !== id));
    }
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div className="flex justify-between items-center pb-4 border-b border-zinc-900">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white font-move">Emergency Contacts</h2>
          <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Manage up to 3 safety contacts and toggle automatic location sharing</p>
        </div>

        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-white hover:bg-zinc-200 text-black text-[10px] font-mono font-bold uppercase px-4 py-2 rounded-full cursor-pointer"
        >
          {showAddForm ? 'Close Form' : 'Add Contact'}
        </button>
      </div>

      {/* Auto-share setting */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 flex justify-between items-center text-xs font-mono">
        <div className="space-y-0.5 text-left">
          <span className="text-white block font-sans font-medium">Auto-Share Active Journeys</span>
          <span className="text-zinc-550 text-[9px] block leading-normal">
            Automatically sends live tracking SMS maps links after 22:00 departures.
          </span>
        </div>

        <button
          onClick={() => setAutoShare(!autoShare)}
          className={`h-5 w-10 rounded-full transition relative p-0.5 cursor-pointer shrink-0 ${autoShare ? 'bg-white' : 'bg-zinc-800'}`}
        >
          <div className={`h-4 w-4 rounded-full shadow transition-transform ${autoShare ? 'translate-x-5 bg-black' : 'translate-x-0 bg-zinc-400'}`} />
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <form onSubmit={handleAddContact} className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4 animate-fadeIn font-mono text-xs">
          <h4 className="text-xs font-bold text-white uppercase border-b border-zinc-900 pb-2">Add Contact</h4>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">Full Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="John Connor"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white"
                required
              />
            </div>
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">Relation</label>
              <input
                type="text"
                value={newRelation}
                onChange={(e) => setNewRelation(e.target.value)}
                placeholder="e.g. Son"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white"
              />
            </div>
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">Phone Number</label>
              <input
                type="tel"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="+91 99999 88888"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white font-mono"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-white hover:bg-zinc-200 text-black py-3 rounded-xl font-sans font-bold uppercase transition"
          >
            Register Emergency Contact
          </button>
        </form>
      )}

      {/* List */}
      <div className="space-y-3">
        {contacts.map((c) => (
          <div key={c.id} className="bg-zinc-950 border border-zinc-900 p-5 rounded-2xl flex justify-between items-center text-xs font-mono">
            <div>
              <span className="text-white block font-sans font-bold">{c.name} ({c.relation})</span>
              <span className="text-zinc-550 text-[10px] block mt-1">{c.phone}</span>
            </div>
            <button
              onClick={() => handleRemoveContact(c.id)}
              className="text-red-500 hover:text-red-400 font-mono text-[8px] uppercase tracking-wider cursor-pointer shrink-0"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

    </div>
  );
}
