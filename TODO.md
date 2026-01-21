# Analysis Summary

## What the Current Implementation Has

Signal Model (well-implemented):
- 200-bit samples per tick at 1Hz - matches Wyrd's description
- Four channel types: Correlated, Anti-correlated, Stick-together, Pearson
- Z-score based channel strengths with configurable thresholds
- Pearson correlation with Fisher transformation
- P-value calculations via normal CDF
- Dominant channel selection with hysteresis
Visual System (good foundation):
- Three-stage brightness model with energy integrators
- Smooth color transitions with hue wandering for baseline
- Pearson expressed as rotating ring + stage 3 iridescence
- Boot/CRT ignition effect
- Signal strip chart mode for debugging
Key Gaps vs. WYRDLIGHT.md
Based on the documentation, here are reasonable next steps to better reproduce the Wyrd Light behavior:
---

## Recommended Next Steps

1. Cumulative Deviation / Starting Point Detection (High Priority)
The documentation strongly emphasizes that Wyrd uses cumulative sums / random walks with starting point detection, not just instantaneous per-sample statistics:
> "Each data point (e.g. a peak in the data) has two properties – a height and a starting point."  
> "The SP is the segmentation that comes out of the data."
Current state: The implementation only looks at instantaneous 200-bit samples.
What to add:
- Maintain cumulative sums for each stream (random walk style)
- Implement change-point detection to find when "structures" begin
- Track episode duration, not just instantaneous strength
- This would give the "story-like" quality where episodes have beginnings and endings

2. Episode-Driven Behavior with Persistence (High Priority)
The documentation says:
> "Peaks have duration... Once a structure is detected with a starting point, it tends to persist until the z-score decays significantly."
Current state: The system smooths values but doesn't have explicit "episode" tracking.
What to add:
- Track when an episode starts (threshold crossing)
- Maintain episode state until it decays below a lower threshold
- This gives the "builds towards increasing brightness" feel described in the docs

3. Expand to 6-7 Channels (Medium Priority)
The documentation mentions 7 channels in the app pipeline, but only 4 basic patterns are described. The current implementation has 4.

Possible breakdown (from WYRDLIGHT.md inference):
1. Correlated High (both toward 1s)
2. Correlated Low (both toward 0s)
3. Anti-correlated A>B
4. Anti-correlated B>A
5. Stick Together
6. Pearson Positive
7. Pearson Negative

What to add:
- Split correlated/anti into directional variants
- Split Pearson into positive/negative directions
- This could give more color variety and "story" differentiation

4. "Wow" vs "Mellow" Modes (Medium Priority)
The Wyrd Light has two explicit modes plus 5 speed settings.
What to add:
- A mode selector (currently only updatesPerSec is adjustable)
- "Wow" mode: faster response, higher saturation, more responsive brightness
- "Mellow" mode: slower response, softer transitions, better for meetings/retreats

5. QRNG Integration (Lower Priority, but planned)
AGENTS.md already outlines the architecture:
- Backend endpoint to fetch from qrandom.io
- Client-side byte pool with async refill
- Fallback to crypto.getRandomValues()
This would move from pseudo-RNG to quantum RNG, matching the Wyrd Light's stored quantum data concept.

6. Visual Refinements (Polish)
- Brightness calibration: The docs say "dim when random; bright when significant" with a strong non-linear response. Could tune the sigEnergy → brightness mapping to be more aggressive.
- Color stability: The docs mention "stays stable in one colour for a long period" as meaningful. The current hysteresis may need tuning.
- Stage 3 "sheen": Could be more pronounced/pearl-like based on the Pearson documentation.

My Recommendation for Priority Order
| # | Task | Impact | Effort |
|---|------|--------|--------|
| 1 | Cumulative deviation + starting points | High | Medium |
| 2 | Episode persistence model | High | Medium |
| 3 | Wow/Mellow mode presets | Medium | Low |
| 4 | Expand to 6-7 channels | Medium | Medium |
| 5 | Visual brightness curve tuning | Medium | Low |
| 6 | QRNG backend integration | High (fidelity) | High |