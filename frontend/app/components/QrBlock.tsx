"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrBlock({ payload, size = 144 }: { payload: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(payload, { width: size * 2, margin: 2, errorCorrectionLevel: "M" }).then(setDataUrl);
  }, [payload, size]);
  if (!dataUrl) return <div style={{ width: size, height: size }} className="bg-bulb/10" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={dataUrl} alt="QR" style={{ width: size, height: size }} className="inline-block bg-bulb p-2" />;
}
