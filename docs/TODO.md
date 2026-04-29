# TODO / Current Work Notes

## Current Implementation Snapshot

Signal and calibration:

- 200-bit samples per stream per tick, currently 1Hz.
- Shared detector core lives in `app/public/signal-core.js` and is used by runtime and validation tools.
- Raw detector families: parallel high/low, antiparallel AB/BA, walk close (`stick`), walk separate (`walk_separate`), Pearson.
- Runtime p-values are empirical lookup-table estimates generated from null simulations, including a full-stack min-across-channels calibration.
- Runtime calibration is generated into `app/public/calibration.js`; check it with `node tools/check-calibration-sync.js`.

Visual system:

- Wyrd-aligned public colours: red parallel, amber antiparallel, blue stick-together, green Pearson.
- Baseline is dim and slowly wanders through softened official hues.
- Brightness/bloom is smoothed from calibrated overall significance.
- Safe anomaly rings are triggered by raw calibrated p (`pOverallCalibrated <= 0.0005`) with cooldown, separate from smoothed brightness.
- No dangerous strobe.

Validation:

- `tools/validate-signal-null.js` checks calibrated null p rates and dominance under randomness.
- `tools/validate-session-events.js` checks session-level stage occupancy and anomaly pulse rates.
- Current 10-minute null validation gives roughly `0.121` pulses/session on average at the default anomaly p threshold.
- Current 60-minute null validation gives roughly `0.81` pulses/session on average.

## High-Value Next Steps

1. **Tune anomaly pulse threshold**
   - Current default is `p <= 0.0005`.
   - Re-run `tools/validate-session-events.js` for any threshold changes.
   - Decide the desired false pulse rate for 10-minute and 60-minute sessions.

2. **Deeper calibration**
   - Current runtime tables are useful but tail-limited.
   - If we want reliable claims below current supported tails, run larger simulations or add targeted tail calibration.

3. **Runtime/code sharing cleanup**
   - `page.js` now uses `CORE.computeRuntimeSignal(...)` for the main calibrated stack.
   - Continue moving pure math/detector logic into `signal-core.js` when practical.

4. **QRNG integration**
   - Add a backend endpoint and client byte pool.
   - Keep fallback to `crypto.getRandomValues()`.
   - Avoid introducing fetch jitter into rendering.

5. **Response speed setting**
   - Wyrd Light exposes 1–5 second response speed.
   - If added, keep it distinct from Mellow/Wow visual style.

## Visual Polish Ideas

- Make Stage 2 whitening/bloom more legible without making baseline too bright.
- Tune Pearson swirl visibility so it is readable but not distracting.
- Add subtle touch/mobile controls for help/legend/demo.
- Persist mode/sensitivity preferences in localStorage.
- Add URL params for mode/sensitivity/demo/agent presets.

## Documentation / UX

- Add a clearer first-time explanation of what colours, brightness, and anomaly rings mean.
- Avoid making strong statistical or paranormal claims in UI copy.
- If showing p-values publicly later, distinguish true calibrated p from display-floored ambience values.
