Yes — you’ve done **one important calibration correctly**, but it is not yet a full calibration of the statistical display.

My read is:

> **The walk-distance calibration is a solid fix for Channel 3min / 3max-style blue/amber distance behaviour. But the overall “p-value”, full channel competition, Pearson channel, and visual event-rate claims are still not fully calibrated.**

## What you did well

The `calibrate-walk-detectors.js` script is doing the right kind of thing for the walk-distance detector. It generates independent synthetic A/B bit streams with `node:crypto.randomBytes`, uses 200 bits per stream per tick, searches the same 120-tick lookback window with the same minimum segment length of 3, and records the **best-over-window** close/apart ratios rather than pretending a fixed-window normal approximation is valid. That is exactly the right conceptual move for the blue “stick together” and amber “walk separate” channels. ([GitHub](https://github.com/adamshand/wyrdness/blob/main/tools/calibrate-walk-detectors.js))

The output JSON confirms the calibration run used:

```text
ticks: 1,000,000
recorded samples: 999,880
sampleBits: 200
maxLookback: 120
minSegmentLen: 3
randomSource: node:crypto.randomBytes
search: best close=min ratio and best separate=max ratio over candidate starts
```

and it stores lower-tail thresholds for close/stick and upper-tail thresholds for separate/apart. ([GitHub](https://raw.githubusercontent.com/adamshand/wyrdness/main/tools/calibration/walk-distance-200bit-lookback120-1m.json))

That is a meaningful improvement over the old guessed `ratioSigma` / legacy-z path. The tool even explicitly treats the old guessed z transform as diagnostic only, which is good. ([GitHub](https://github.com/adamshand/wyrdness/blob/main/tools/calibrate-walk-detectors.js))

## The main problem: this calibrates only the walk detector

The calibration file is for:

```text
walk close ratio
walk separate ratio
```

It does **not** calibrate the full stack:

```text
parallel high
parallel low
anti AB
anti BA
walk close
walk separate
Pearson
min across channels
dominant colour
smoothed brightness
stage/pulse rates
```

The runtime now uses the empirical walk tables for `walkCloseP` and `walkSeparateP`, which is good. In `page.js`, those values drive the stick and walk-separate visual strengths via `strengthFromP(...)`. ([GitHub](https://github.com/adamshand/wyrdness/blob/main/app/public/page.js))

But the other channels are still mostly formula-based or scalar-adjusted. In particular, the overall p-ish value still does this:

```js
const pCorrHigh = pFromSegmentZ(corrHighZ);
const pCorrLow = pFromSegmentZ(corrLowZ);
const pAntiAb = pFromSegmentZ(antiAbZ);
const pAntiBa = pFromSegmentZ(antiBaZ);
const pStick = walkCloseP;
const pWalkSeparate = walkSeparateP;
const pPearson = Math.min(1, pFromSegmentZ(pearsonZSeg) / P_NULL_PEARSON);

const pMinRaw = Math.min(
  pCorrHigh,
  pCorrLow,
  pAntiAb,
  pAntiBa,
  pStick,
  pWalkSeparate,
  pPearson
);

const pOverallCalibrated = Math.min(1, pMinRaw / P_NULL_MIN_CHANNELS);
```

with constants:

```js
const P_NULL_PEARSON = 0.016;
const P_NULL_MIN_CHANNELS = 0.11;
```

([GitHub](https://github.com/adamshand/wyrdness/blob/main/app/public/page.js))

That means the look-elsewhere problem is only fixed for the walk-distance subchannels. It is **not fixed** for the full “minimum across channels after adaptive search” statistic.

## The validation run shows the improvement, but also shows this is not fully calibrated

The `validate-signal-null.js` script is useful. It compares the old uncalibrated walk wiring against the calibrated walk wiring. The result is dramatic:

```text
moderate current uncalibrated:
  antiparallel ≈ 90.09%
  stick_together ≈ 9.80%
  baseline ≈ 0.11%

moderate calibrated walk:
  baseline ≈ 96.42%
  parallel ≈ 0.87%
  antiparallel ≈ 1.60%
  stick_together ≈ 1.11%
  pearson ≈ 0%
```

So the walk calibration clearly fixed the pathological behaviour where amber/stick dominated almost all null ticks. ([GitHub](https://raw.githubusercontent.com/adamshand/wyrdness/main/tools/calibration/signal-null-validation-1m.json))

But the same validation report gives this for the calibrated `pMin` distribution:

```text
pMin q50 ≈ 0.155
pMin q05 ≈ 0.0190
pMin q01 ≈ 0.00301
```

([GitHub](https://raw.githubusercontent.com/adamshand/wyrdness/main/tools/calibration/signal-null-validation-1m.json))

That is the giveaway. A calibrated p-value should be roughly uniform under the null, so its 50th percentile should be about `0.5`, its 5th percentile about `0.05`, and its 1st percentile about `0.01`.

Now, `pMin` itself is expected not to be uniform because it is the minimum of several channel p-values. That is fine. But then the next step should be:

```text
empirically calibrate pMin itself
```

not:

```js
pOverallCalibrated = pMinRaw / 0.11
```

A scalar division by `P_NULL_MIN_CHANNELS` is a rough visual normalization, not a proper p-value calibration.

## Important mismatch: validation `pMin` is not exactly runtime `pMin`

There is also a specific mismatch between `validate-signal-null.js` and `page.js`.

In the validator, `pMin` includes this old agreement channel:

```js
const pStickAgree = Math.min(
  1,
  (stickAgreeZ > 0 ? oneSidedPFromZ(stickAgreeZ) : 1) / 0.05
);

bucket.pMin[recorded] = Math.min(
  pCorrHigh,
  pCorrLow,
  pAntiAb,
  pAntiBa,
  pStickAgree,
  pClose,
  pSeparate,
  pPearson
);
```

([GitHub](https://github.com/adamshand/wyrdness/blob/main/tools/validate-signal-null.js))

But current `page.js` does **not** include `pStickAgree` in `pMinRaw`; it uses only:

```js
pCorrHigh
pCorrLow
pAntiAb
pAntiBa
walkCloseP
walkSeparateP
pPearson
```

([GitHub](https://github.com/adamshand/wyrdness/blob/main/app/public/page.js))

So the validation `pMinQuantiles` are not exactly for the runtime statistic. They are close in spirit, but not exact. If you use validation output to calibrate the app, the validation script should compute the exact same `pMinRaw` expression as `page.js`.

## The walk tail table has a discrete-tail issue

The close/stick calibration has duplicate zero thresholds:

```json
"lowerTailThresholds": [
  [0.5, 0.331349...],
  ...
  [0.0002, 0.030227...],
  [0.0001, 0.030227...],
  [0.00005, 0],
  [0.00001, 0]
]
```

([GitHub](https://raw.githubusercontent.com/adamshand/wyrdness/main/tools/calibration/walk-distance-200bit-lookback120-1m.json))

In runtime, the table is embedded in ascending-threshold order and `empiricalTailP` returns the first p-value when the value is below the first threshold. For close ratio `0`, that means the app returns `p = 0.00001`. ([GitHub](https://github.com/adamshand/wyrdness/blob/main/app/public/page.js))

But because the calibration table has both:

```text
p = 0.00005 -> threshold 0
p = 0.00001 -> threshold 0
```

the empirical probability of `closeRatio <= 0` is not really known as `0.00001`; it is at least around the `0.00005` level in that run, and possibly nearer the next quantile depending on the exact number of zero samples.

This is small, but it matters in the far tail. For duplicate thresholds, the conservative rule should be:

```text
same threshold => use the largest p associated with that threshold
```

So for `threshold = 0`, use `0.00005`, not `0.00001`, unless you store exact counts and know better.

## One million ticks is decent, but thin in the far tail

For the visual thresholds you are using, one million ticks is probably enough to get a useful first calibration around `p = 0.001` to `p = 0.0001`.

But the table includes `0.00001`. With one million samples, a `1e-5` tail has only about 10 expected observations before accounting for serial overlap. That is noisy. For anything you want to call “1 in 100,000” or rarer, I would want more data, or I would cap the claim as:

```text
p <= 1e-5 under this calibration table
```

rather than treating it as a precise p-value.

The overlap issue matters too. Consecutive ticks share most of the same 120-tick lookback context, so the 999,880 recorded samples are not independent event observations. That does not make the marginal quantile table useless, but it does make event-frequency claims like “one per N minutes” much harder. Those should be calibrated using simulated **sessions**, not per-tick samples.

## Pearson is still not properly calibrated

The Pearson path is still using:

```js
const pPearson = Math.min(1, pFromSegmentZ(pearsonZSeg) / P_NULL_PEARSON);
```

([GitHub](https://github.com/adamshand/wyrdness/blob/main/app/public/page.js))

That is the same scalar-normalization problem as before. Pearson is also selected after scanning start points, so its selected `z` is not a normal fixed-window z. The right approach is to calibrate the selected Pearson statistic directly:

```text
simulate null streams
run findOptimalStartingPointPearson(...)
record abs(bestPearsonZ) or selected p
build empirical upper-tail table
```

Then replace `P_NULL_PEARSON` with a Pearson-specific empirical table.

There is also still a visual/statistical mismatch: green visual strength is based on `Math.abs(pearson.r)` thresholds, while the p-ish value uses Fisher-z-derived `pearsonZSeg`. ([GitHub](https://github.com/adamshand/wyrdness/blob/main/app/public/page.js)) A short segment with a high `r` and a long segment with the same `r` are not statistically equivalent. If green is supposed to represent statistical unusualness, drive green strength from calibrated Pearson p, not raw `r`.

## Parallel and antiparallel are still not calibrated either

The parallel and antiparallel channels use selected start-point z-like scores:

```js
findOptimalStartingPointCorrelated(...)
findOptimalStartingPointAnti(...)
```

and then visual strength comes from:

```js
strengthFromZ(...)
```

while p-values come from:

```js
pFromSegmentZ(...)
```

([GitHub](https://github.com/adamshand/wyrdness/blob/main/tools/validate-signal-null.js))

Those selected scores are not fixed-window normal z-scores. They should get their own empirical null tables too:

```text
corrHighZ upper tail
corrLowZ upper tail
antiAbZ upper tail
antiBaZ upper tail
```

This is less obviously broken than the old walk detector, but it is still not statistically calibrated.

## The display floor still makes `pOverall` semantically unsafe

Runtime still has:

```js
const pOverallReal = Math.min(COHERENCE_FLOOR, pOverallCalibrated);
```

with:

```js
const COHERENCE_FLOOR = 0.35;
```

([GitHub](https://github.com/adamshand/wyrdness/blob/main/app/public/page.js))

That means ordinary null data can be forced down to `p = 0.35` for display. That may be fine for visual ambience, but it should not be stored or labelled as “real” p.

I would split it:

```js
const pOverallTrue = empiricalTailP(pMinRaw, FULL_STACK_PMIN_LOWER_TAIL, 'lower');

const pOverallDisplay = Math.min(COHERENCE_FLOOR, pOverallTrue);
```

or even better:

```js
const visualEnergy = idleGlow + (1 - idleGlow) * strengthFromP(pOverallTrue, ...);
```

The key point is: never overwrite a statistical value with a rendering floor.

## What I’d change

### 1. Keep the walk calibration

This part is useful. I would keep the walk-distance calibration, but make the tail table more conservative around duplicate thresholds.

For duplicate threshold values, use the largest p for that threshold:

```js
function dedupeLowerTailConservative(rows) {
  const byThreshold = new Map();

  for (const [p, threshold] of rows) {
    const previous = byThreshold.get(threshold);
    byThreshold.set(threshold, previous == null ? p : Math.max(previous, p));
  }

  return [...byThreshold.entries()]
    .map(([threshold, p]) => [p, threshold])
    .sort((a, b) => a[1] - b[1]);
}
```

For the close table, that would prevent `closeRatio = 0` from being reported as more extreme than the calibration actually supports.

### 2. Add a full-stack calibration table

Add a new tool, something like:

```text
tools/calibrate-signal-stack.js
```

It should run the exact runtime detector stack and record:

```text
corrHighZ
corrLowZ
antiAbZ
antiBaZ
walkCloseRatio
walkSeparateRatio
pearsonAbsZ
pMinRawRuntime
dominantChannel
targetSig
stage
```

Then output tables like:

```js
CORR_HIGH_UPPER_TAIL
CORR_LOW_UPPER_TAIL
ANTI_AB_UPPER_TAIL
ANTI_BA_UPPER_TAIL
PEARSON_ABS_Z_UPPER_TAIL
FULL_STACK_PMIN_LOWER_TAIL
```

The most important one is:

```js
FULL_STACK_PMIN_LOWER_TAIL
```

Then replace:

```js
const pOverallCalibrated = Math.min(1, pMinRaw / P_NULL_MIN_CHANNELS);
```

with:

```js
const pOverallCalibrated = empiricalTailP(
  pMinRaw,
  FULL_STACK_PMIN_LOWER_TAIL,
  'lower'
);
```

That fixes the “min across channels” look-elsewhere problem directly.

### 3. Make validation compare expected vs observed false-positive rates

The current validator reports quantiles and dominance percentages. Useful, but I’d add explicit checks:

```text
For calibrated pOverall:
  threshold 0.10 -> observed ≈ 0.10
  threshold 0.05 -> observed ≈ 0.05
  threshold 0.01 -> observed ≈ 0.01
  threshold 0.001 -> observed ≈ 0.001
```

For example, the report should say:

```json
"pOverallCalibrationCheck": {
  "0.1": 0.102,
  "0.05": 0.049,
  "0.01": 0.0104,
  "0.001": 0.0011
}
```

That makes it immediately obvious whether the final displayed p-value is calibrated.

### 4. Validate session/event rates separately

For visual claims, don’t rely only on per-tick p-values. Simulate sessions:

```text
10-minute sessions
1-hour sessions
same updatesPerSec
same smoothing
same stage thresholds
same pulse cooldown
same dominance logic
```

Then report:

```text
Moderate mode:
  Stage 1 appears in X% of 10-minute null sessions
  Stage 2 appears in Y% of 10-minute null sessions
  Stage 3 appears in Z% of 10-minute null sessions
  median number of pulse rings per hour = N
```

That is what you need for honest UI copy like “roughly one per ten minutes.”

### 5. Share code between runtime and tools

Right now the signal logic is duplicated between `page.js`, `calibrate-walk-detectors.js`, and `validate-signal-null.js`. The duplicated code looks broadly aligned, but the `pStickAgree` mismatch shows how easy it is for the validator to drift from the app.

I’d move the pure detector code into a shared module, for example:

```text
app/public/signal-core.js
tools/signal-core-node.js
```

or just a single ESM module if you can make browser/Node random sources injectable.

The API could be:

```js
createSignalEngine({
  sampleBits: 200,
  maxLookback: 120,
  minSegmentLen: 3,
  randomSource
});
```

Then the browser and calibration tools use the same detector implementation.

## Bottom line

The calibration run is appropriate for **walk close / walk separate**. It fixes the worst old issue with the distance channels.

It is not yet appropriate to treat the app’s final `pOverallCalibrated` as a properly calibrated p-value, because:

```text
only walk channels are empirically calibrated;
parallel/anti/Pearson still use selected z with formula/scalar correction;
pMin is normalized by a constant instead of its empirical null CDF;
the validator’s pMin does not exactly match runtime pMin;
the display floor still contaminates the p-value path;
session-level visual event rates are not calibrated.
```

My recommendation: keep the walk tables, but add a second calibration layer for the **exact runtime full-stack statistic** and replace `P_NULL_MIN_CHANNELS` with an empirical `FULL_STACK_PMIN_LOWER_TAIL` table. That would make the statistics much cleaner.