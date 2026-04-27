# WyrdWeb Next Refactor Brief: Wyrd-Aligned Colour/Channel Update

Audience: PHP/Kawhi builder agent working on the buildless PHP + vanilla JS port of WyrdWeb.

Read this first. Treat `WYRDLIGHT.md` as the deep reference/encyclopedia, not as the task list.

## Current Status

- The original Svelte/SvelteKit WyrdWeb app has been ported into Kawhi as a buildless PHP + vanilla JS implementation.
- The v1 port should preserve the existing signal/rendering feel as much as possible.
- This refactor updates the port to match newly public Wyrd documentation, especially the official colour/channel mapping in `Wyrd-Light-Data-and-Colours.pdf`.

## Product Goals

- Fullscreen, screen-shareable “lamp” experience.
- Smooth orb; no jitter.
- No dangerous flashing/strobing. Do **not** copy Wyrd Wow-mode white strobe. Use safe bloom/pulse/ring effects instead.
- Minimal public UI for non-technical users.
- Preserve technical detail in debug/dev panel for later tuning.

Public controls should stay simple:

- Mode: `Mellow` / `Wow`
- Sensitivity: `Conservative` / `Moderate` / `Engaging`
- Demo: on/off
- Help/Legend/Debug as existing toggles

Do **not** add a response-speed control in this refactor. Wyrd has a 1-5 second response-speed setting, but for now document it as future work only.

## Primary References

- `WYRDLIGHT.md` — detailed reverse-engineering notes.
- `Wyrd-Light-Data-and-Colours.pdf` — local copy of Wyrd's public colour/channel mapping.
- `Wyrd-Light-Data-and-Colours.txt` — text/OCR helper if useful.
- Existing ported JS source — preserve tuned feel where possible.

## Official Wyrd Colour Mapping to Implement

Wyrd's public mapping is:

| Visual colour | Wyrd source channels | Wyrd meaning |
| --- | --- | --- |
| Red | `max(Channel 2a, Channel 4)` | Parallel / correlated structures |
| Amber | `max(Channel 2, Channel 3max)` | Antiparallel / diverging structures |
| Blue | `Channel 3min` | Stick together / unusually similar paths |
| Green | `Channel 5` | Pearson correlation |
| N/A | `Channel 1` | Not used in Light; redundant |

For this first refactor, implement the pragmatic grouping over the existing legacy channels:

```js
visual.parallel = max(raw.correlated_high, raw.correlated_low);
visual.antiparallel = max(raw.anti_ab, raw.anti_ba);
visual.stick_together = raw.stick;
visual.pearson = raw.pearson;
```

Keep the legacy directional details in debug output:

- `correlated_high`
- `correlated_low`
- `anti_ab`
- `anti_ba`
- `stick`
- `pearson`
- Pearson sign / direction
- z-scores and start points where available

Do not expose the directional variants as separate user-facing colours in this refactor.

## Target Visual Channels

Use this visual channel vocabulary in user-facing UI, legend, demo labels, and dominance selection:

```js
baseline
parallel        // red
antiparallel    // amber
stick_together  // blue
pearson         // green
```

Suggested palette hues if the renderer uses HSL:

```js
const palette = {
  parallel: { hue: 356, name: 'Parallel' },       // red
  antiparallel: { hue: 36, name: 'Antiparallel' },// amber/orange
  stick_together: { hue: 212, name: 'Stick' },    // blue
  pearson: { hue: 135, name: 'Pearson' }          // green
};
```

Exact hue values can be tuned visually, but keep the colour families clear.

## Implementation Plan

### Phase 1 — Add visual channel aggregation layer

1. Keep the existing raw signal engine intact.
2. After raw legacy strengths are computed, create a `visualRaw` object:

```js
const visualRaw = {
  parallel: Math.max(raw.correlated_high, raw.correlated_low),
  antiparallel: Math.max(raw.anti_ab, raw.anti_ba),
  stick_together: raw.stick,
  pearson: raw.pearson
};
```

3. Store both:
   - `raw` / `rawLast` / `rawRender` for debug internals.
   - `visualRaw` / `visualLast` / `visualRender` for user-facing dominance/rendering.

