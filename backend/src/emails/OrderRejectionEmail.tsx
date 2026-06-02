import { Html, Body, Container, Heading, Text, Link } from "@react-email/components";
import * as React from "react";

export type RejectionProps = {
  guestName: string;
  orderCode: string;
  detail: string;
  retryUrl: string;
};

export function OrderRejectionEmail(p: RejectionProps) {
  return (
    <Html lang="es">
      <Body style={{ background: "#0c0c0d", color: "#f5f1e6", fontFamily: "serif" }}>
        <Container style={{ maxWidth: 560, margin: "0 auto", padding: 24 }}>
          <Heading>No pudimos verificar tu pago</Heading>
          <Text>Hola {p.guestName},</Text>
          <Text>Tu orden {p.orderCode} no pudo verificarse: {p.detail}</Text>
          <Text>Si tu pago es válido, intenta de nuevo: <Link href={p.retryUrl}>{p.retryUrl}</Link></Text>
        </Container>
      </Body>
    </Html>
  );
}
