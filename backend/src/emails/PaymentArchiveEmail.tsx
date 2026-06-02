import { Html, Body, Container, Heading, Text } from "@react-email/components";
import * as React from "react";

export type ArchiveProps = {
  orderCode: string;
  guestName: string;
  email: string;
  amountLps: number;
  seats: string[];
  verdict: "approved" | "rejected";
  reason?: string;
  detail?: string;
  txnId?: string;
};

export function PaymentArchiveEmail(p: ArchiveProps) {
  return (
    <Html lang="es">
      <Body style={{ fontFamily: "monospace" }}>
        <Container>
          <Heading>[{p.verdict.toUpperCase()}] {p.orderCode}</Heading>
          <Text>Cliente: {p.guestName} &lt;{p.email}&gt;</Text>
          <Text>Monto: L {p.amountLps.toFixed(2)}</Text>
          <Text>Butacas: {p.seats.join(", ")}</Text>
          {p.verdict === "approved" && <Text>Txn ID: {p.txnId}</Text>}
          {p.verdict === "rejected" && <Text>Motivo: {p.reason} — {p.detail}</Text>}
        </Container>
      </Body>
    </Html>
  );
}
