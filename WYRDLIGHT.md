# WYRDLIGHT Notes (Reverse-Engineering Guide)

This document collects everything we can (publicly) infer about how **Wyrd Light** and **Wyrdoscope** work.

Goal: enable future implementations to emulate the _behavior_ and _visual grammar_ of the official devices as closely as possible, while being clear about what is confirmed vs inferred.

## Scope and Constraints

- This is a reverse-engineering guide based on public statements and observable product media.
- The Wyrdoscope/Wyrd Light analysis software is described as **patented** (Wyrd Software Suite page references patent applications). We do **not** have the algorithm.
- We separate:
  - **Confirmed**: directly stated by Wyrd in public docs.
  - **Inferred**: plausible implementation details implied by their descriptions.
  - **Observed**: behavior from video/product media.

## Primary Sources (Cited)

- Wyrd FAQ (detailed technical-ish descriptions, channels, sampling, p-values, start points):
  - https://gowyrd.org/faq/
- Wyrd Light product page (modes, speed settings, baseline wandering description, activation video link):
  - https://gowyrd.org/wyrd-light/
- “How does it work?” (conceptual framing, live vs stored RNG distinction, MPI/NT-axiom narrative):
  - https://gowyrd.org/how-does-it-work/
- Wyrdoscope device page (hardware overview + user manual link):
  - https://gowyrd.org/wyrdoscope-device/
- Wyrd Software Suite page (analysis software capabilities + patents mentioned):
  - https://gowyrd.org/wyrdoscope-software-suite/
- TrueRNGpro manufacturer page (hardware RNG features + throughput):
  - https://ubld.it/products/truerngpro

## Glossary (As Used Here)

- **REG**: Random Event Generator. Wyrd uses two REGs.
- **Alice/Bob**: conventional naming for the two independent random streams.
- **Channel**: a distinct statistical “story” / detector operating on the two streams.
- **Coherence / anomaly**: Wyrd’s term for detectable structure in what should be random/unrelated streams.
- **p-value / probability**: Wyrd describes output values as probabilities that a detected pattern is due to chance.
- **Starting Point (SP)**: the inferred/algorithmic beginning time of a detected structure/peak.

## What the Devices Do (Confirmed)

### Wyrdoscope (Confirmed)

- Uses **two live quantum-based random event generators** and analyzes **correlations between their outputs**.
  - Source: “The Wyrdoscope uses two live quantum-based random event generators. It analyses correlations between their outputs.”
  - https://gowyrd.org/how-does-it-work/

- Wyrd’s standard hardware setup is based on **TrueRNGpro** devices, described as quantum tunneling based.
  - Source: “The Wyrdoscope uses TrueRNGpro devices, which generate randomness from a quantum tunneling process…”
  - https://gowyrd.org/faq/

- The Wyrdoscope + software support capturing events and aligning them with time series.
  - Sources:
    - Device features: event button, audio record/replay time-stamped.
    - https://gowyrd.org/wyrdoscope-device/
    - Software suite: “Adding/editing of events at specific timestamps…” and “Playing of recorded audio events while reviewing data”.
    - https://gowyrd.org/wyrdoscope-software-suite/

### Wyrd Light (Confirmed)

- Uses **stored** random data (two streams), not live generation.
  - Source: “The Wyrd Light, by contrast, uses stored random data—sequences that were recorded long ago…”
  - https://gowyrd.org/how-does-it-work/

- Stored data size and sampling method:
  - Uses “about **7 GB** of two synchronously produced random strings containing only 1s and 0s stored on an SD card.”
  - A pseudo random algorithm chooses a **200 bit sample** from the two strings.
  - The two samples are “interwoven through our patented algorithm to compute the results of the channels.”
  - Source: “How do the devices work? A deeper dive…” section.
  - https://gowyrd.org/faq/

- Brightness reflects coherence and significance:
  - “When random data samples… appear random, the Wyrd Light will not shine brightly.”
  - “As soon as your influence becomes statistically significant, it will begin to light up…”
  - “The stronger the effect, the brighter the light shines…”
  - Source: Wyrd Light FAQ.
  - https://gowyrd.org/faq/

- Baseline behavior:
  - “When not much is going on where the Light is, you can expect it to wander between colours and remain dim.”
  - “The brighter the Light, the smaller the probability that it is happening by chance.”
  - Source: “How do I know the Light isn’t just behaving randomly?”
  - https://gowyrd.org/wyrd-light/

