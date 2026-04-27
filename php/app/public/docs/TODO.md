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

## Todo

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


---
### High Value, Lower Effort
1. **Boot sequence polish** - The CRT ignition effect is still there but might need tuning now that stages are gone. Could make it more dramatic.
2. **Baseline visual** - When nothing is happening, the orb just wanders between hues. Could be more interesting/alive - subtle breathing, shimmer, etc.
3. **Cheat channel cycling** - Currently `C` always boosts `correlated_high`. Could cycle through channels or pick randomly for testing.

### Medium Value, Medium Effort
4. **Audio/sound design** - Subtle ambient tones that shift with channel/intensity. Not documented in Wyrd, but could add to the experience.
5. **Mobile/touch support** - Tap to toggle HUD, swipe for settings, etc.
6. **Persistence** - Save mode/speed preferences to localStorage.

### Visual Polish
7. **Orb texture refinement** - The swirling disc is new and might need tuning for visibility vs subtlety.
8. **Color palette tuning** - The new 6 colors are educated guesses. Might want to adjust after seeing them in action.
9. **Glow/bloom refinement** - The outer glow could be more dramatic at high significance.

### Documentation / UX
10. **Onboarding** - First-time users have no idea what they're looking at. A brief intro or "what am I seeing?" mode.
11. **URL params** - Allow sharing specific mode/speed configurations via URL.
---