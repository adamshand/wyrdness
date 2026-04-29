# Agent Notes (Project Continuation Guide)

This repository contains Wyrdness, a buildless PHP/Kawhi web app that reverse engineers the _experience_ of the Wyrd Light / Wyrdoscope as a screen-shareable “lamp”.

Primary goals:

- no jitter
- no dangerous flashing/strobing (use soft pulse/bloom/ring effects instead of seizure-risk strobe)
- minimal UI for Zoom / screen sharing

## Where The Implementation Lives

- `app/public/page.js` + `app/public/index.php` + `app/public/page.css`
  - active buildless PHP/Kawhi implementation
  - signal engine orchestration, canvas orb renderer, HUD, hotkeys, debug/agent stream
  - uses `app/public/signal-core.js` for shared detector math
  - uses `app/public/calibration.js` generated from checked-in calibration reports

- `app/public/signal-core.js`
  - shared browser/Node detector core
  - starting-point searches, walk-distance detector, empirical p lookups, full runtime signal computation
  - tools should call this instead of duplicating runtime detector formulas

- `tools/`
  - `calibrate-walk-detectors.js` — empirical null calibration for Channel 3min/3max-style walk close/apart ratios
  - `calibrate-signal-stack.js` — empirical null calibration for corr/anti/Pearson and full min-across-channels statistic
  - `generate-runtime-calibration.js` — generates `app/public/calibration.js`
  - `validate-signal-null.js` — validates null dominance and calibrated p rates
  - `validate-session-events.js` — validates session-level stage and pulse rates
  - `check-calibration-sync.js` — verifies generated runtime calibration is in sync

- `v1/src/routes/+page.svelte`
  - original SvelteKit implementation/reference only

Reference material:

