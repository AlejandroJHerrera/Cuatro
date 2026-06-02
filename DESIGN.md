<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->
---
name: Cuatro
description: A nocturnal ticket site for the one-night screening of the CUATRO documentary by Jose Javier Diaz.
---

# Design System: Cuatro

## 1. Overview

**Creative North Star: "The Late-Night Marquee"**

A small independent cinema, after dark, on the night of the screening. The lobby is unlit except for the marquee and the warm bulb above the box office. You step inside, choose your seat from a printed plan tacked to the wall, and the usher hands you a stub. The site is that lobby in browser form: nocturnal, image-led, almost entirely typographic, with one warm point of light — the seat you've claimed and the button that confirms it.

The system explicitly rejects the visual reflexes of online ticketing. No urgency banners, no countdown hype, no chrome competing with the poster. It also rejects the dominant AI-cinematic reflex of "space gradient + sparkles" — the cosmic motif of the album is *implied* through restraint (deep tinted neutrals, a single warm glow, generous negative space) rather than illustrated with nebulae or particle fields. Information is treated like a playbill: dense where it must be, silent everywhere else. The four tracks of the album appear as a real tracklist on the landing page, and the number four shows up quietly in the layout's underlying rhythm.

Density is low. Pages breathe. The seat map is the centerpiece, and every other surface is designed so the eye returns to it.

**Key Characteristics:**

