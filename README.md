# Wyrdlight Web

A web recreation of the [Wyrd Light](https://gowyrd.org/). It's designed to be shared on a Zoom call for groups of people to experiment with.

This project is an aesthetic, real-time visual that responds to evolving statistics from random bit streams. It is intentionally tuned to feel like a calm physical object ("lamp"), not a meter: no jitter, no flashing; slow drift; occasional meaningful shifts.

## What’s In The Box

- A SvelteKit app that renders a full-screen "lamp orb" visual.
- A small HUD + hotkeys for Zoom sessions.
- A signal engine that currently uses local randomness (`crypto.getRandomValues()`), but is structured so we can later feed it a quantum RNG stream.

Key file:

- `src/routes/+page.svelte` — signal model + renderer + HUD.

Other useful references:

- `WYRDLIGHT.md` — a tiny summary of the 3-stage behavior.
- `index.html` — earlier prototype(s) / experimentation.

## How We’re Tackling The Problem

### 1) Model the "device" signal

The Wyrd FAQ describes analysis of patterns/correlations between **two** random streams and multiple "channels".

In our current implementation we simulate two streams `A` and `B` of 0/1 bits and compute a small set of channel strengths from a rolling window:

- Correlated drift: both streams bias the same way at the same time.
- Anti-correlated drift: streams bias in opposite directions.
- Stick-together: agreement rate (A[i] == B[i]) deviates from expectation.
- Pearson: correlation coefficient over the rolling window (bits mapped to ±1).

We reduce these channels into an overall envelope called `stageEnergy` which is heavily smoothed so the visual behaves like a lamp.

### 2) Map signal to a 3-stage visual

The documentation consistently describes three stages:

- Stage 1: colors fluctuate mainly in brightness.
- Stage 2: moves toward white / brighter.
- Stage 3: "rainbow unlocked" effect.

We interpret Stage 3 as a subtle, pearly / iridescent effect (no strobe).

### 3) Make it look good on Zoom

Design constraints:

- No flashing/strobing.
- Motion should feel like a lava lamp: slow, continuous, smoothed.
- UI should be minimal and hideable.

The visual is a single large orb with layered gradients, bloom, vignette, and a Pearson-driven pearly swirl.

### 4) Boot / reset behavior

Boot is intentionally distinct (CRT-ish): a small creamy dot expands into the full orb over ~5 seconds.

During boot we lock out channel dominance and stage changes so startup/reset reads clearly.

## Controls

Hotkeys:

- `H` toggle HUD
- `?` show HUD
- `S` toggle settings
- `L` toggle legend
- `R` reset
- `F` fullscreen

Settings (in the HUD):

- Presets: Fast / Medium / Slow (non-technical)
- Window bits: rolling window size
- Bits/sec: input bit rate
- Smoothing: exponential smoothing factor
- Render scale: internal render resolution

## Dev

Install deps:

```bash
pnpm install
```

Run dev server:

```bash
pnpm dev
```

Typecheck:

```bash
pnpm check
```

Build:

```bash
pnpm build
```

## Next Steps (Planned)

### Quantum RNG integration

We plan to add a QRNG mode (e.g. qrandom.io) via a SvelteKit backend endpoint to avoid browser CORS issues.

Approach:

- Server fetches QRNG bytes in chunks.
- Client maintains a local bit pool/ring buffer.
- Render loop reads synchronously from the pool; a background task refills it.
- Seamless fallback to `crypto.getRandomValues()` if QRNG is unavailable.

### More faithful "channels"

The FAQ mentions multiple channels and additional pattern types. We can extend the channel model (carefully) without changing the core rendering approach.
