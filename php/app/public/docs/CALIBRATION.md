# WyrdWeb Calibration Plan

This note describes a practical way to calibrate WyrdWeb's statistical detectors against their behaviour under pure randomness.

The goal is not to prove anything paranormal or to exactly reproduce Wyrd's private implementation. The goal is to make WyrdWeb's visual thresholds, brightness, stage changes, and anomaly-ring events correspond to approximately consistent probabilities after accounting for the fact that the app searches many channels and many possible segment start points.

## Why Calibration Is Needed

The signal engine does not test one pre-selected window. At every tick it searches backwards over recent possible starting points and chooses the strongest-looking segment for each detector.

That creates a **look-elsewhere effect**:

- many start points are tested;
- several detector families are tested;
- the best-looking result is selected;
- raw z-scores therefore overstate significance if treated as ordinary one-shot z-scores.

So the important question is not:

> How rare is this z-score for one fixed segment?

but:

> How often would this detector, with this same start-point search, produce a score this strong during purely random data?

Calibration answers that second question empirically.

## Detectors To Calibrate

Calibrate each raw detector family separately, then calibrate the overall combined result.

Current detector families:

1. `correlated_high` — both streams high over a chosen segment.
2. `correlated_low` — both streams low over a chosen segment.
3. `anti_ab` — A high / B low over a chosen segment.
4. `anti_ba` — B high / A low over a chosen segment.
5. `stick` — Channel 3min-like random-walk closeness / unusually small path distance.
6. `walk_separate` — Channel 3max-like random-walk separation / unusually large path distance.
7. `pearson` — Pearson correlation over a chosen segment.

The public visual channels are derived from these raw detectors:

- red / parallel = strongest relevant parallel detector;
- amber / antiparallel = strongest anti-directional or walk-separation detector;
- blue / stick together = walk-closeness detector;
- green / Pearson = Pearson detector;
- anomaly ring = high-significance threshold event, not a detector channel.

## Recommended Simulation Process

### 1. Freeze runtime parameters

Calibration only applies to the parameters used during the simulation. Record these alongside the calibration data:

- `sampleBits`, currently 200;
- `updatesPerSec`, currently 1Hz;
- `MAX_LOOKBACK`;
- `MIN_SEGMENT_LEN`;
- detector formulas;
- any smoothing-free raw score formula;
- version/date/git hash if available.

If one of these changes significantly, recalibrate.

### 2. Run many random sessions

Generate synthetic random data exactly as the live app does:

- two independent random bit streams A and B;
- same bits-per-tick;
- same cumulative walk updates;
- same start-point search over lookback windows;
- same detector calculations.

For each simulated tick after warm-up, record the **best raw score** from each detector family.

Suggested minimum scale:

- quick development pass: 10,000 to 50,000 ticks;
- useful calibration pass: 500,000 to 2,000,000 ticks;
- robust tail calibration: 10,000,000+ ticks or targeted extreme-tail methods.

The higher stage/anomaly thresholds live in the tail, so small simulations can be misleading there.

### 3. Build empirical score distributions

For each detector, collect the distribution of its best score under randomness.

For a given observed score `s`, estimate:

```txt
p_detector(s) = proportion of random simulated ticks where detector_score >= s
```

This automatically includes the lookback/start-point search for that detector.

For Pearson, use the absolute value or whatever scalar score the live detector actually uses.

For walk closeness and walk separation, calibrate their final detector scores, not just the underlying distance ratios.

### 4. Calibrate the combined result

Also record, at every simulated tick, the strongest combined raw significance across detectors using the same combination rule as the app.

For example:

```txt
best_any_score = max(
  correlated_high_score,
  correlated_low_score,
  anti_ab_score,
  anti_ba_score,
  stick_score,
  walk_separate_score,
  pearson_score
)
```

Or, preferably, combine by each detector's empirical p-value:

```txt
best_any_p = min(
  p_correlated_high,
  p_correlated_low,
  p_anti_ab,
  p_anti_ba,
  p_stick,
  p_walk_separate,
  p_pearson
)
```

Then empirically calibrate the combined value too:

```txt
p_overall = proportion of random simulated ticks where best_any_p <= observed_best_any_p
```

