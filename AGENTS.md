# Agent Notes (Project Continuation Guide)

This repository contains a SvelteKit webapp that reverse engineers the _experience_ of the Wyrd Light / Wyrdoscope as a screen-shareable "lamp".

The primary goals are aesthetics and smoothness:

- no jitter
- no flashing/strobing
- minimal UI for Zoom

## Where The Implementation Lives

- `src/routes/+page.svelte`
  - signal engine (200-bit samples per tick)
  - channel detection (4 channels)
  - stage logic (3 stages)
  - boot logic (~5s CRT-style ignition)
  - pearson motion model
  - renderer (canvas, orb + signal modes)
  - HUD + hotkeys

- `src/routes/+layout.svelte`
  - global styles (full-screen, overflow hidden)

Reference material:

- WYRDLIGHT.md (comprehensive reverse-engineering guide)

## Current Signal Model

We simulate two random bit streams A/B (0/1). Each tick (default 1Hz), we generate fresh 200-bit samples for each stream — this matches the Wyrd Light's documented behavior of selecting "a 200 bit sample from the two strings" per second.

Config variables:

- `sampleBits` (default 200): bits per sample
- `updatesPerSec` (default 1): signal ticks per second

Tracked aggregates (recomputed from buffers each tick via `recomputeAggregatesFromBuffers()`):

- `onesA`, `onesB` — count of 1s in each stream
- `agree` — count of positions where A[i] == B[i]
- `sumX`, `sumY`, `sumXY` — ±1 mapping for Pearson correlation

Z-scores are computed as: `z = (ones - N/2) / sqrt(N/4)` where N = sampleBits.

Important: `reseed()` fills buffers with random bits and recomputes aggregates. This also resets all smoothed state (coherence, stageEnergy, dominant, etc.) to prevent confusing transients.

### Four Channel Types (0..1 strength)

1. **Correlated** (`correlated`): Both streams deviate in the same direction. Active when `zA * zB > 0`. Strength = min of both z-score strengths.

2. **Anti-correlated** (`anti`): Streams deviate in opposite directions. Active when `zA * zB < 0`. Strength = min of both z-score strengths.

3. **Stick Together** (`stick`): Agreement count exceeds chance. Uses z-score of `agree`. Tuned with higher thresholds (`STICK_Z_START`, `STICK_Z_FULL`) to be rarer.

4. **Pearson** (`pearson`): Pearson correlation coefficient between streams (treating bits as ±1). Strength derived from `|r|` mapped through `PEARSON_R_START` to `PEARSON_R_FULL`.

Channel strength thresholds (z-score based):

- `STRENGTH_Z_START` (1.8): z-score where channel strength begins
- `STRENGTH_Z_FULL` (3.5): z-score for full channel strength
- `STICK_Z_START` (2.2): higher threshold for stick channel
- `STICK_Z_FULL` (3.8): stick full strength threshold

### Dominant Channel Selection

We pick a `dominant` channel (winner-takes-most + hysteresis) to choose the main hue family:

- `DOMINANCE_THRESHOLD` (0.15): minimum strength to leave baseline
- `switchMargin` (0.08): how much stronger a new channel must be to take over
- `keepBonus` (0.04): bonus given to current channel to prevent rapid switching
- `dominance` value smooths with asymmetric tau (1200ms rise, 1800ms fall)

Color palette (hue values):

- `baseline`: wanders slowly between channel hues (default 205)
- `correlated`: 186 (teal)
- `anti`: 24 (ember/orange)
- `stick`: 112 (green)
- `pearson`: 252 (purple/pearl)

### Coherence and Significance

- `coherence` = max of all channel strengths (drives stage transitions)
- `sigEnergy` = p-value-based significance measure (drives the bright core effect)
  - Uses surprisal transform: `S = -log10(p)`
  - Smoothed with asymmetric tau (1400ms rise, 2600ms fall)

## Stages

Stages are a display mechanism driven by `stageEnergy`:

