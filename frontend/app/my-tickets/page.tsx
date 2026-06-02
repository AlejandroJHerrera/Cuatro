import type { Metadata } from "next";
import Link from "next/link";
import { copy } from "@/lib/copy";
import { getMyOrders } from "@/lib/orders";
import { OrderCard } from "@/app/components/OrderCard";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: `${copy.myTickets.eyebrow} — ${copy.brand.wordmark}`,
};

export default async function MyTicketsPage() {
  await requireUser("/my-tickets");
  const ordersRes = await getMyOrders();

  if (!ordersRes.ok) {
    return (
      <ShellLayout>
        <MyTicketsError />
      </ShellLayout>
    );
  }

  const { orders } = ordersRes;
  // Upcoming first, then past — both groups in their existing order. The
  // backend should already return them sorted; the sort here is defensive.
  const sorted = [...orders].sort((a, b) => {
    if (a.status === b.status) return 0;
    return a.status === "upcoming" ? -1 : 1;
  });

  return (
    <ShellLayout>
      <header className="flex flex-col gap-5">
        <span
          className="
            inline-flex items-center gap-3
            font-mono text-[0.6875rem] uppercase text-bulb/55
            after:block after:h-px after:max-w-[6em] after:flex-1
            after:bg-ash/45 after:content-['']
          "
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {copy.myTickets.eyebrow}
        </span>
        {sorted.length > 0 && (
          <>
            <h1
              className="
                m-0 font-display font-light uppercase text-bulb
                text-[clamp(2.25rem,6vw,4rem)] leading-[0.95]
              "
              style={{ letterSpacing: "var(--tracking-marquee)" }}
            >
              {copy.myTickets.heading}
            </h1>
            <p className="m-0 max-w-[40ch] font-body text-base leading-[1.6] text-bulb/80">
              {copy.myTickets.body}
            </p>
          </>
        )}
      </header>

      {sorted.length === 0 ? (
        <EmptyState />
      ) : (
        <section
          aria-label="Lista de reservas"
          className="flex flex-col gap-6 sm:gap-8"
        >
          {sorted.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </section>
      )}

      <Link
        href="/"
        className="
          self-start font-mono text-[0.6875rem] uppercase text-bulb/65
          border-b border-ash/35 pb-px
          transition-colors duration-200 ease-out-quart
          hover:text-gold hover:border-gold
        "
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        ← VOLVER AL INICIO
      </Link>
    </ShellLayout>
  );
}

function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="
        min-h-screen min-h-[100svh] bg-hall
        px-6 py-14
        sm:px-12 sm:py-20
        flex justify-center
      "
    >
      <div className="flex w-full max-w-[42rem] flex-col gap-12">{children}</div>
    </main>
  );
}

function EmptyState() {
  return (
    <section className="flex flex-col items-start gap-6 border border-ash/30 px-7 py-10 sm:px-9 sm:py-12">
      <p
        className="
          m-0 font-display font-light uppercase text-bulb
          text-[clamp(1.5rem,4vw,2.25rem)] leading-[1.05]
        "
        style={{ letterSpacing: "var(--tracking-marquee)" }}
      >
        {copy.myTickets.emptyHeading}
      </p>
      <p className="m-0 max-w-[36ch] font-body text-sm text-bulb/70">
        {copy.myTickets.emptyBody}
      </p>
      <Link
        href="/"
        className="
          inline-flex items-center justify-center
          min-h-12 px-7 py-3
          font-body font-medium text-sm uppercase
          border border-gold text-bulb
          transition-colors duration-200 ease-out-quart
          hover:bg-gold hover:text-hall
        "
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {copy.myTickets.emptyCta}
      </Link>
    </section>
  );
}

function MyTicketsError() {
  return (
    <section className="flex flex-col items-start gap-6">
      <span
        className="font-mono text-[0.6875rem] uppercase text-bulb/55"
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {copy.myTickets.eyebrow}
      </span>
      <p
        className="
          m-0 font-display font-light uppercase text-bulb
          text-[clamp(1.5rem,4vw,2.25rem)] leading-[1.05]
        "
        style={{ letterSpacing: "var(--tracking-marquee)" }}
      >
        {copy.myTickets.errorHeading}
      </p>
      <p className="m-0 font-body text-sm text-bulb/70">
        {copy.myTickets.errorBody}
      </p>
      <Link
        href="/my-tickets"
        className="
          inline-flex items-center justify-center
          min-h-12 px-7 py-3
          font-body font-medium text-sm uppercase
          border border-ash/45 text-bulb
          transition-colors duration-200 ease-out-quart
          hover:border-gold hover:text-gold
        "
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {copy.myTickets.errorCta}
      </Link>
    </section>
  );
}
