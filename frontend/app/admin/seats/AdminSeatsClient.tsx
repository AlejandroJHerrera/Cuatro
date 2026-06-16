"use client";

import { useCallback, useState } from "react";
import type { Seat } from "@/lib/seats";
import { fetchSeatsClient } from "@/lib/holds";
import { SeatGrid } from "@/app/components/SeatGrid";
import { QrBlock } from "@/app/components/QrBlock";
import { createBlock, type AdminTicket } from "@/lib/admin";

type Phase =
  | { kind: "select" }
  | { kind: "submitting" }
  | { kind: "done"; code: string; tickets: AdminTicket[] };

export function AdminSeatsClient({ initialSeats }: { initialSeats: Seat[] }) {
  const [seats, setSeats] = useState<Seat[]>(initialSeats);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<"reserved" | "sold">("reserved");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "select" });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const fresh = await fetchSeatsClient();
    if (fresh) setSeats(fresh);
  }, []);

  const onToggle = useCallback((seat: Seat) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(seat.id)) next.delete(seat.id);
      else next.add(seat.id);
      return next;
    });
  }, []);

  async function onSubmit() {
    setError(null);
    if (selected.size === 0) return setError("Selecciona al menos una butaca.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("Correo inválido.");
    setPhase({ kind: "submitting" });
    const res = await createBlock({ seatLabels: [...selected], kind, email, name });
    if (res.ok) {
      setPhase({ kind: "done", code: res.code, tickets: res.tickets });
      setSelected(new Set());
      setEmail("");
      setName("");
      await refresh();
      return;
    }
    setPhase({ kind: "select" });
    if (res.reason === "conflict") {
      setError(`Butacas ya ocupadas: ${(res.conflicts ?? []).join(", ")}.`);
      await refresh();
    } else if (res.reason === "validation") {
      setError(res.message ?? "Datos inválidos.");
    } else if (res.reason === "auth") {
      setError("No autorizado.");
    } else {
      setError("Error de red. Intenta de nuevo.");
    }
  }

  if (phase.kind === "done") {
    return (
      <main className="min-h-screen min-h-[100svh] bg-hall text-bulb p-4 flex flex-col gap-6">
        <h1 className="font-display text-2xl uppercase" style={{ letterSpacing: "var(--tracking-marquee)" }}>
          Butacas bloqueadas · {phase.code}
        </h1>
        <p className="font-mono text-[0.75rem] uppercase text-bulb/65" style={{ letterSpacing: "var(--tracking-label)" }}>
          Se envió el correo con los códigos QR.
        </p>
        <div className="flex flex-wrap gap-6">
          {phase.tickets.map((t) => (
            <div key={t.seat} className="flex flex-col items-center gap-2">
              <QrBlock payload={t.qrPayload} size={160} />
              <span className="font-mono text-[0.6875rem] uppercase text-bulb/80">{t.seat}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPhase({ kind: "select" })}
          className="self-start inline-flex items-center min-h-12 px-5 font-mono text-[0.6875rem] uppercase border border-ash/35 text-bulb hover:border-gold hover:text-gold transition-colors"
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          Bloquear más →
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen min-h-[100svh] bg-hall text-bulb p-4 flex flex-col gap-6">
      <h1 className="font-display text-2xl uppercase" style={{ letterSpacing: "var(--tracking-marquee)" }}>
        Gestión de butacas
      </h1>

      <SeatGrid seats={seats} selected={selected} onToggle={onToggle} />

      <div className="flex flex-col gap-4 max-w-md w-full mx-auto border-t border-ash/35 pt-4">
        <span className="font-mono text-[0.6875rem] uppercase text-bulb/65" style={{ letterSpacing: "var(--tracking-label)" }}>
          {selected.size} butaca(s): {[...selected].join(", ") || "—"}
        </span>

        <div className="flex gap-2">
          {(["reserved", "sold"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`flex-1 min-h-11 font-mono text-[0.6875rem] uppercase border transition-colors ${
                kind === k ? "border-gold text-gold" : "border-ash/35 text-bulb hover:border-bulb"
              }`}
              style={{ letterSpacing: "var(--tracking-label)" }}
            >
              {k === "reserved" ? "Reservar" : "Vender"}
            </button>
          ))}
        </div>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Correo del destinatario (requerido)"
          className="w-full bg-transparent border-b border-ash/45 py-2 font-mono text-sm text-bulb placeholder:text-bulb/40 focus:outline-none focus:border-gold"
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre (opcional)"
          className="w-full bg-transparent border-b border-ash/45 py-2 font-mono text-sm text-bulb placeholder:text-bulb/40 focus:outline-none focus:border-gold"
        />

        {error && (
          <p className="font-mono text-[0.6875rem] uppercase text-red-400" style={{ letterSpacing: "var(--tracking-label)" }}>
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onSubmit}
          disabled={phase.kind === "submitting"}
          className="min-h-12 px-5 font-mono text-[0.6875rem] uppercase bg-gold text-hall hover:opacity-90 transition-opacity disabled:opacity-60"
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {phase.kind === "submitting" ? "Bloqueando…" : "Bloquear butacas + enviar QR →"}
        </button>
      </div>
    </main>
  );
}
