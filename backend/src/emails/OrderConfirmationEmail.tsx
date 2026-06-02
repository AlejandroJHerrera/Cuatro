import { Html, Head, Body, Container, Heading, Text, Section, Img } from "@react-email/components";
import * as React from "react";

export type ConfirmationProps = {
  guestName: string;
  orderCode: string;
  showtimeIso: string;
  venueName: string;
  totalLps: number;
  seats: { label: string; qrUrl: string }[];
};

export function OrderConfirmationEmail(p: ConfirmationProps) {
  return (
    <Html lang="es">
      <Head />
      <Body style={{ background: "#0c0c0d", color: "#f5f1e6", fontFamily: "serif", margin: 0 }}>
        <Container style={{ maxWidth: 560, margin: "0 auto", padding: 24 }}>
          <Heading style={{ fontSize: 28 }}>Tu reservación CUATRO</Heading>
          <Text>Hola {p.guestName},</Text>
          <Text>Tu pago está verificado. Te esperamos {new Date(p.showtimeIso).toLocaleString("es-HN")} en {p.venueName}.</Text>
          <Text>Orden: <strong>{p.orderCode}</strong> · Total: L {p.totalLps.toFixed(2)}</Text>
          {p.seats.map((s) => (
            <Section key={s.label} style={{ borderTop: "1px solid #333", padding: "16px 0", textAlign: "center" }}>
              <Text style={{ fontSize: 24, margin: 0 }}>{s.label.replace(/^(.)(\d+)$/, "$1·$2")}</Text>
              <Img src={s.qrUrl} alt={`QR ${s.label}`} width={180} height={180} />
            </Section>
          ))}
          <Text style={{ marginTop: 24, fontSize: 12 }}>En la puerta verificamos por nombre y escaneamos el QR de cada butaca.</Text>
        </Container>
      </Body>
    </Html>
  );
}
