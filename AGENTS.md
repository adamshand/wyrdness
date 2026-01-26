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
- `findOptimalStartingPointCorrelated()` and `findOptimalStartingPointAnti()` do joint searches over both streams, finding windows where both streams are deviating in the required direction simultaneously. This gives all channels a fair chance (previously correlated/anti were handicapped).
- `findOptimalStartingPointAgreement()` searches for excess bit-by-bit agreement (one-sided, only positive z counts).
- `findOptimalStartingPointPearson()` searches for correlation using Fisher z-transformation.

Strength mapping:

- Channel strength thresholds are now controlled by the **sensitivity** setting (see below).
- Each channel maps its z-score through `zStart` → `zFull` to produce a 0..1 strength.
- Thresholds are calibrated to the null distribution of "max z over ~120 windows".

## Sensitivity

Controls how often non-baseline events occur under pure randomness:

- `conservative`: Higher thresholds, rare events. Best for long sessions where significance should be meaningful.
- `moderate` (default): Balanced thresholds. Good for most group sessions.
- `engaging`: Lower thresholds, more frequent activity. Good for demos and active exploration.

Each sensitivity level sets different z-score thresholds for channel detection:

| Sensitivity  | strengthZStart | stickZStart | Effect                  |
| ------------ | -------------- | ----------- | ----------------------- |
| conservative | 2.4            | 3.4         | Rare channel activation |
| moderate     | 2.0            | 2.9         | Balanced                |
| engaging     | 1.7            | 2.6         | Frequent activity       |

Hotkey: `S` cycles through sensitivity levels.

## Dominant Channel Selection

We pick a `dominant` channel (winner-takes-most + hysteresis) to choose the base hue:

- `dominanceThreshold` (from sensitivity preset): minimum strength to leave baseline
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
  - apply empirical calibration to correct for max-over-windows bias:
    - stick: divide by `P_NULL_STICK = 0.05` (empirical median under null)
    - pearson: divide by `P_NULL_PEARSON = 0.016` (empirical median under null)
    - corr/anti: no correction needed (already well-calibrated)
  - take min across all channels, then divide by `P_NULL_MIN6 = 0.11` (expected median of min(6 uniform))
  - cap at `COHERENCE_FLOOR = 0.35`
  - surprisal transform: `S = -log10(pOverall)`
  - map to 0..1 with `targetSig = clamp01((S - 0.3) / 5.0)` and smooth with mode preset

## Visual Model

- Boot: ~5s CRT-ish ignition. While booting, dominance is forced to baseline and no ticks are processed.
- Base hue: derived from dominant channel; smoothed with `hueTauMs` (faster during demo).
- Saturation: mode-smoothed; baseline is desaturated; Pearson dominant is also reduced saturation.
- Whitening: continuous function of `sigEnergy` (stage-like, but no discrete stage machine).
- Pearson swirl: driven by `pearsonSpin` / `pearsonPhase`; direction is positive/negative correlation; stillness near |r| < 0.05.
- Significance pulse: expanding ring when `sigEnergyRender` crosses `SIG_PULSE_THRESHOLD`.

## HUD + Controls

Bottom bar shows shortcuts, current state, mode, and sensitivity.

Hotkeys:

- `?` toggle help modal
- `L` toggle legend
- `` ` `` toggle dev/debug panel
- `M` toggle mode (Wow/Mellow)
- `S` cycle sensitivity (Conservative/Moderate/Engaging)
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
2. `sigEnergy` rise/fall time constants (via presets)
3. channel thresholds (`STRENGTH_Z_START`, `STRENGTH_Z_FULL`, stick thresholds, Pearson thresholds)
4. dominance hysteresis (`switchMargin`, `keepBonus`)
5. purely visual parameters in `renderOrb()`
