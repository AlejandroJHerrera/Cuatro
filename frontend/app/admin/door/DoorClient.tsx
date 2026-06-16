"use client";
import { useState } from "react";
import { toggleCheckin, releaseOrder, resendOrderEmail } from "@/lib/admin";

export type Door = {
  totals: { sold: number; scanned: number; capacity: number };
  revenue: {
    publicRevenueLps: number;
    soldPublicSeats: number;
    compReservedSeats: number;
    scannedSeats: number;
    capacity: number;
  };
  orders: {
    code: string;
    guestName: string;
    totalLps: number;
    source: "customer" | "adminReserved" | "adminSold";
    tickets: { id: string; seat: string; redeemedAt: string | null }[];
  }[];
};

export function DoorClient({ initial }: { initial: Door }) {
  const [data, setData] = useState(initial);
  const [q, setQ] = useState("");

  function setTicketRedeemed(ticketId: string, redeemed: boolean) {
    setData((d) => {
      const orders = d.orders.map((o) => ({
        ...o,
        tickets: o.tickets.map((t) =>
          t.id === ticketId ? { ...t, redeemedAt: redeemed ? new Date().toISOString() : null } : t,
        ),
      }));
      const scanned = orders.flatMap((o) => o.tickets).filter((t) => t.redeemedAt).length;
      return {
        ...d,
        totals: { ...d.totals, scanned },
        revenue: { ...d.revenue, scannedSeats: scanned },
        orders,
      };
    });
  }

  async function onToggle(ticketId: string, currentlyRedeemed: boolean) {
    const next = !currentlyRedeemed;
    setTicketRedeemed(ticketId, next); // optimistic
    const ok = await toggleCheckin(ticketId, next);
    if (!ok) setTicketRedeemed(ticketId, currentlyRedeemed); // revert
  }

  async function onRelease(code: string) {
    if (!confirm(`¿Liberar la orden ${code}? Sus butacas vuelven al mapa.`)) return;
    const ok = await releaseOrder(code);
    if (ok) setData((d) => ({ ...d, orders: d.orders.filter((o) => o.code !== code) }));
  }

  async function onResend(code: string) {
    await resendOrderEmail(code);
  }

  const ql = q.toLowerCase();
  const visible = data.orders.filter(
    (o) => !ql || o.code.toLowerCase().includes(ql) || o.guestName.toLowerCase().includes(ql),
  );

  const r = data.revenue;

  return (
    <main className="min-h-screen min-h-[100svh] bg-hall text-bulb p-4 flex flex-col gap-4">
      <header
        className="font-mono text-[0.6875rem] uppercase text-bulb/65 flex flex-wrap gap-x-6 gap-y-1 border-b border-ash/35 pb-3"
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        <span>VENDIDAS · {data.totals.sold} / {data.totals.capacity}</span>
        <span>ESCANEADAS · {data.totals.scanned} / {data.totals.sold}</span>
      </header>

      {/* Admin-only revenue/breakdown panel. */}
      <section
        className="font-mono text-[0.6875rem] uppercase grid grid-cols-2 sm:grid-cols-4 gap-3 border border-gold/30 p-3"
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        <Metric label="Ingresos (público)" value={`L ${r.publicRevenueLps.toLocaleString("es-HN")}`} />
        <Metric label="Vendidas (público)" value={`${r.soldPublicSeats}`} />
        <Metric label="Reservadas/comp" value={`${r.compReservedSeats}`} />
        <Metric label="Escaneadas" value={`${r.scannedSeats} / ${data.totals.sold}`} />
      </section>

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
                {o.source !== "customer" && (
                  <span className="ml-2 font-mono text-[0.5625rem] text-gold align-middle">
                    {o.source === "adminSold" ? "· VENDIDA (ADMIN)" : "· RESERVADA"}
                  </span>
                )}
              </span>
              <span className="font-mono text-[0.6875rem] uppercase text-bulb/65" style={{ letterSpacing: "var(--tracking-label)" }}>
                {o.code}
              </span>
            </div>

            <ul className="flex flex-col gap-1 font-mono text-[0.75rem] [font-variant-numeric:tabular-nums]">
              {o.tickets.map((t) => {
                const redeemed = !!t.redeemedAt;
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${redeemed ? "bg-emerald-500" : "bg-bulb/35"}`} />
                      <span className="uppercase">{t.seat}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onToggle(t.id, redeemed)}
                      className="font-mono text-[0.6875rem] uppercase text-gold border-b border-gold/40 hover:border-gold transition-colors"
                      style={{ letterSpacing: "var(--tracking-label)" }}
                    >
                      {redeemed ? "DESMARCAR ✕" : "MARCAR ENTRADA ✓"}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="flex gap-4 pt-1">
              <button
                type="button"
                onClick={() => onResend(o.code)}
                className="font-mono text-[0.625rem] uppercase text-bulb/70 border-b border-ash/35 hover:text-gold hover:border-gold transition-colors"
                style={{ letterSpacing: "var(--tracking-label)" }}
              >
                Reenviar correo
              </button>
              <button
                type="button"
                onClick={() => onRelease(o.code)}
                className="font-mono text-[0.625rem] uppercase text-red-400/80 border-b border-red-400/30 hover:text-red-400 hover:border-red-400 transition-colors"
                style={{ letterSpacing: "var(--tracking-label)" }}
              >
                Liberar butacas
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-bulb/55">{label}</span>
      <span className="text-base text-bulb [font-variant-numeric:tabular-nums]">{value}</span>
    </div>
  );
}
