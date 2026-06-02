# Product

## Register

product

## Users

Spanish-speaking music and film audiences buying a ticket to a single one-night-only screening of the documentary for the album **CUATRO** by **Jose Javier Diaz**. They arrive cold from a social link or word-of-mouth, mostly on phones, often in the evening. Their job is small and specific: understand what this is, decide quickly, pick seats for themselves (and up to 8 companions), pay, and receive a ticket they can show at the door. Some will know the album already and arrive sold; others will be discovering it on this page and need the screening to feel real before they commit.

## Product Purpose

A single-screening ticket site. One movie, one showtime, one room. The product exists to convert curiosity into a confirmed seat: a clear sense of the event, an interactive seat map (10×12) as the central act of decision, OAuth sign-in, Stripe checkout, and an emailed QR ticket. Success is a frictionless purchase that still feels like an invitation to something specific — not a generic transaction. Secondary purpose: act as the canonical artifact for the screening itself, so the URL is something the artist is comfortable sharing.

## Brand Personality

Intimate, handcrafted, nocturnal. The voice is restrained and Spanish-default — short, declarative, never marketing-y. Tone leans toward the way an independent cinema talks about a film it programmed itself: respectful of the work, confident enough to withhold, never breathless. The site should feel like it was made for *this* screening by people who care about *this* album, not like a template filled with a poster. Emotional target on first paint: **anticipation** — the sense that a one-night event is already underway and a seat is something to claim, not to browse.

## Anti-references

- **Ticketmaster, StubHub, Eventbrite** — corporate event-commerce. Dense chrome, urgency banners, upsells, generic "venue" framing.
- **Neon party-flyer aesthetics** — saturated gradients, club-night typography, hype-led copy.
- **Generic SaaS / Linear-Stripe minimalism** — cream backgrounds, soft shadows, Inter-everywhere, "modern startup" polish. This site is a cinema room at night, not a B2B dashboard.
- **AI-generated cosmic kitsch** — the obvious "space gradient + sparkles + nebula" reflex. The album poster is cosmic; the site must earn that motif through restraint, not by piling on stars.
- **Album-platform tropes** — waveforms, big artist headshots, Bandcamp-style player chrome. The screening is the product, not the album page.

Touchstones in the right lane: **MUBI** and **Metrograph** — dark, image-led, single-feature focus, showtimes treated as primary information, editorial typography, very little chrome.

## Design Principles

1. **The seat map is the centerpiece.** Every other element earns its place by getting out of its way. Landing, header, checkout summary: all designed so the eye returns to the grid.
2. **One night, one room.** The product is a single screening, so the UI never paginates, filters, or pretends there are alternatives. Date, time, and venue are stated once, with the weight of a marquee.
3. **Restraint over atmosphere.** The cosmic motif is implied, not illustrated. A starfield is allowed only if it disappears when you stop looking at it. Type, spacing, and negative space carry the mood before any decorative layer does.
4. **Spanish first, never translated-feeling.** Copy is written in Spanish from the start, not localized from English. Tone is closer to a programmer's note than a marketing headline.
5. **Cuatro is a structural rhythm, not a decoration.** The four tracks (seasons / cardinal directions) appear as a real tracklist on the landing page, and the number four shows up quietly in the layout's underlying rhythm. The motif is the skeleton, not a sticker.
6. **Treat the purchase like an RSVP.** From sign-in through emailed ticket, the flow should feel like being added to a list, not completing a transaction. No upsells, no "you may also like", no recommended add-ons.

## Accessibility & Inclusion

Target: **WCAG 2.2 AA** across the site, with deliberate care on the seat map. Specific requirements:

- Dark surfaces must meet AA contrast for body and interactive text; verify against the chosen tinted-neutral palette rather than assuming.
- Seat grid is fully keyboard-navigable: arrow keys move between seats, Enter/Space toggles selection, status (available / held / taken / yours) is announced to screen readers with localized Spanish labels.
- Respect `prefers-reduced-motion`: any ambient motion (starfield drift, fades) collapses to static; functional motion (selection feedback, hold-timer countdown) remains but without easing flourishes.
- Color is never the sole signal for seat state — pair every color with shape, fill, or pattern so color-blind users can distinguish available / held / selected / taken.
- Hold-expiry countdown is announced politely (not assertively) and is reachable by screen readers without trapping focus.
- Forms (email confirmation, etc.) use proper labels and error association; OAuth buttons have explicit accessible names in Spanish.
