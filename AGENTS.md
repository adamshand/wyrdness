# Agent Notes (Project Continuation Guide)

This repository contains a SvelteKit webapp that reverse engineers the _experience_ of the Wyrd Light / Wyrdoscope as a screen-shareable “lamp”.

Primary goals:

- no jitter
- no dangerous flashing/strobing (use soft pulse/bloom/ring effects instead of seizure-risk strobe)
- minimal UI for Zoom

## Where The Implementation Lives

- `php/app/public/page.js` + `php/app/public/index.php` + `php/app/public/page.css`
  - current buildless PHP/Kawhi port that is being actively tuned
  - signal engine (200-bit samples per tick)
  - Wyrd-aligned visual channels and calibrated walk-distance Channel 3min/3max approximations
  - renderer (canvas orb), HUD, hotkeys, debug panel

- `src/routes/+page.svelte`
  - original SvelteKit implementation/reference
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
- `Wyrd-Light-Data-and-Colours.pdf` (local copy of Wyrd's public colour/channel mapping, linked from their FAQ)

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

Current code still uses the older experimental `Channel` model:

- `correlated_high`: both streams have more 1s than expected
- `correlated_low`: both streams have more 0s than expected
- `anti_ab`: A has more 1s, B has more 0s
- `anti_ba`: B has more 1s, A has more 0s
- `stick`: bit-by-bit agreement exceeds chance
- `pearson`: Pearson correlation becomes the dominant pattern
- `baseline`: fallback when no channel is strong enough

Target Wyrd-aligned visual model for the next refactor:

- **red / parallel**: Wyrd Channel 2a + Channel 4, use the stronger value
- **amber / antiparallel**: Wyrd Channel 2 + Channel 3max, use the stronger value
- **blue / stick together**: Wyrd Channel 3min
- **green / Pearson**: Wyrd Channel 5
- **baseline**: dim, very slow colour wandering when no pattern dominates

Keep the directional internals (`high`/`low`, `A high/B low`, `B high/A low`, Pearson +/-) in the debug panel for now. Do **not** expose those as separate user-facing colours unless a future visual design needs them.

Starting points:

- For each tick, we search backwards up to `MAX_LOOKBACK` ticks and choose the start index that maximizes a z-score-like statistic for that channel.
- `findOptimalStartingPointCorrelated()` and `findOptimalStartingPointAnti()` do joint searches over both streams, finding windows where both streams are deviating in the required direction simultaneously. This gives all channels a fair chance (previously correlated/anti were handicapped).
- `findOptimalStartingPointAgreement()` currently searches for excess bit-by-bit agreement (one-sided, only positive z counts). Future Wyrd-aligned work should replace or augment this with a random-walk closeness / minimum-distance detector for Channel 3min.
- `findOptimalStartingPointPearson()` searches for correlation using Fisher z-transformation.
- Future Wyrd-aligned work should add approximations for Channel 3max (long-term/mean maximum distance between streams) and Channel 4 (long-term/mean absolute vertical height).

Strength mapping:

- Channel strength thresholds are now controlled by the **sensitivity** setting (see below).
- Each channel maps its z-score through `zStart` → `zFull` to produce a 0..1 strength.
- Thresholds are calibrated to the null distribution of "max z over ~120 windows".

## Sensitivity

Controls how often non-baseline events occur under pure randomness. Keep these public labels, but tune their behavior roughly like Wyrd's Level setting:

- `engaging` ~= Wyrd Beginner (easiest to activate higher stages)
- `moderate` ~= Wyrd Intermediate
- `conservative` ~= Wyrd Advanced (hardest to activate higher stages)

Current behavior:

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

Current palette (legacy implementation):

- `baseline`: warm near-grey (fixed hue ~35, sat ~10) with slow “breathing” lightness; no hue wandering
- `correlated_high`: 170
- `correlated_low`: 238
- `anti_ab`: 50
- `anti_ba`: 350
- `stick`: 112
- `pearson`: 252 (rendered more “pearly” via reduced saturation when dominant)

Target palette (Wyrd-aligned refactor):

- `baseline`: dim, slow wandering through softened official colours
- `parallel`: red
- `antiparallel`: amber
- `stick_together`: blue
- `pearson`: green

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

Current code:

- Boot: ~5s CRT-ish ignition. While booting, dominance is forced to baseline and no ticks are processed.
- Base hue: derived from dominant channel; smoothed with `hueTauMs` (faster during demo).
- Saturation: mode-smoothed; baseline is desaturated; Pearson dominant is also reduced saturation.
- Whitening: continuous function of `sigEnergy` (stage-like, but no discrete stage machine).
- Pearson swirl: driven by `pearsonSpin` / `pearsonPhase`; direction is positive/negative correlation; stillness near |r| < 0.05.
- Significance pulse: expanding ring when `sigEnergyRender` crosses `SIG_PULSE_THRESHOLD`.

Target Wyrd-aligned visual decisions:

- Keep short web boot; the official ~1 minute boot appears to be hardware startup, not useful web UX. A gentle 5s rainbow/activation sweep is enough.
- Baseline should be dim and slowly wander through softened official colours, not fixed grey.
- Add explicit stages:
  - Stage 1: selected channel colour increases in brightness.
  - Stage 2: colour whitens/blooms toward white.
  - Stage 3: safe anomaly pulse / expanding white ring, optionally subtle rainbow shimmer.
- Do not copy the official Wow-mode white strobe directly. Use the existing anomaly pulse as a safer substitute.

## HUD + Controls

Bottom bar shows shortcuts, current state, mode, and sensitivity.

Keep public controls simple:

- Mode: `Mellow` / `Wow`
- Sensitivity: `Conservative` / `Moderate` / `Engaging`
- Demo: on/off

Do not expose Wyrd software's Standard/Dynamic distinction as a main UI control yet. Let `Mellow` behave calmer/stabler and `Wow` behave more dynamic/dramatic internally. A future advanced/debug control may separate stable vs dynamic analysis if needed.

Hotkeys:

- `?` toggle help modal
- `L` toggle legend
- `` ` `` toggle dev/debug panel
- `M` toggle mode (Wow/Mellow)
- `S` cycle sensitivity (Conservative/Moderate/Engaging)
- `D` toggle demo mode
- `Escape` close modals / stop demo

Agent/debug mode:

- Open the PHP port with `?agent=1` to enable an agent-readable debug stream.
- Example: `https://wyrdness.sites.haume.nz/?agent=1`
- This automatically opens the debug panel, adds a compact on-page stream, logs `WYRD_AGENT {...}` JSON snapshots once per second, and exposes:
  - `window.__wyrdAgent.snapshot()` — current structured state
  - `window.__wyrdAgent.history()` — recent snapshots
  - `window.__wyrdAgent.text()` — compact text stream
  - `window.__wyrdAgent.clear()` — clear recorded snapshots
- Use this instead of screenshots when tuning channel thresholds, dominance, significance, or visual stages.

## Demo Mode

- Cycles through all dominant channels in `DEMO_CHANNELS` (now includes Pearson)
- Uses a smooth sin² envelope
- Ends with an “anomaly” segment (baseline + significance)

## Response Speed (Future Work)

Official Wyrd Light exposes a 5-step response speed setting, from once per second to once every 5 seconds. WyrdWeb currently keeps the public UI simpler and uses `Mellow` / `Wow` plus sensitivity to shape responsiveness.

Future version may add a response speed control:

- cadence = how often new signal values are computed/applied (1s..5s)
- style = how Mellow/Wow renders those values

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
5. stage thresholds / pulse behavior
6. purely visual parameters in `renderOrb()`