- App integration (important for reverse engineering cadence/output):
  - “Each second the values are calculated from the random streams and the p-values (probabilities) are sent to the App.”
  - “There are currently 7 channels used…”
  - “The data of each channel is like a timestamp with a float value giving the probability of an anomaly.”
  - “Channel 5 is a bit of an exception as it is a Pearson correlation… and behaves differently…”
  - Source: “How do the Wyrd technologies interface with the Wyrd App?”
  - https://gowyrd.org/faq/

- User-facing “modes” and response speed:
  - “Adjustable mode – Wow (for showing off) or Mellow (for meetings and retreats)”
  - “Adjust your Light’s response speed: 5 different settings”
  - Source: Wyrd Light page.
  - https://gowyrd.org/wyrd-light/

## Channels / Pattern Types (Confirmed)

Wyrd describes channels as different statistical languages over the same two-stream input.

They list four basic patterns (channels):

1. **Correlated pattern**: both streams generate significantly more 0s or 1s at the same time.
2. **Anti-correlated pattern**: one stream generates significantly more 1s while the other generates significantly more 0s.
3. **“Stick together” pattern**: both streams generate the same 0s and 1s at the same time for a significantly long time.
4. **Pearson correlation** of the random numbers.

Source: “What are channels?”

- https://gowyrd.org/faq/

Additional channel notes:

- Wyrd indicates 7 channels are used in the App pipeline, with one channel being Pearson (described as “Channel 5” in their example).
- We do not know the other 3 channels from public material.

Source:

- https://gowyrd.org/faq/

## Significance, p-values, and “Starting Points” (Confirmed)

### p-values / probabilities are first-class outputs

- Wyrd explicitly describes the output stream as “p-values (probabilities)” per channel, sent each second.
- They emphasize brightness as a function of probability-of-chance.

Sources:

- App integration description: https://gowyrd.org/faq/
- “The brighter the Light, the smaller the probability…”: https://gowyrd.org/wyrd-light/

### Peaks have height and a starting point

Wyrd explicitly defines a “starting point” concept:

- “It is rather the z-score or p-score in a channel, which only makes sense together with a starting point (SP). The SP is the segmentation that comes out of the data.”
- “Each data point (e.g. a peak in the data) has two properties – a height and a starting point.”

Source:

- “What is a ‘starting point’ in the Wyrd data?”
- https://gowyrd.org/faq/

This implies the algorithm is not just a naive rolling-window z-test; it performs segmentation to find when a structure begins.

## What We Can Infer About the Internal Analysis

These items are not stated as implementation, but they are strongly implied by Wyrd’s descriptions.

### Sampling cadence

- The App pipeline suggests 1Hz updates: “Each second the values are calculated… and the p-values are sent to the App.”
- The Wyrd Light’s 200-bit sampling implies a natural unit of analysis.

Inference:

- Expect a loop like:
  - every second: select 200-bit segments from each stream, compute channel p-values, update state
  - between seconds: smooth output for display (light intensity should not strobe)

Source basis:

- https://gowyrd.org/faq/

### Why segmentation matters

If the system computes “starting points” for peaks, it likely:

- builds a statistic over time (e.g., random-walk / cumulative sum style detectors)
- finds the most significant recent segment (start-to-now or start-to-peak)
- reports both the “height” (strength) and “starting point” (time)

This is consistent with their note:

- “Each channel … represents the time course of a specific data pattern mainly in random walks…”

Source:

- https://gowyrd.org/faq/

### Control data / false positives

Wyrd describes a baseline/control-data modeling effort:

- “During our study… we collected 1.1 million minutes (about 2 years) of control data.”
- “… establish the normal statistical patterns of the system… calculate false positive probabilities…”

Inference:

- Their p-values may be calibrated empirically against baseline distributions rather than purely analytic formulas.

Source:

- https://gowyrd.org/faq/

### Whitening / bias handling

Wyrd describes that each REG has two quantum random chips and whitening is performed internally.
They also note an option to disable whitening (raw mode) and that effects can look higher without whitening.

Sources:

- “About the noise whitening…”
- https://gowyrd.org/faq/

Manufacturer info on modes (whitened/raw/diagnostic) and throughput:

- TrueRNGpro: “Mode Selection (Whitened, Raw, Diagnostic)” and “High Output Speed: > 3.2 Mbits / second”
- https://ubld.it/products/truerngpro

## Mapping Patterns to Color and Brightness (Confirmed + Inferred)

### Brightness

Confirmed:

- Brightness is tied to coherence/significance:
  - “We have translated that impact into the relative brightness of the Wyrd Light.”
  - “The brighter the Light, the smaller the probability that it is happening by chance.”

Sources:

- https://gowyrd.org/faq/
- https://gowyrd.org/wyrd-light/

Inference (practical implementation detail):

