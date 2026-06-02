"use client";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { BACKEND_URL } from "@/lib/api";

type ScanVerdict =
  | { ok: true; seat: string; guestName: string; alreadyUsed: false }
  | { ok: true; seat: string; guestName: string; alreadyUsed: true; redeemedAt: string; redeemedBy: string | null }
  | { ok: false; reason: string };

export function ScanClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [last, setLast] = useState<{ id: number; v: ScanVerdict } | null>(null);
  const [history, setHistory] = useState<ScanVerdict[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const cooldown = useRef(0);
  const scanCounter = useRef(0);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let mounted = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (e) {
        setCameraError(e instanceof Error ? e.message : "No se pudo abrir la cámara.");
      }
    })();

    const interval = setInterval(scan, 250);
    return () => {
      mounted = false;
      clearInterval(interval);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function scan() {
    if (Date.now() < cooldown.current) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || v.readyState !== 4) return;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const code = jsQR(img.data, img.width, img.height);
    if (!code) return;
    cooldown.current = Date.now() + 2000;

    try {
      const res = await fetch(`${BACKEND_URL}/api/admin/scan`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: code.data }),
      });
      const verdict = (await res.json()) as ScanVerdict;
      scanCounter.current += 1;
      setLast({ id: scanCounter.current, v: verdict });
      setHistory((h) => [verdict, ...h].slice(0, 5));
    } catch {
      scanCounter.current += 1;
      setLast({ id: scanCounter.current, v: { ok: false, reason: "network" } });
    }
  }

  return (
    <main className="min-h-screen min-h-[100svh] bg-hall text-bulb flex flex-col">
      <header className="px-4 py-3 border-b border-ash/35 font-mono text-[0.6875rem] uppercase text-bulb/65" style={{ letterSpacing: "var(--tracking-label)" }}>
        ESCANEO · CUATRO
      </header>
      <div className="relative flex-1 flex items-center justify-center bg-black">
        <video ref={videoRef} className="w-full max-h-[75vh] object-contain" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />
        {cameraError && (
          <p role="alert" className="absolute inset-0 flex items-center justify-center text-center px-6 font-mono text-sm text-gold">
            {cameraError}
          </p>
        )}
        {last && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[38%] flex justify-center px-6">
            <VerdictToast key={last.id} v={last.v} />
          </div>
        )}
      </div>
      <ul className="px-4 py-3 font-mono text-[0.6875rem] uppercase text-bulb/65 flex flex-col gap-1 border-t border-ash/35" style={{ letterSpacing: "var(--tracking-label)" }}>
        {history.length === 0 ? (
          <li className="text-bulb/40">Sin escaneos.</li>
        ) : (
          history.map((v, i) => (
            <li key={i} className="flex items-center gap-2">
              <Dot v={v} />
              {"seat" in v ? `${v.seat} · ${v.alreadyUsed ? "ya escaneado" : v.guestName}` : v.reason}
            </li>
          ))
        )}
      </ul>
    </main>
  );
}

function VerdictToast({ v }: { v: ScanVerdict }) {
  let bg: string;
  let ring: string;
  let icon: React.ReactNode;
  let title: string;
  let subtitle: string;

  if (!v.ok) {
    bg = "bg-red-600";
    ring = "ring-red-300/40";
    icon = <IconX />;
    title = "INVÁLIDO";
    subtitle = v.reason.toUpperCase();
  } else if (v.alreadyUsed) {
    bg = "bg-amber-500";
    ring = "ring-amber-200/40";
    icon = <IconWarn />;
    title = "YA ESCANEADO";
    subtitle = `${v.seat} · ${v.guestName}`;
  } else {
    bg = "bg-emerald-600";
    ring = "ring-emerald-200/40";
    icon = <IconCheck />;
    title = "ADELANTE";
    subtitle = `${v.seat} · ${v.guestName}`;
  }

  return (
    <div
      className={`animate-scan-pop ${bg} ${ring} ring-1 text-white rounded-2xl shadow-2xl px-6 py-5 flex items-center gap-4 min-w-[18rem] max-w-md backdrop-blur-sm`}
    >
      <div className="shrink-0 w-12 h-12 rounded-full bg-white/15 flex items-center justify-center">
        {icon}
      </div>
      <div className="flex flex-col leading-tight">
        <span
          className="font-display text-xl uppercase"
          style={{ letterSpacing: "var(--tracking-marquee)" }}
        >
          {title}
        </span>
        <span className="font-mono text-[0.7rem] uppercase opacity-90 mt-1" style={{ letterSpacing: "var(--tracking-label)" }}>
          {subtitle}
        </span>
      </div>
    </div>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}
function IconWarn() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v5" />
      <circle cx="12" cy="18" r="0.5" fill="currentColor" />
    </svg>
  );
}
function IconX() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function Dot({ v }: { v: ScanVerdict }) {
  const color = !v.ok ? "bg-red-500" : v.alreadyUsed ? "bg-amber-500" : "bg-emerald-500";
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}
