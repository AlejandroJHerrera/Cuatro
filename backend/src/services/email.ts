import { Resend } from "resend";
import { render } from "@react-email/components";
import { env } from "../env.js";
import { OrderConfirmationEmail, type ConfirmationProps } from "../emails/OrderConfirmationEmail.js";
import { PaymentArchiveEmail, type ArchiveProps } from "../emails/PaymentArchiveEmail.js";
import { OrderRejectionEmail, type RejectionProps } from "../emails/OrderRejectionEmail.js";

const resend = new Resend(env.RESEND_API_KEY);
const FROM = "Cuatro <onboarding@resend.dev>";

export async function sendOrderConfirmation(args: {
  to: string;
  props: ConfirmationProps;
  qrAttachments: { filename: string; content: Buffer; cid: string }[];
}) {
  const html = await render(OrderConfirmationEmail(args.props));
  return resend.emails.send({
    from: FROM,
    to: args.to,
    subject: `Tu reservación CUATRO · ${args.props.orderCode}`,
    html,
    attachments: args.qrAttachments.map((a) => ({
      filename: a.filename,
      content: a.content.toString("base64"),
      content_id: a.cid,
    })),
  } as any);
}

export async function sendPaymentArchive(args: {
  props: ArchiveProps;
  screenshot?: { filename: string; content: Buffer; mimeType: string };
}) {
  const html = await render(PaymentArchiveEmail(args.props));
  return resend.emails.send({
    from: FROM,
    to: env.PAYMENT_ARCHIVE_EMAIL,
    subject: `[CUATRO] ${args.props.orderCode} · L${args.props.amountLps.toFixed(2)} · ${args.props.guestName}`,
    html,
    attachments: args.screenshot
      ? [{ filename: args.screenshot.filename, content: args.screenshot.content.toString("base64") }]
      : undefined,
  } as any);
}

export async function sendOrderRejection(args: { to: string; props: RejectionProps }) {
  const html = await render(OrderRejectionEmail(args.props));
  return resend.emails.send({
    from: FROM,
    to: args.to,
    subject: `No pudimos verificar tu pago · ${args.props.orderCode}`,
    html,
  } as any);
}