- `docs/WYRDLIGHT.md` (reverse-engineering guide)
- `Wyrd-Light-Data-and-Colours.pdf` (local copy of Wyrd's public colour/channel mapping, linked from their FAQ)
- `FEEDBACK.md` (historical calibration review; most issues have since been addressed)

## Current Signal Model

We simulate two random bit streams A/B (0/1). Each signal tick (default 1Hz), we generate a fresh 200-bit sample for each stream. Each tick updates:

- instantaneous sample aggregates (counts, Pearson inputs)
- cumulative random-walk sums, used for starting-point detection

Runtime parameters come from `window.WyrdCalibration.params`:

- `sampleBits` (currently 200)
- `maxLookback` (currently 120)
- `minSegmentLen` (currently 3)

Important: `reseed()` resets buffers and all smoothed state (`coherence`, `sigEnergy`, `dominant`, pulse state, etc.) to avoid confusing transients.

## Raw Detectors and Visual Channels

Raw detector channels:

- `correlated_high`: both streams have more 1s than expected
- `correlated_low`: both streams have more 0s than expected
- `anti_ab`: A has more 1s, B has more 0s
- `anti_ba`: B has more 1s, A has more 0s
- `stick`: Channel 3min-like random-walk closeness / minimum-distance detector
- `walk_separate`: Channel 3max-like random-walk separation / maximum-distance detector
- `pearson`: Pearson correlation over the selected segment

User-facing visual channels:

- **red / parallel**: `max(correlated_high, correlated_low)`
- **amber / antiparallel**: `max(anti_ab, anti_ba, walk_separate)`
- **blue / stick together**: `stick`
- **green / Pearson**: `pearson`
- **baseline**: dim, very slow colour wandering when no pattern dominates

Keep directional internals (`high`/`low`, `A high/B low`, `B high/A low`, Pearson +/-) in the debug panel. Do **not** expose those as separate user-facing colours unless a future visual design needs them.

## Calibration and Significance

The runtime detector stack is empirically calibrated against synthetic independent A/B streams generated with `node:crypto.randomBytes`.

Calibration layers:

1. Walk close/apart ratio tables for `stick` and `walk_separate`.
2. Channel-specific tables for selected corr/anti/Pearson statistics after adaptive start-point search.
3. A full-stack `pMinRaw` lower-tail table for the exact runtime min-across-channels statistic.

Runtime flow:

- `CORE.computeRuntimeSignal(...)` returns raw detector scores, per-channel calibrated p-values, `pMinRaw`, and `pOverallCalibrated`.
- Channel visual strengths are mapped from calibrated per-channel p-values via sensitivity-specific `channelPStart` / `channelPFull`.
- Brightness/significance uses `pOverallCalibrated`, then applies a separate display floor (`COHERENCE_FLOOR`) only for ambience.
- Do not label display-floored p as a true statistical p-value.

Current runtime tables are capped at `minSupportedTail = 0.0001` where applicable. More extreme observations should be described as below the supported table range, not as precise rarer probabilities.

## Sensitivity

Sensitivity controls how often non-baseline visual channels appear under pure randomness. Keep these public labels:

- `engaging` ~= Wyrd Beginner (easiest to activate)
- `moderate` ~= Wyrd Intermediate
- `conservative` ~= Wyrd Advanced (hardest to activate)

Current sensitivity presets use calibrated p thresholds:

| Sensitivity  | channelPStart | channelPFull | Effect |
| --- | ---: | ---: | --- |
| conservative | 0.005 | 0.0001 | rare channel activation |
| moderate | 0.02 | 0.0003 | balanced/default |
| engaging | 0.05 | 0.001 | frequent activity |

Hotkey: `S` cycles through sensitivity levels.

## Dominant Channel Selection

We pick a `dominant` visual channel (winner-takes-most + hysteresis) to choose the base hue:

- `dominanceThreshold` comes from sensitivity preset
- `switchMargin` + `keepBonus` come from mode preset
- `dominance` is smoothed with asymmetric tau (1200ms rise, 1800ms fall)

Palette:

- `baseline`: dim, slow wandering through softened official colours
- `parallel`: red
- `antiparallel`: amber
- `stick_together`: blue
- `pearson`: green

## Visual Model

Current code:

- Boot: ~5s CRT-ish ignition. While booting, dominance is forced to baseline and no signal ticks are processed.
- Base hue: derived from dominant channel, or slow official-colour wandering in baseline.
- Saturation: mode-smoothed; baseline is desaturated; Pearson is slightly pearly/desaturated.
- Stage-like brightness/bloom is driven by smoothed `sigEnergyRender`.
- Pearson swirl is driven by `pearsonSpin` / `pearsonPhase`; direction comes from positive/negative correlation.
- Anomaly pulse ring is triggered from raw calibrated significance (`pOverallCalibrated <= 0.0005`) with cooldown, not from the smoothed brightness envelope. This lets rare short events ring without making the whole orb jittery or overly bright.
- Demo mode still forces a staged anomaly segment for demonstration.

Safety:

- Do **not** copy Wyrd's official Wow-mode white strobe.
- Use safe expanding rings, bloom, and soft pulse effects only.

## HUD + Controls

Bottom bar shows shortcuts, current state, mode, and sensitivity.

Public controls:

- Mode: `Mellow` / `Wow`
- Sensitivity: `Conservative` / `Moderate` / `Engaging`
- Demo: on/off

Do not expose Wyrd software's Standard/Dynamic distinction as a main UI control yet. Let `Mellow` behave calmer/stabler and `Wow` behave more dynamic/dramatic internally.

Hotkeys:

- `?` toggle help modal
- `L` toggle legend
- `` ` `` toggle dev/debug panel
- `M` toggle mode (Wow/Mellow)
- `S` cycle sensitivity (Conservative/Moderate/Engaging)
- `D` toggle demo mode
- `Shift+L` open a timestamped CSV session log in a new tab
- `Escape` close modals / stop demo

## Agent/debug mode

Open the app with `?agent=1` to enable an agent-readable debug stream.

Example: `https://wyrdness.sites.haume.nz/?agent=1`

This automatically opens the debug panel, adds a compact on-page stream, logs `WYRD_AGENT {...}` JSON snapshots once per second, and exposes:

- `window.__wyrdAgent.snapshot()` — current structured state
- `window.__wyrdAgent.history()` — recent snapshots
- `window.__wyrdAgent.text()` — compact text stream
- `window.__wyrdAgent.clear()` — clear recorded snapshots

Use this instead of screenshots when tuning channel thresholds, dominance, significance, or visual stages.

## Demo Mode

- Cycles through the four visual channels in `DEMO_CHANNELS`.
- Uses a smooth sin² envelope.
- Ends with an “anomaly” segment (baseline + significance/pulse demonstration).

## Response Speed (Future Work)

Official Wyrd Light exposes a 5-step response speed setting, from once per second to once every 5 seconds. Wyrdness currently keeps the public UI simpler and uses `Mellow` / `Wow` plus sensitivity to shape responsiveness.

Future version may add a response speed control:

- cadence = how often new signal values are computed/applied (1s..5s)
- style = how Mellow/Wow renders those values

## QRNG Integration Plan (Future Work)

Preferred architecture (avoid CORS + jitter):

1. PHP backend endpoint returning random bytes from a QRNG provider/cache.
2. Client-side byte pool / ring buffer.
3. Seamless fallback to `crypto.getRandomValues()` if the pool runs dry.

Chunk sizes: start with 64KB or 256KB per request.

## Tuning Notes

If you need to adjust feel, try in this order:

1. `sampleBits`, `maxLookback`, `minSegmentLen` — recalibrate if these change.
2. `sigEnergy` rise/fall time constants via mode presets.
3. sensitivity `channelPStart` / `channelPFull` thresholds.
4. dominance hysteresis (`switchMargin`, `keepBonus`).
5. anomaly pulse p threshold and cooldown; then re-run `tools/validate-session-events.js`.
6. purely visual parameters in `renderOrb()`.
