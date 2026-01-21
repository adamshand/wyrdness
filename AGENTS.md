# Agent Notes (Project Continuation Guide)

This repository contains a SvelteKit webapp that reverse engineers the _experience_ of the Wyrd Light / Wyrdoscope as a screen-shareable “lamp”.

Primary goals:

- no jitter
- no flashing/strobing
- minimal UI for Zoom

## Where The Implementation Lives

- `src/routes/+page.svelte`
  - signal engine (200-bit samples per tick)
  - starting-point (segmentation) search over recent ticks
  - channel detection + dominance selection
  - boot logic (~5s CRT-style ignition)
  - Pearson motion model (swirl)
  - renderer (canvas orb)
  - HUD + hotkeys

- `src/routes/+layout.svelte`
  - global styles (full-screen, overflow hidden)

Reference material:

- `WYRDLIGHT.md` (reverse-engineering guide)

## Current Signal Model

We simulate two random bit streams A/B (0/1). Each tick (default 1Hz), we generate a fresh 200-bit sample for each stream. Each tick updates both:

- instantaneous sample aggregates (counts, Pearson inputs)
- cumulative “random walk” sums (per tick), used for starting-point detection

Config variables:

- `sampleBits` (default 200): bits per sample
- `updatesPerSec` (default 1): signal ticks per second

Tracked per-sample aggregates (via `recomputeAggregatesFromBuffers()`):

- `onesA`, `onesB` — count of 1s in each stream
- `agree` — count of positions where A[i] == B[i]
- `sumX`, `sumY`, `sumXY` — ±1 mapped sums for Pearson

Important: `reseed()` resets buffers and all smoothed state (`coherence`, `sigEnergy`, `dominant`, etc.) to avoid confusing transients.

## Channels

Dominant channels (`Channel`):

- `correlated_high`: both streams have more 1s than expected
- `correlated_low`: both streams have more 0s than expected
- `anti_ab`: A has more 1s, B has more 0s
- `anti_ba`: B has more 1s, A has more 0s
- `stick`: bit-by-bit agreement exceeds chance
- `pearson`: Pearson correlation becomes the dominant pattern
- `baseline`: fallback when no channel is strong enough

Starting points:

- For each tick, we search backwards up to `MAX_LOOKBACK` ticks and choose the start index that maximizes a z-score-like statistic for that channel.

Strength mapping:

- Most channels map a segment z-score through `STRENGTH_Z_START` → `STRENGTH_Z_FULL` to produce a 0..1 strength.
- `stick` uses higher thresholds (`STICK_Z_START`, `STICK_Z_FULL`).
- `pearson` channel strength is derived from `|r|` through `PEARSON_R_START` → `PEARSON_R_FULL`.

## Dominant Channel Selection

We pick a `dominant` channel (winner-takes-most + hysteresis) to choose the base hue:

- `DOMINANCE_THRESHOLD` (0.15): minimum strength to leave baseline
- `switchMargin` + `keepBonus`: mode-dependent hysteresis (from `preset`)
- `dominance`: smoothed with asymmetric tau (1200ms rise, 1800ms fall)

Palette (hues):

- `baseline`: warm near-grey (fixed hue ~35, sat ~10) with slow “breathing” lightness; no hue wandering
- `correlated_high`: 170
- `correlated_low`: 238
- `anti_ab`: 50
- `anti_ba`: 350
- `stick`: 112
- `pearson`: 252 (rendered more “pearly” via reduced saturation when dominant)

## Coherence and Significance

- `coherence` = max channel strength (including Pearson)
- `sigEnergy` = p-value-based significance energy (drives brightness)
  - compute per-channel p-values from segment z-scores
  - `pOverall = min(COHERENCE_FLOOR, pCorrHigh, pCorrLow, pAntiAb, pAntiBa, pStick, pPearson)`
  - surprisal transform: `S = -log10(pOverall)`
  - map to 0..1 and smooth with mode preset (`sigEnergyRiseMs`, `sigEnergyFallMs`)

## Visual Model

- Boot: ~5s CRT-ish ignition. While booting, dominance is forced to baseline and no ticks are processed.
- Base hue: derived from dominant channel; smoothed with `hueTauMs` (faster during demo).
- Saturation: mode-smoothed; baseline is desaturated; Pearson dominant is also reduced saturation.
- Whitening: continuous function of `sigEnergy` (stage-like, but no discrete stage machine).
- Pearson swirl: driven by `pearsonSpin` / `pearsonPhase`; direction is positive/negative correlation; stillness near |r| < 0.05.
- Significance pulse: expanding ring when `sigEnergyRender` crosses `SIG_PULSE_THRESHOLD`.

## HUD + Controls

Bottom bar shows shortcuts, current state, and mode/speed.

Hotkeys:

- `?` toggle help modal
- `L` toggle legend
- `` ` `` toggle dev/debug panel
- `M` toggle mode (Wow/Mellow)
- `1-5` set response speed
- `D` toggle demo mode
- `Escape` close modals / stop demo

## Demo Mode

- Cycles through all dominant channels in `DEMO_CHANNELS` (now includes Pearson)
- Uses a smooth sin² envelope
- Ends with an “anomaly” segment (baseline + significance)

## QRNG Integration Plan (Future Work)

Preferred architecture (avoid CORS + jitter):

1. SvelteKit backend endpoint (e.g. `GET /api/qrng?bytes=...`) that returns raw bytes
2. Client-side byte pool / ring buffer
3. Seamless fallback to `crypto.getRandomValues()` if pool runs dry

Chunk sizes: start with 64KB or 256KB per request.

## Tuning Notes

If you need to adjust feel, try in this order:

1. `sampleBits` and `updatesPerSec`
2. `sigEnergy` rise/fall time constants (via presets + speed)
3. channel thresholds (`STRENGTH_Z_START`, `STRENGTH_Z_FULL`, stick thresholds, Pearson thresholds)
4. dominance hysteresis (`switchMargin`, `keepBonus`)
5. purely visual parameters in `renderOrb()`