- **Stage 1**: mostly colored orb
- **Stage 2**: whiter/brighter blend (whitening increases with energy)
- **Stage 3**: subtle iridescence via pearly conic-gradient swirl

Stage driver:

- `coherence = max(channel strengths)`
- `stageEnergy` is a slow integrator (rise 2600ms tau, fall 4200ms tau)
- Stage transitions use hysteresis thresholds:
  - 1→2: energy > 0.42
  - 2→1: energy < 0.34
  - 2→3: energy > 0.78
  - 3→2: energy < 0.68

## Boot / Reset

Boot is both aesthetic and functional:

- lasts ~5s (`bootMs / 5000`)
- CRT-ish: dot expands to full orb; creamy warm-white glow and a subtle horizontal band
- during boot (`bootLock = true`):
  - dominant channel is forced to `baseline`
  - stage is forced to 1 and `stageEnergy` is held at 0
  - no signal ticks processed

Boot exists to make startup/reset obvious and to prevent early confusing dominance/stage shifts.

## Pearson Visual + Motion

Pearson is expressed via:

1. **Pearly ring**: conic-gradient swirl around the orb edge
2. **Stage 3 iridescence**: subtle conic overlay inside the orb

Motion model:

- `pearsonSpin`: smoothed version of `pearsonR` (tau 900ms)
- `pearsonDir`: flips with sign, but with hysteresis threshold (0.055) to prevent chatter near zero
- `pearsonPhase`: accumulates phase continuously; speed = `baseSpeed + gain * |pearsonSpin|^0.82`
- `pearsonFlip`: short-lived accent when direction flips (decays with tau 650ms), makes reversal slightly sharper/brighter

Design intent:

- always drifting a little (baseSpeed ensures motion even at low correlation)
- speeds up as `|pearson|` increases
- direction reversal is noticeable but not jarring

## Render Modes

Two render modes available (toggle with `B` key):

1. **Orb mode** (default): full visual orb with all effects
2. **Signal mode**: simplified circle with strip chart showing coherence/stageEnergy history

## Performance / UX Constraints

- No `cancelAnimationFrame` or other browser-only APIs in SSR lifecycle.
  - Cleanup of RAF is handled inside `onMount` return function.
  - Avoid browser globals in `$effect` without `typeof window` guards.

- The render loop is `requestAnimationFrame`, with dt clamping (`Math.min(80, dt)`).
- `renderScale` (0.75) controls internal canvas resolution (performance/softness).
- Per-frame smoothing of `stageEnergyRender` and `sigEnergyRender` eliminates stepping from discrete ticks.
- Channel strengths (`rawRender`) are smoothed with asymmetric tau (1800ms rise, 4000ms fall).

## HUD + Controls

Hotkeys:

- `H` toggle HUD
- `?` show HUD
- `S` toggle settings panel
- `L` toggle legend
- `R` reseed (reset all state)
- `F` fullscreen
- `B` toggle render mode (orb/signal)
- `C` cheat boost (inject fake coherence for testing)

Settings panel exposes:

- `updatesPerSec` (1-5): signal tick rate

## Cheat / Debug Mode

For testing visual responses without waiting for random episodes:

- `C` key injects `cheatBoost` (+0.6, capped at 1.0)
- Boost is applied to `cheatChannel` (default: correlated)
- Decays at 0.97 per tick (~23 seconds to halve at 1Hz)
- Affects both coherence and p-value calculations

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

If you need to adjust "feel", do it in this order:

1. `sampleBits` and `updatesPerSec` (sample size and tick rate)
2. `stageEnergy` rise/fall time constants (2600ms/4200ms)
3. channel z-score thresholds (`STRENGTH_Z_START`, `STRENGTH_Z_FULL`, stick variants)
4. dominance hysteresis (`switchMargin`, `keepBonus`)
5. purely visual alphas/blur values in render functions

Keep everything smooth: prefer slow integrators and hysteresis over hard thresholds.