- A natural mapping is to use a “surprisal” transform such as `S = -log10(p)` and then smooth it with rise/fall time constants to avoid flicker.
- The device is described as “lighting up” when statistically significant, which suggests a strong non-linear response (little output at high p; strong output when p is small).

### Color

Confirmed:

- “The colours are playfully assigned to different kinds of data structure (they don’t carry specific meanings)”.
- “The colours reflect different structures manifesting in the random data, in real time.”

Sources:

- https://gowyrd.org/faq/
- https://gowyrd.org/faq/ (deep dive section)

Inference:

- A dominant-channel selection (winner-take-most) is likely, but with hysteresis/dwell to avoid rapid switching.
- Wyrd explicitly talks about “stays stable in one colour for a long period” as a meaningful observation cue, implying the UI intentionally allows long dwell.

Source basis:

- https://gowyrd.org/wyrd-light/

### Pattern / dynamics

Observed (from their product description, and typical lamp behavior):

- “builds towards increasing brightness” is an explicit user instruction, suggesting episodes rather than instantaneous flashes.

Source:

- https://gowyrd.org/wyrd-light/

Inference:

- The visual should be driven by a _slow envelope_ (integrator) rather than raw per-second values.
- Different channels probably modulate motion/texture in addition to hue (e.g., Pearson as swirling / ring-like dynamics), consistent with their note that Pearson behaves differently.

## Differences Between What They Say vs What We Can Observe

### What they say (public claims)

- Light is dim when random; bright when statistically significant.
- Colors are “playfully assigned” to data structures.
- There are channels, p-values, starting points, and an algorithm selecting 200-bit samples.
- The Wyrd Light uses stored data but behaves like live RNG.

Sources:

- https://gowyrd.org/faq/
- https://gowyrd.org/wyrd-light/
- https://gowyrd.org/how-does-it-work/

### What we can observe (from product media)

The Wyrd Light page links to an activation video:

- https://gowyrd.org/wp-content/uploads/2024/12/Light_Activation_V3_Vertical.mp4

Observed (high-confidence but still “observed”):

- There is a deliberate activation choreography (boot/ignite), not just immediate random wandering.
- The device appears to avoid strobing and uses smooth ramps (suggesting heavy smoothing/integration).
- Color changes are not rapid flicker; they tend to come in “phases”.

Important limitation:

- We have not machine-analyzed frames or extracted exact timing curves; the observations above are qualitative.

### Likely reason for the mismatch in early emulations

If an implementation uses:

- a continuously sliding window
- direct mapping of instantaneous stats to hue/brightness

…it tends to produce either:

- jitter (if reactive)
- bland dim output (if over-smoothed)

Wyrd’s mention of:

- segmentation (“starting points”)
- random-walk based detectors
- calibrated false-positive modeling

…suggests their output is _episode-driven_ and _calibrated_, which is why it can be stable, “story-like”, and still statistically grounded.

## Practical Guidance for Future Implementations

### Recommended architecture (inference, but consistent with sources)

- Input:
  - two bit streams A/B
  - per tick (1Hz): choose 200-bit segments from each
- Per tick:
  - compute per-channel test statistics
  - apply segmentation to detect start points and peak heights
  - output per-channel probability-like values (p-values)
- Output mapping:
  - brightness driven primarily by p-values (with smoothing)
  - color driven by dominant channel (with dwell/hysteresis)
  - channel-specific motion/texture parameters

Source basis:

- 200-bit sampling and “p-values each second”: https://gowyrd.org/faq/
- starting points: https://gowyrd.org/faq/

### “Wow” vs “Mellow” modes (inference)

Confirmed:

- The product states two modes exist.

Inference:

- These likely modify:
  - response speed / smoothing constants
  - max brightness and/or saturation
  - how easily the light changes colors (dominance hysteresis)

Source:

- https://gowyrd.org/wyrd-light/

### Response speed (5 settings)

Confirmed:

- “Adjust your Light’s response speed: 5 different settings”.

Inference:

- Likely adjusts:
  - tick averaging interval or window size
  - smoothing time constants
  - segmentation memory length

Source:

- https://gowyrd.org/wyrd-light/

## Notes on Missing Information

Unknowns we cannot fill from public sources:

- Exact definition of the 7 channels.
- Exact segmentation algorithm for “starting points”.
- Exact mapping of channels to specific colors (they claim it’s playful and not meaning-laden).
- Exact p-value calibration (analytic vs empirical vs hybrid).

## Appendix: Patent / Software Mentions

The Wyrd Software Suite page states:

- “The Wyrdoscope® analysis software patent applications EPA 22814436.6 and USA 18/726,129.”

Source:

- https://gowyrd.org/wyrdoscope-software-suite/