This gives an overall p-value that includes:

- multiple detector families;
- directional variants;
- lookback/start-point search;
- the app's actual winner selection.

### 5. Convert calibrated probabilities to display strength

Once calibrated p-values are available, visual strength should be driven more by calibrated improbability than by raw z-score.

Useful transforms:

```txt
surprisal = -log10(p_overall)
```

Example reference points:

| p-value | Surprisal | Informal meaning |
| ------- | --------- | ---------------- |
| 0.1     | 1         | mildly unusual |
| 0.01    | 2         | unusual |
| 0.001   | 3         | rare |
| 0.0001  | 4         | very rare |

Stage thresholds can then be set against calibrated p or surprisal rather than uncalibrated raw channel strength.

Example starting point:

```txt
Stage 1: p_overall <= 0.10
Stage 2: p_overall <= 0.02
Stage 3: p_overall <= 0.003 to 0.001
```

These are UX choices, not claims of formal significance. They should be tuned so the orb feels alive without making Stage 3 too common.

## Sensitivity Calibration

The public sensitivity modes should ideally correspond to different calibrated thresholds, not different detector formulas.

Suggested interpretation:

- `engaging` — lower thresholds; events happen more often; good for demos.
- `moderate` — balanced thresholds; default.
- `conservative` — higher thresholds; rare events; better for long-running sessions.

For example:

| Mode | Stage 1 | Stage 2 | Stage 3/anomaly |
| ---- | ------- | ------- | --------------- |
| engaging | p <= 0.20 | p <= 0.05 | p <= 0.005 |
| moderate | p <= 0.10 | p <= 0.02 | p <= 0.002 |
| conservative | p <= 0.05 | p <= 0.01 | p <= 0.001 |

These numbers are only starting points. The final values should be chosen after observing event rates in long simulations and real sessions.

## Output Format

A calibration run should produce a compact data file checked into the app or generated during development.

Possible JSON shape:

```json
{
  "version": 1,
  "params": {
    "sampleBits": 200,
    "updatesPerSec": 1,
    "maxLookback": 120,
    "minSegmentLen": 3
  },
  "ticksSimulated": 1000000,
  "detectors": {
    "stick": {
      "scoreQuantiles": [
        { "p": 0.1, "score": 1.8 },
        { "p": 0.01, "score": 2.7 },
        { "p": 0.001, "score": 3.6 }
      ]
    }
  },
  "overall": {
    "scoreQuantiles": [
      { "p": 0.1, "score": 2.1 },
      { "p": 0.01, "score": 3.2 },
      { "p": 0.001, "score": 4.1 }
    ]
  }
}
```

The app can then interpolate between quantiles to estimate p-values from observed scores.

For better precision, store more quantile points, especially in the tail.

## Implementation Notes

- Use the same detector code as the live app wherever possible. Avoid maintaining two diverging versions of the formulas.
- Disable display smoothing during calibration. Calibrate raw detector scores and raw combined significance.
- Include warm-up ticks but do not record them until enough history exists to fill the lookback window.
- Record per-detector distributions and overall distributions separately.
- Re-run calibration when the detector formulas or lookback settings change.
- Treat extreme p-values below the simulation resolution carefully. If only 1,000,000 ticks were simulated, claims below about `1e-6` are not reliable.

## Validation Checks

After applying calibration, run another independent random simulation and verify approximate event rates.

For example, if Stage 3 is configured at `p <= 0.001`, then under pure randomness it should occur roughly once per 1,000 eligible ticks before cooldown/smoothing effects.

Because the live orb uses smoothing and cooldowns, UI-visible anomaly rings may occur less often than raw Stage 3 crossings. That is acceptable, but the distinction should be visible in debug data.

## Current Next Step

The next useful engineering step is to extract or duplicate the live detector loop into a small calibration runner that can simulate many ticks quickly without rendering the canvas.

Once that runner exists, generate empirical distributions for:

- walk closeness / blue;
- walk separation / amber;
- Pearson;
- the directional red/amber detectors;
- combined overall significance.

Then replace the current heuristic p-value mapping with interpolated empirical p-values from the calibration data.
