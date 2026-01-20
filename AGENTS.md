# Agent Notes (Project Continuation Guide)

This repository contains a SvelteKit webapp that is attempting to reverse engineer the _experience_ of the Wyrd Light / Wyrdoscope as a screen-shareable "lamp".

The primary goals are aesthetics and smoothness:

- no jitter
- no flashing/strobing
- minimal UI for Zoom

## Where The Implementation Lives

- `src/routes/+page.svelte`
  - signal engine (bit streams + rolling window)
  - channel detection
  - stage logic
  - boot logic
  - pearson motion model
  - renderer (canvas)
  - HUD + hotkeys

- `src/routes/+layout.svelte`
  - global styles (full-screen, overflow hidden)

Reference material:

- https://gowyrd.org/faq/
- `wyrdlight.txt`

## Current Signal Model

We simulate two random bit streams A/B (0/1) and maintain a rolling window of length `windowBits`.

Tracked aggregates (must remain consistent with buffers):

- `onesA`, `onesB`
- `agree` (A[i] == B[i])
- `sumX`, `sumY`, `sumXY` (±1 mapping) for Pearson correlation

Important: `reseed()` fills buffers with random bits and recomputes aggregates.
If you change reseeding/buffering, avoid a mismatch between buffers and aggregates or coherence will spike/pin.

Channel strengths (0..1):

- correlated drift: uses z-scores of A and B when `zA*zB > 0`
- anti drift: uses z-scores when `zA*zB < 0`
- stick: uses z-score of `agree` (tuned to be rarer)
- pearson: derived from `|pearsonR|`

We pick a `dominant` channel (winner-takes-most + hysteresis) to choose the main hue family.

## Stages

Stages are a display mechanism:

- Stage 1: mostly colored orb
- Stage 2: whiter/brighter blend
- Stage 3: subtle iridescence (no strobe)

Stage driver:

- `coherence = max(channel strengths)`
- `stageEnergy` is a slow integrator (rise slower than immediate signal; fall even slower)
- stage transitions use hysteresis

## Boot / Reset

Boot is both aesthetic and functional:

- lasts ~5s
- CRT-ish: dot expands to full orb; creamy warm-white glow and a subtle horizontal band
- during boot:
  - dominant channel is forced to `baseline`
  - stage is forced to 1 and `stageEnergy` is held at 0

Boot exists to make startup/reset obvious and to prevent early confusing dominance/stage shifts.

## Pearson Visual + Motion

Pearson is expressed primarily via a pearly conic-gradient swirl.

Motion model:

- `pearsonSpin` (smoothed version of `pearsonR`)
- `pearsonDir` flips with sign, but with hysteresis threshold so it doesn’t chatter near zero
- `pearsonPhase` accumulates phase so motion is continuous and speed varies with `|pearson|`
- `pearsonFlip` is a short-lived accent when direction flips (slightly sharper/brighter)

Design intent:

- always drifting a little
- speeds up as `|pearson|` increases
- direction reversal is noticeable but not jarring

## Performance / UX Constraints

- No `cancelAnimationFrame` or other browser-only APIs in SSR lifecycle.
  - Cleanup of RAF is handled inside `onMount` return function.
  - Avoid browser globals in `$effect` without guards.

- The render loop is `requestAnimationFrame`, with dt clamping.
- `renderScale` controls internal canvas resolution (performance/softness).

## HUD + Controls

Hotkeys:

- `H` toggle HUD
- `?` show HUD
- `S` toggle settings
- `L` toggle legend
- `R` reseed
- `F` fullscreen

Presets:

- Fast / Medium / Slow adjust only `windowBits` and `bitsPerSec`.

## QRNG Integration Plan (Future Work)

Goal: support quantum RNG (e.g. qrandom.io) without introducing jitter.

Do not fetch QRNG directly from the browser (CORS likely).

Preferred architecture:

1. SvelteKit backend endpoint (e.g. `GET /api/qrng?bytes=...`)
   - Fetches qrandom JSON (`/api/random/binary?bytes=N`)
   - Downloads the returned `binaryURL`
   - Returns raw bytes (`application/octet-stream`, `cache-control: no-store`)

2. Client-side byte pool / ring buffer
   - Render loop reads synchronously from pool
   - Background async refill keeps pool above a low-water mark
   - Seamless fallback to `crypto.getRandomValues()` if pool runs dry

Chunk sizes: start with 64KB or 256KB per request.

## Tuning Notes

If you need to adjust “feel”, do it in this order:

1. presets (window span = windowBits / bitsPerSec)
2. stageEnergy rise/fall time constants
3. channel thresholds (especially stick)
4. dominance hysteresis/keep bonus
5. purely visual alphas/blur values

Keep everything smooth: prefer slow integrators and hysteresis over hard thresholds.
