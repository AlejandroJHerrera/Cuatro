/**
 * One-off Resend deliverability test (HANDOFF Tier 1, step 2).
 * Renders the REAL OrderConfirmationEmail and sends it to a Gmail address so we
 * can check inbox-vs-spam + that SPF/DKIM on discocuatro.com are working.
 *
 * Run: npx tsx scripts/sendTestEmail.ts <recipient-email>
 */
import { env } from "../src/env.js";
import { sendOrderConfirmation } from "../src/services/email.js";
import { renderQrPng } from "../src/services/qrRender.js";
import { signQrPayload } from "../src/services/qrSigning.js";

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error("Usage: npx tsx scripts/sendTestEmail.ts <recipient-email>");
    process.exit(1);
  }

  const orderCode = "TEST01";
  const seatLabels = ["A1", "A2"];

  const seats = seatLabels.map((label) => ({
    label,
    qrUrl: `${env.BACKEND_URL}/api/tickets/${orderCode}/${label}/qr.png`,
  }));

  const qrAttachments = await Promise.all(
    seatLabels.map(async (label) => ({
      filename: `qr-${label}.png`,
      content: await renderQrPng(signQrPayload(orderCode, label)),
    })),
  );

  const result = await sendOrderConfirmation({
    to,
    props: {
      guestName: "Prueba Entrega",
      orderCode,
      showtimeIso: "2026-06-24T19:00:00-06:00",
      venueName: "CINEPOLIS ALTARA",
      totalLps: 2000,
      seats,
    },
    qrAttachments,
  });

  console.log("Resend response:", JSON.stringify(result, null, 2));
  if ((result as any)?.error) {
    console.error("SEND FAILED");
    process.exit(1);
  }
  console.log(`Sent test confirmation to ${to}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