4. Update dominant channel selection to choose among visual channels, not legacy channels.
5. Keep the dominant fallback as `baseline`.

Acceptance:

- App still runs smoothly.
- Dominant user-facing state is only one of: `Baseline`, `Parallel`, `Antiparallel`, `Stick`, `Pearson`.
- Debug panel still exposes the older directional channel values.

### Phase 2 — Update palette, legend, labels, and demo

1. Replace legacy palette in public UI with Wyrd-aligned palette:
   - Red = Parallel
   - Amber = Antiparallel
   - Blue = Stick together
   - Green = Pearson
2. Update bottom-bar state labels.
3. Update legend copy:

```txt
Red / Parallel: the streams drift in the same direction.
Amber / Antiparallel: the streams drift in opposite directions.
Blue / Stick together: the streams follow unusually similar paths.
Green / Pearson: Pearson correlation is dominant.
```

4. Update demo sequence to cycle through visual channels only:

```js
['parallel', 'antiparallel', 'stick_together', 'pearson']
```

5. Remove user-facing arrows for high/low/A-vs-B direction for now. Keep those in debug.

Acceptance:

- Public UI matches official red/amber/blue/green mapping.
- Demo no longer cycles through six legacy direction colours.
- Debug still shows legacy direction/sub-channel data.

### Phase 3 — Baseline behaviour

Official Wyrd guidance says baseline should remain dim and wander between colours.

Implement baseline as:

- dim
- low saturation
- very slow colour drift through softened official colours
- independent of dominant channel logic
- no sudden hue jumps

Example approach:

```js
const baselineHues = [356, 36, 212, 135];
const BASELINE_SEGMENT_SECONDS = 40; // tune 30-90s

function baselineHue(nowMs) {
  const t = nowMs / 1000 / BASELINE_SEGMENT_SECONDS;
  const i = Math.floor(t) % baselineHues.length;
  const j = (i + 1) % baselineHues.length;
  const local = t - Math.floor(t);
  const eased = smoothstep(0, 1, local);
  return hueLerpShortest(baselineHues[i], baselineHues[j], eased);
}
```

If the existing renderer already has `hueApproach`/`wrapHue`, use those helpers instead of adding duplicate utilities.

When `dominant === 'baseline'`, target the slow baseline hue and keep brightness/saturation low. When a real channel dominates, transition smoothly to that channel's hue.

Acceptance:

- Baseline is not fixed grey.
- Baseline does not look like an active anomaly.
- Baseline hue drift is slow enough that it never jitters or distracts.

### Phase 4 — Stage-like visual escalation

Wyrd Light stages from public docs:

- Stage 1: colour increases in brightness.
- Stage 2: colour moves toward white / blooms.
- Stage 3: Mellow unlocks rainbow; Wow unlocks white strobe with epilepsy warning.

WyrdWeb safety adaptation:

- Do **not** implement white strobe.
- Use existing anomaly animation: white centre/bloom plus expanding white ring/pulse.
- Optional: add subtle rainbow shimmer at high Stage 3 energy, but keep it smooth.

Map stages from existing `sigEnergyRender` or equivalent:

```js
const stage1 = sigEnergyRender > 0.12;
const stage2 = sigEnergyRender > 0.38;
const stage3 = sigEnergyRender > 0.68;
```

Tune thresholds to feel good with existing sensitivity presets.

Suggested behaviour:

- Below Stage 1: dim baseline or low channel colour.
- Stage 1: channel colour brightens.
- Stage 2: increase whitening/bloom around orb.
- Stage 3: trigger safe anomaly ring/pulse; in Wow mode make it stronger, in Mellow mode make it softer.

Pulse rules:

- Trigger on upward crossing into Stage 3 or high significance threshold.
- Use cooldown to avoid rapid repeated flashing.
- Pulse should be expansion/fade, not hard blink.

Acceptance:

- No rapid full-screen flashing.
- High significance is visibly special.
- Existing white expanding ring/anomaly animation is reused or preserved.
- Mellow remains suitable for background use.
- Wow feels more engaging but still safe.