- Nocturnal palette: tinted near-blacks, never `#000`, never pure greys.
- A single warm accent (gold-copper, echoing the CD's center reflection) covering ≤5% of any screen.
- Editorial uppercase serif marquee against clean sans body and labels.
- Motion is restrained: state changes are crisp, one ambient lens-flare breathes slowly behind the hero, everything else holds still.
- Spanish-default copy with the cadence of a programmer's note, not a marketing line.
- The four tracks as a real, present tracklist — not a decoration.

## 2. Colors

A nocturnal, tinted-neutral palette anchored by a single warm point of light. The room is dark; the accent is the bulb above the box office.

### Primary

- **Marquee Gold** (`[to be resolved during implementation]`, OKLCH in the warm-amber range, low-to-mid chroma): the single warm accent. Appears on the selected seat fill, the primary CTA, and the QR-code frame on the issued ticket. Used on ≤5% of any given surface; its rarity is the entire point. Never on body text. Never on a hover for an inert element.

### Neutral

- **Hall Black** (`[to be resolved during implementation]`, tinted toward blue-violet, chroma ~0.005–0.01): the page background. Never `#000`. Always carries a trace of the marquee hue so the screen feels like a room with air in it.
- **Curtain** (`[to be resolved during implementation]`, slightly lifted from Hall Black): secondary surfaces — the checkout summary card, the modal scrim, the seat-grid backdrop.
- **Ash** (`[to be resolved during implementation]`, mid-lightness tinted neutral): body copy, available seats, secondary UI.
- **Marquee Bulb** (`[to be resolved during implementation]`, near-white tinted toward warm-gold, never `#fff`): display type, headings, the on-state of focused elements.
- **Held** (`[to be resolved during implementation]`, a desaturated dim of Ash): seats currently held by another buyer. Distinguishable from "Taken" by lightness AND pattern, not by color alone.
- **Taken** (`[to be resolved during implementation]`, near Hall Black with a low-contrast diagonal hatch): seats already sold. Color + pattern; never color alone.

### Named Rules

**The One Bulb Rule.** Marquee Gold appears on at most one element class per screen, and never on more than ~5% of the pixel area. If a second use of gold is tempting, the design is wrong — find structure instead.

**The No-Black, No-White Rule.** `#000` and `#fff` are forbidden. Every neutral carries a trace of the brand hue. Pure black/white kills the room.

**The Pattern-Plus-Color Rule.** Seat states (available / yours / held / taken) must be distinguishable by shape or pattern as well as color. Color-blind users must never be guessing.

## 3. Typography

**Display Font:** an editorial uppercase serif with generous letter-spacing (`[font pairing to be chosen at implementation]` — direction: a contemporary high-contrast or transitional serif in the lineage of Tiempos, Söhne Mono, or GT Sectra; capable of wide tracking without losing presence on dark surfaces). With Georgia as the system fallback.

**Body Font:** a clean, slightly humanist sans with strong text-figure rendering at 14–16px on dark (`[font pairing to be chosen at implementation]` — direction: Söhne, Inter Display, or Suisse Int'l; not generic Inter). With system-ui as the fallback.

**Character:** the pairing is the printed playbill paired with the modern timetable — a serif marquee carrying the title and the date, a precise sans handling the operational layer (row labels, prices, seat IDs, hold countdown).

### Hierarchy

- **Display** (light, `clamp(2.5rem, 7vw, 5.5rem)`, line-height 0.95, letter-spacing ~0.04em, uppercase): the film title on the landing page, the showtime on the marquee, the seat-selected confirmation. Used once or twice per page, never more.
- **Headline** (regular, `clamp(1.5rem, 3vw, 2.25rem)`, line-height 1.1, letter-spacing ~0.02em, uppercase): section markers (`LA FUNCIÓN`, `TUS BUTACAS`, `TRACKLIST`).
- **Title** (medium sans, `1.125rem`, line-height 1.3): card titles, seat-count summary line.
- **Body** (regular sans, `1rem`, line-height 1.6, max width 65–70ch): synopsis, programmer's note, fine print.
- **Label** (medium sans, `0.75rem`, letter-spacing 0.08em, uppercase): row letters, seat numbers, button text, micro-metadata (date stamps, ticket IDs).
- **Mono note** (`[to be resolved during implementation]`, e.g. JetBrains Mono or IBM Plex Mono, `0.875rem`): used *only* for the hold-timer countdown (`09:42 RESTANTES`), seat IDs in the cart (`A-07`), and the price (`$12.00 USD`). Reinforces the ticket-stub motif without spreading mono across the whole UI.

### Named Rules

**The Marquee Rule.** Display type is uppercase, widely tracked, and used sparingly. Sentence-case display is forbidden — it pulls the page toward generic SaaS.

**The Mono-As-Operator Rule.** Mono is *only* for ticket operationalia (seat IDs, prices, countdown). Never for body, never for headlines, never for UI labels. It is the ink stamp on the stub, not the typeface of the site.

## 4. Elevation

The system is flat by default. Depth is conveyed by tonal layering (Curtain lifted from Hall Black, Marquee Bulb above Ash), generous negative space, and one ambient warm glow behind the hero — never by ambient drop-shadows on cards. Shadows appear only as a quiet, narrow response to focus and active state on interactive controls.

### Shadow Vocabulary

- **Focus glow** (`box-shadow: 0 0 0 2px [Marquee Gold @ low alpha]`): the focus ring on keyboard-navigated controls, including the seat grid. Visible, not aggressive. Replaces the default browser outline.
- **Hero halo** (a soft radial gradient layer behind the title, not a `box-shadow`): the single ambient warm light source on the landing page. Breathes (~6–8s cycle, `prefers-reduced-motion` collapses to static). Implemented in CSS, never an image asset.

### Named Rules

**The Flat-By-Default Rule.** Cards, modals, and panels are flat surfaces of Curtain on Hall Black. No drop shadows on inert elements. If a card looks like it floats, the design is wrong — separate it with space, not with z.

**The One Light Source Rule.** There is exactly one warm light in the room: the hero halo on the landing page. It does not repeat on inner pages.

## 5. Components

Components are pre-implementation. The list below names what the system will need; specifics land on the first scan-mode pass.

### Buttons

- **Primary** (`button-primary`): Marquee Gold fill, Hall Black label, generous horizontal padding, uppercase label with wide tracking. Square or near-square corners (≤2px radius). One per screen.
- **Secondary / Ghost**: transparent fill, Marquee Bulb label, 1px Ash border. No hover background — hover lifts the label to full Marquee Bulb and the border to Marquee Gold at low alpha.

### Seat (signature component)

The single most important component. A small touch-target tile, ~32–40px on desktop, larger on touch.

- **Available**: outlined in Ash, transparent fill.
- **Selected (yours)**: solid Marquee Gold fill, Hall Black inner glyph (a small dot or seat-number).
- **Held by another**: dimmed Held neutral, with a thin diagonal hatch (CSS gradient, not an image).
- **Taken**: Taken neutral with a denser diagonal hatch and reduced opacity.
- **Focus**: Marquee Gold focus glow ring; keyboard arrow keys move focus; Enter/Space toggles selection.
- All four states must read unambiguously without color.

### Inputs

Minimal. A 1px Ash bottom border on Curtain, no background fill, Marquee Bulb text. Focus shifts the border to Marquee Gold. No floating labels; labels sit above with the Label type style.

### Navigation

There is barely any. A thin top bar with the wordmark left, the user's avatar (when signed in) right. No primary nav, because there is one product and one decision. The seat-picker page adds a fixed bottom or right-rail summary with the running cart and the hold-timer countdown.

### Tracklist (signature component)

A real, present tracklist on the landing page: four rows, each with a number (01–04), a track title (the season / cardinal direction), and a duration in mono. Thin horizontal rules between rows; generous vertical spacing. No play buttons, no waveforms — this is a credits sequence, not a player.

### Ticket / QR card (signature component)

Issued on `/success` and in the confirmation email: a vertical "stub" composition with serif display title, mono seat IDs, mono ticket ID, and the QR code framed in a thin Marquee Gold rule. The one place where the warm accent is allowed to appear at >5% of the surface, because the stub IS the surface.

## 6. Do's and Don'ts

### Do:

- **Do** anchor every screen on tinted near-black neutrals, with `#000` and `#fff` both forbidden.
- **Do** treat Marquee Gold as a rare event: ≤5% of any screen, one element class at a time.
- **Do** set display type uppercase with wide letter-spacing; reserve it for the title and section markers.
- **Do** use mono *only* for seat IDs, prices, and the hold-timer countdown.
- **Do** convey seat status with shape/pattern in addition to color, so color-blind users never have to guess.
- **Do** write copy in Spanish from the start. Short, declarative, never breathless.
- **Do** respect `prefers-reduced-motion`: the hero halo and any ambient drift collapse to static; functional state changes remain.
- **Do** keep the four-track motif structural — a real tracklist on the landing, the number four felt as layout rhythm.

### Don't:

- **Don't** use Ticketmaster / StubHub / Eventbrite chrome: urgency banners, "only 3 left!" hype, recommended add-ons, upsells.
- **Don't** drift into Linear / Stripe / generic SaaS minimalism: cream backgrounds, soft shadows on cards, Inter-everywhere, "modern startup" polish. This is a cinema, not a B2B dashboard.
- **Don't** produce AI-cosmic kitsch: nebula gradients, sparkle/star particle fields, glowing dust, "space" texture overlays. The cosmic motif is implied through restraint, not illustrated.
- **Don't** borrow album-platform tropes: waveforms, big artist headshots, Bandcamp-style player chrome. The screening is the product, not the album page.
- **Don't** use neon party-flyer aesthetics: saturated gradients, club-night typography, hype-led copy.
- **Don't** use `#000` or `#fff`. Ever.
- **Don't** put a colored side-stripe border on cards or alerts. Use full borders, background tints, or nothing.
- **Don't** use gradient text (`background-clip: text` with a gradient). One solid color, weight + size for emphasis.
- **Don't** rely on glassmorphism (blurs, frosted-glass cards) as a default treatment. Rare and purposeful, or nothing.
- **Don't** sentence-case display type. Marquee type is uppercase.
- **Don't** spread mono across the UI. Mono is the ink stamp, not the typeface.
- **Don't** drop-shadow inert cards. Separate with space, not z.
