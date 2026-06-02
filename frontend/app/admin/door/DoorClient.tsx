"use client";
import { useState } from "react";
import { BACKEND_URL } from "@/lib/api";

export type Door = {
  totals: { sold: number; scanned: number; capacity: number };
  orders: {
    code: string;
    guestName: string;
    totalLps: number;
    tickets: { id: string; seat: string; redeemedAt: string | null }[];
  }[];
};

export function DoorClient({ initial }: { initial: Door }) {
  const [data, setData] = useState(initial);
  const [q, setQ] = useState("");

  async function checkIn(ticketId: string) {
    const res = await fetch(`${BACKEND_URL}/api/admin/manual-checkin`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticketId }),
    });
    if (!res.ok) return;
    setData((d) => ({
      ...d,
      totals: { ...d.totals, scanned: d.totals.scanned + 1 },
      orders: d.orders.map((o) => ({
        ...o,
        tickets: o.tickets.map((t) =>
          t.id === ticketId ? { ...t, redeemedAt: new Date().toISOString() } : t,
        ),
      })),
    }));
  }

  const ql = q.toLowerCase();
  const visible = data.orders.filter(
    (o) => !ql || o.code.toLowerCase().includes(ql) || o.guestName.toLowerCase().includes(ql),
  );

  return (
    <main className="min-h-screen min-h-[100svh] bg-hall text-bulb p-4 flex flex-col gap-4">
      <header
        className="font-mono text-[0.6875rem] uppercase text-bulb/65 flex flex-wrap gap-x-6 gap-y-1 border-b border-ash/35 pb-3"
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        <span>VENDIDAS · {data.totals.sold} / {data.totals.capacity}</span>
        <span>ESCANEADAS · {data.totals.scanned} / {data.totals.sold}</span>
      </header>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por nombre u orden…"
        className="w-full bg-transparent border-b border-ash/45 py-2 font-mono text-sm text-bulb placeholder:text-bulb/40 focus:outline-none focus:border-gold"
      />
      <ul className="flex flex-col gap-3">
        {visible.length === 0 && (
          <li className="font-mono text-[0.6875rem] uppercase text-bulb/40 py-6" style={{ letterSpacing: "var(--tracking-label)" }}>
            Sin coincidencias.
          </li>
        )}
        {visible.map((o) => (
          <li key={o.code} className="border border-ash/35 p-3 flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display text-lg uppercase" style={{ letterSpacing: "var(--tracking-marquee)" }}>
                {o.guestName}
              </span>
              <span
                className="font-mono text-[0.6875rem] uppercase text-bulb/65"
                style={{ letterSpacing: "var(--tracking-label)" }}
              >
                {o.code}
              </span>
            </div>
            <ul className="flex flex-col gap-1 font-mono text-[0.75rem] [font-variant-numeric:tabular-nums]">
              {o.tickets.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${t.redeemedAt ? "bg-emerald-500" : "bg-bulb/35"}`}
                    />
                    <span className="uppercase">{t.seat}</span>
                  </span>
                  {!t.redeemedAt && (
                    <button
                      type="button"
                      onClick={() => checkIn(t.id)}
                      className="font-mono text-[0.6875rem] uppercase text-gold border-b border-gold/40 hover:border-gold transition-colors"
                      style={{ letterSpacing: "var(--tracking-label)" }}
                    >
                      MARCAR ENTRADA ✓
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </main>
  );
}