### Phase 5 — Mode and sensitivity behaviour

Keep current public labels.

Sensitivity should roughly map to Wyrd Levels:

```txt
Engaging      ~= Wyrd Beginner      // easiest to activate
Moderate      ~= Wyrd Intermediate
Conservative  ~= Wyrd Advanced      // hardest to activate
```

Mode should remain a combined user-facing feel control:

- `Mellow`: calmer, more stable, background-friendly.
- `Wow`: more dynamic, more dramatic, active-play-friendly.

Do not expose separate `Standard/Dynamic` or `Analysis feel` controls yet.

Internally, it is OK for mode to affect:

- smoothing constants
- dominance hysteresis
- brightness ceiling
- pulse intensity
- stage visual intensity

Acceptance:

- No new confusing public controls.
- Mellow/Wow difference is visible but not jarring.
- Existing keyboard controls still work.

### Phase 6 — Debug panel requirements

Debug/dev panel should show both visual and raw layers.

Recommended sections:

```txt
Visual channels
- parallel
- antiparallel
- stick_together
- pearson
- dominant visual channel
- stage
- sigEnergy / coherence

Raw legacy channels
- correlated_high
- correlated_low
- anti_ab
- anti_ba
- stick
- pearson

Stats
- zA / zB
- zAgree or stick metric
- pearsonR
- pearson direction/sign
- start tick / segment info if available
```

Acceptance:

- Non-technical UI stays simple.
- Technical users can still inspect directional/internal data.

## Later / Not Now

Do not include these in this first Wyrd-alignment refactor unless everything above is already stable:

1. True Channel 4 approximation.
   - Wyrd: longer-term/mean absolute vertical height.
   - Future red strength should become `max(Channel 2a approximation, Channel 4 approximation)`.

2. True Channel 3max approximation.
   - Wyrd: longer-term/mean maximum distance between streams.
   - Future amber strength should become `max(Channel 2 approximation, Channel 3max approximation)`.

3. Replace/augment current bitwise `stick` detector.
   - Wyrd Channel 3min appears closer to random-walk path closeness / minimum mean distance than simple bit-by-bit equality.

4. Response speed control.
   - Official Wyrd Light supports response speed from once per second to once every 5 seconds.
   - Future WyrdWeb may add this, but not now.

5. Separate Stable/Dynamic analysis feel.
   - Possible future advanced/debug control.
   - Current public `Mellow`/`Wow` should remain the main feel control.

6. QRNG / stored-data integration.
   - Current app uses browser/server randomness depending on port.
   - Official Wyrd Light uses stored unobserved quantum random data.

7. Official Wow white strobe.
   - Do not implement due to seizure/accessibility risk.

## Testing / Manual Acceptance Checklist

Run through these before considering the refactor complete:

- [ ] Page loads without build tooling.
- [ ] Canvas fills screen.
- [ ] No console errors.
- [ ] Boot remains short; no 1-minute hardware boot emulation.
- [ ] Baseline is dim and slowly wanders through softened official colours.
- [ ] Public channel colours are red, amber, blue, green.
- [ ] Public labels are Parallel, Antiparallel, Stick, Pearson.
- [ ] Demo cycles through the four visual channels only.
- [ ] Mellow is calm and suitable as background.
- [ ] Wow is more engaging but not dangerously flashy.
- [ ] Stage 2 visibly whitens/blooms.
- [ ] Stage 3 uses safe expanding ring/pulse, not strobe.
- [ ] Sensitivity labels remain Conservative/Moderate/Engaging.
- [ ] Debug panel shows raw directional channels and visual grouped channels.
- [ ] Keyboard shortcuts still work.
- [ ] App remains smooth; no jitter introduced.

## One-Sentence Builder Summary

Refactor the port so the signal engine can keep its existing legacy directional internals, but the public lamp experience uses Wyrd's official visual grammar: dim drifting baseline, red parallel, amber antiparallel, blue stick-together, green Pearson, with stage-like brightness/whitening/safe-pulse escalation and no dangerous strobe.
