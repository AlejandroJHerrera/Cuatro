import { Resend } from "resend";
import { render } from "@react-email/components";
import { env } from "../env.js";
import {
  OrderConfirmationEmail,
  type ConfirmationProps,
} from "../emails/OrderConfirmationEmail.js";
import {
  PaymentArchiveEmail,
  type ArchiveProps,
} from "../emails/PaymentArchiveEmail.js";
import {
  OrderRejectionEmail,
  type RejectionProps,
} from "../emails/OrderRejectionEmail.js";

const resend = new Resend(env.RESEND_API_KEY);
const FROM = "Cuatro <no-reply@discocuatro.com>";
// Optional Reply-To (a real monitored inbox). Spread into customer sends so it
// is simply omitted when REPLY_TO_EMAIL is unset. Improves trust/deliverability
// over a bare no-reply From; replies to no-reply@discocuatro.com aren't received.
const REPLY_TO = env.REPLY_TO_EMAIL ? { replyTo: env.REPLY_TO_EMAIL } : {};

export async function sendOrderConfirmation(args: {
  to: string;
  props: ConfirmationProps;
  qrAttachments: { filename: string; content: Buffer }[];
}) {
  // Render both an HTML and a plain-text part. HTML-only mail is a spam signal;
  // a text/plain alternative improves deliverability.
  const element = OrderConfirmationEmail(args.props);
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return resend.emails.send({
    from: FROM,
    ...REPLY_TO,
    to: args.to,
    subject: `Tu reservación CUATRO · ${args.props.orderCode}`,
    html,
    text,
    attachments: args.qrAttachments.map((a) => ({
      filename: a.filename,
      content: a.content.toString("base64"),
    })),
  } as any);
}

export async function sendPaymentArchive(args: {
  props: ArchiveProps;
  screenshot?: { filename: string; content: Buffer; mimeType: string };
}) {
  const element = PaymentArchiveEmail(args.props);
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return resend.emails.send({
    from: FROM,
    to: env.PAYMENT_ARCHIVE_EMAIL,
    subject: `[CUATRO] ${args.props.orderCode} · L${args.props.amountLps.toFixed(2)} · ${args.props.guestName}`,
    html,
    text,
    attachments: args.screenshot
      ? [
          {
            filename: args.screenshot.filename,
            content: args.screenshot.content.toString("base64"),
          },
        ]
      : undefined,
  } as any);
}

export async function sendOrderRejection(args: {
  to: string;
  props: RejectionProps;
}) {
  const element = OrderRejectionEmail(args.props);
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return resend.emails.send({
    from: FROM,
    ...REPLY_TO,
    to: args.to,
    subject: `No pudimos verificar tu pago · ${args.props.orderCode}`,
    html,
    text,
  } as any);
}
