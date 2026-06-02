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
  const [last, setLast] = useState<ScanVerdict | null>(null);
  const [history, setHistory] = useState<ScanVerdict[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const cooldown = useRef(0);

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
      setLast(verdict);
      setHistory((h) => [verdict, ...h].slice(0, 5));
    } catch {
      setLast({ ok: false, reason: "network" });
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
        {last && <VerdictOverlay v={last} />}
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

function VerdictOverlay({ v }: { v: ScanVerdict }) {
  if (!v.ok) return <Big bg="bg-red-700">INVÁLIDO · {v.reason}</Big>;
  if (v.alreadyUsed) return <Big bg="bg-amber-600">YA ESCANEADO · {v.seat}</Big>;
  return <Big bg="bg-emerald-700">LIBRE · {v.seat} · {v.guestName}</Big>;
}

function Big({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <div
      className={`absolute inset-0 ${bg} flex items-center justify-center text-2xl font-display uppercase text-white p-8 text-center pointer-events-none animate-scan-fadeout`}
      style={{ letterSpacing: "var(--tracking-marquee)" }}
    >
      {children}
    </div>
  );
}

function Dot({ v }: { v: ScanVerdict }) {
  const color = !v.ok ? "bg-red-500" : v.alreadyUsed ? "bg-amber-500" : "bg-emerald-500";
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}
