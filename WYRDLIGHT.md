# WYRDLIGHT Notes (Reverse-Engineering Guide)

This document collects everything we can (publicly) infer about how **Wyrd Light** and **Wyrdoscope** work.

Goal: enable future implementations to emulate the _behavior_ and _visual grammar_ of the official devices as closely as possible, while being clear about what is confirmed vs inferred.

## Scope and Constraints

- This is a reverse-engineering guide based on public statements and observable product media.
- The Wyrdoscope/Wyrd Light analysis software is described as **patented** (patent applications EPA 22814436.6 and USA 18/726,129). We do **not** have the algorithm.
- We separate:
  - **Confirmed**: directly stated by Wyrd in public docs.
  - **Inferred**: plausible implementation details implied by their descriptions.
  - **Observed**: behavior from video/product media.

## Primary Sources (Cited)

- Wyrd FAQ (detailed technical-ish descriptions, channels, sampling, p-values, start points):
  - https://gowyrd.org/faq/
- Wyrd Light product page (modes, speed settings, baseline wandering description, activation video link):
  - https://gowyrd.org/wyrd-light/
- "How does it work?" (conceptual framing, live vs stored RNG distinction, MPI/NT-axiom narrative):
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
- **Channel**: a distinct statistical "story" / detector operating on the two streams.
- **Coherence / anomaly**: Wyrd's term for detectable structure in what should be random/unrelated streams.
- **p-value / probability**: Wyrd describes output values as probabilities that a detected pattern is due to chance.
- **Starting Point (SP)**: the inferred/algorithmic beginning time of a detected structure/peak.
- **MPI**: Model of Pragmatic Information, the theoretical framework Wyrd uses (see section below).
- **GQT**: Generalised Quantum Theory, the foundation for MPI.

## What the Devices Do (Confirmed)

### Wyrdoscope (Confirmed)

- Uses **two live quantum-based random event generators** and analyzes **correlations between their outputs**.
  - Source: "The Wyrdoscope uses two live quantum-based random event generators. It analyses correlations between their outputs."
  - https://gowyrd.org/how-does-it-work/

- Wyrd's standard hardware setup is based on **TrueRNGpro** devices, which generate randomness from **quantum tunneling** in semiconductor diodes.
  - Source: "The Wyrdoscope uses TrueRNGpro devices, which generate randomness from a quantum tunneling process inside semiconductor diodes."
  - https://gowyrd.org/faq/

- Each TrueRNGpro contains **two quantum random chips** (noise generators) per REG:
  - These two streams are whitened internally, and the result is the output of one REG.
  - One REG produces "Alice" and the other produces "Bob".
  - So effectively there are **four quantum noise sources** feeding into two output streams.
  - Source: "each REG has 2 quantum random chips on its board. These two streams are whitened, and the result is then the output of one REG."
  - https://gowyrd.org/faq/

- TrueRNGpro hardware specifications (from manufacturer):
  - High Output Speed: > 3.2 Mbits/second
  - Mode Selection: Whitened, Raw, or Diagnostic
  - Dual independently shielded noise generators
  - Shielded aluminum enclosure
  - Temperature and voltage stabilized
  - Electromagnetic shielding on each noise generator
  - Source: https://ubld.it/products/truerngpro

- The Wyrdoscope + software support capturing events and aligning them with time series.
  - Sources:
    - Device features: event button, audio record/replay time-stamped, bluetooth lapel microphone.
    - https://gowyrd.org/wyrdoscope-device/
    - Software suite: "Adding/editing of events at specific timestamps…" and "Playing of recorded audio events while reviewing data".
    - https://gowyrd.org/wyrdoscope-software-suite/

- Wyrdoscope standalone battery operation: up to 6 hours unplugged.
  - Source: https://gowyrd.org/wyrdoscope-device/

### Wyrd Light (Confirmed)

- Uses **stored** random data (two streams), not live generation.
  - Source: "The Wyrd Light, by contrast, uses stored random data—sequences that were recorded long ago…"
  - https://gowyrd.org/how-does-it-work/

- Stored data size and sampling method:
  - Uses "about **7 GB** of two synchronously produced random strings containing only 1s and 0s stored on an SD card."
  - A pseudo random algorithm chooses a **200 bit sample** from the two strings.
  - The two samples are "interwoven through our patented algorithm to compute the results of the channels."
  - Source: "How do the devices work? A deeper dive…" section.
  - https://gowyrd.org/faq/

- **Critical timing property for stored data**:
  - The stored random sequences are "untouched and unobserved until the moment the Wyrd Light activates and begins comparing them."
  - This is significant because their theoretical framework (MPI) suggests unobserved data can still reflect meaningful patterns.
  - Source: "These streams are untouched and unobserved until the moment the Wyrd Light activates..."
  - https://gowyrd.org/wyrd-light/

- Brightness reflects coherence and significance:
  - "When random data samples… appear random, the Wyrd Light will not shine brightly."
  - "As soon as your influence becomes statistically significant, it will begin to light up…"
  - "The stronger the effect, the brighter the light shines…"
  - Source: Wyrd Light FAQ.
  - https://gowyrd.org/faq/

- Baseline behavior:
  - "When not much is going on where the Light is, you can expect it to wander between colours and remain dim."
  - "The brighter the Light, the smaller the probability that it is happening by chance."
  - Source: "How do I know the Light isn't just behaving randomly?"
  - https://gowyrd.org/wyrd-light/

- App integration (important for reverse engineering cadence/output):
  - "Each second the values are calculated from the random streams and the p-values (probabilities) are sent to the App."
  - "There are currently 7 channels used…"
  - "The data of each channel is like a timestamp with a float value giving the probability of an anomaly."
  - "Channel 5 is a bit of an exception as it is a Pearson correlation… and behaves differently…"
  - Source: "How do the Wyrd technologies interface with the Wyrd App?"
  - https://gowyrd.org/faq/

- User-facing "modes" and response speed:
  - "Adjustable mode – Wow (for showing off) or Mellow (for meetings and retreats)"
  - "Adjust your Light's response speed: 5 different settings"
  - Source: Wyrd Light page.
  - https://gowyrd.org/wyrd-light/

- Battery life: 3 hours rechargeable, or mains powered.
  - Source: https://gowyrd.org/wyrd-light/

### Key Difference: PEAR vs Wyrd Methodology (Confirmed)

- PEAR Lab used a **single REG** and analyzed deviations from randomness in manually chosen fixed time windows.
  - Starting point had to be chosen manually; only the endpoint could be chosen for statistical analysis.

- Wyrd uses **two REGs** and analyzes **correlations between the streams**.
  - Patterns caused by synchronous effects on both REGs are detected.
  - Fully automated analysis with algorithmically determined starting points.
  - All points can be used for statistical analysis.
  - Time windows of significance are determined purely algorithmically.

Source: "What is the difference between the REG technology used at the Princeton Engineering Anomalies Research (PEAR) lab and the Wyrd technology?"
- https://gowyrd.org/faq/

## Channels / Pattern Types (Confirmed)

Wyrd describes channels as different statistical languages over the same two-stream input.

They list four basic patterns (channels):

1. **Correlated pattern**: both streams generate significantly more 0s or 1s at the same time.
2. **Anti-correlated pattern**: one stream generates significantly more 1s while the other generates significantly more 0s.
3. **"Stick together" pattern**: both streams generate the same 0s and 1s at the same time for a significantly long time.
4. **Pearson correlation** of the random numbers.

Source: "What are channels?"

- https://gowyrd.org/faq/

### Channel Count Discrepancy

- **App pipeline**: Wyrd indicates **7 channels** are used, with one being Pearson (described as "Channel 5").
  - Source: "There are currently 7 channels used..."
  - https://gowyrd.org/faq/

- **Software Suite**: The patented software mentions **6 channels** in automated anomaly analysis.
  - Source: "Fully automated patented anomaly analysis of 2 REG streams including starting points on 6 channels..."
  - https://gowyrd.org/wyrdoscope-software-suite/

We do not know the exact definition of all channels from public material. The 4 basic patterns described may be computed in multiple variants to yield 6-7 total channels.

### Possible Channel Breakdown (Inferred)

Based on the 4 basic patterns and the 6-7 channel count, a plausible breakdown:

1. **Correlated High** - Both streams biased toward 1s simultaneously
2. **Correlated Low** - Both streams biased toward 0s simultaneously
3. **Anti-correlated A>B** - Stream A biased high, stream B biased low
4. **Anti-correlated B>A** - Stream B biased high, stream A biased low
5. **Stick Together** - Bit-by-bit agreement exceeds chance
6. **Pearson Positive** - Positive correlation coefficient
7. **Pearson Negative** - Negative correlation coefficient (or combined with #6)

Alternatively, channels 1-4 might collapse into 2 channels (correlated vs anti-correlated magnitude), with additional channels for different time scales or detection methods.

## Significance, p-values, and "Starting Points" (Confirmed)

### p-values / probabilities are first-class outputs

- Wyrd explicitly describes the output stream as "p-values (probabilities)" per channel, sent each second.
- They emphasize brightness as a function of probability-of-chance.

Sources:

- App integration description: https://gowyrd.org/faq/
- "The brighter the Light, the smaller the probability…": https://gowyrd.org/wyrd-light/

### Peaks have height and a starting point

Wyrd explicitly defines a "starting point" concept:

- "It is rather the z-score or p-score in a channel, which only makes sense together with a starting point (SP). The SP is the segmentation that comes out of the data."
- "Each data point (e.g. a peak in the data) has two properties – a height and a starting point."

Source:

- "What is a 'starting point' in the Wyrd data?"
- https://gowyrd.org/faq/

This implies the algorithm is not just a naive rolling-window z-test; it performs segmentation to find when a structure begins.

## Inferred Algorithm Details (Based on Academic Literature)

The following section synthesizes what we can infer about Wyrd's algorithm based on:
1. Wyrd's public statements about "starting points," "random walks," and "z-scores"
2. The academic literature from PEAR, GCP, and Walter von Lucadou that Wyrd cites
3. Standard practices in the field

### The Cumulative Deviation / Random Walk Method

The PEAR lab and Global Consciousness Project extensively documented their analysis methods. The core technique is the **cumulative deviation** approach:

1. **Convert bits to ±1**: Map each bit (0 or 1) to a signed value (-1 or +1).

2. **Compute cumulative sum**: For a sequence of N bits, compute `S(n) = Σ(i=1 to n) x_i` where x_i is the ±1 value.

3. **Random walk interpretation**: Under the null hypothesis (pure randomness), S(n) follows a random walk with expected value 0 and variance n.

4. **Z-score calculation**: At any point n, the z-score is `z = S(n) / sqrt(n)`.

This is consistent with Wyrd's statement that channels represent "the time course of a specific data pattern mainly in **random walks**."

### Starting Point Detection (Segmentation)

The key innovation in Wyrd's approach appears to be automatic **starting point detection**. Rather than using a fixed window, the algorithm likely:

1. **Scans for optimal segments**: For each current time t, search backwards for a starting point s that maximizes the z-score of the segment [s, t].

2. **Maximum excursion detection**: Find the point where `|S(t) - S(s)| / sqrt(t-s)` is maximized. This identifies when a "structure" began.

3. **Report both height and start**: As Wyrd states: "Each data point (e.g. a peak in the data) has two properties – a height and a starting point."

This is a form of **change-point detection** or **optimal stopping** analysis.

### Dual-Stream Correlation Channels

For the four basic channel types, the likely implementations are:

#### 1. Correlated Pattern
- Compute z-scores for stream A: `z_A = S_A(n) / sqrt(n)`
- Compute z-scores for stream B: `z_B = S_B(n) / sqrt(n)`
- **Correlated signal**: When `z_A * z_B > 0` (both deviating in same direction), strength = `|z_A * z_B|` or `min(|z_A|, |z_B|)`

#### 2. Anti-Correlated Pattern
- Same z-scores as above
- **Anti-correlated signal**: When `z_A * z_B < 0` (deviating in opposite directions), strength = `|z_A * z_B|` or `min(|z_A|, |z_B|)`

#### 3. "Stick Together" Pattern
- Create agreement sequence: `agree(i) = 1 if A_i == B_i, else 0`
- Under null hypothesis, P(agree) = 0.5
- Compute z-score of agreement count: `z_agree = (agree_count - n/2) / sqrt(n/4)`
- High z_agree indicates unusual agreement

#### 4. Pearson Correlation
- Treat bit sequences as ±1 values
- Compute Pearson correlation coefficient r over the window
- The coefficient ranges from -1 to +1
- Convert to z-score using Fisher transformation: `z = 0.5 * ln((1+r)/(1-r)) * sqrt(n-3)`

### P-value Conversion

From z-scores to p-values (probability of chance):
- `p = 2 * (1 - Φ(|z|))` for two-tailed test, where Φ is the standard normal CDF
- Or `p = 1 - Φ(z)` for one-tailed test if direction matters

Wyrd may use empirically calibrated p-values based on their 1.1 million minutes of control data rather than purely theoretical values.

### Why This Produces "Episode-Like" Behavior

The starting point detection explains why Wyrd's output feels "story-like":

1. **Peaks have duration**: A detected anomaly isn't just a single moment but a segment with a beginning and an end.

2. **Hysteresis**: Once a structure is detected with a starting point, it tends to persist until the z-score decays significantly.

3. **Channel dominance**: The channel with the highest current z-score "wins" and determines color.

4. **Smoothing**: Visual output is smoothed over time to avoid flicker, but the underlying detection is discrete.

### Software suite segmentation features (Confirmed)

The software suite supports:
- Start point calculation driven only by the structure of the data
- Re-calculation based on a manually selected starting point
- Each channel can be analyzed separately
- Ability to reverse random data before calculation

Source: https://gowyrd.org/wyrdoscope-software-suite/

## Raw Data Format (Confirmed)

The raw data is stored on the Wyrdoscope in normal CSV files in 2 formats:

1. **Bit stream format**: 200 bits as individual 1 or 0 values (for entropy analysis etc.)
2. **Bit sum format**: The count of 1s in the stream as a signed integer

Source: "In what form is the data accessible..."
- https://gowyrd.org/faq/

### Bit rate

- Standard is **200 bps** (200 bits per second).
- Current software supports up to "a few 1000 bits/sec" due to synchronicity overhead.
- Theoretical max is ~3.2 Mbit/sec (TrueRNGpro hardware limit).

Source: https://gowyrd.org/faq/

## Theoretical Framework: Model of Pragmatic Information (MPI)

Wyrd explicitly states they work with the **Model of Pragmatic Information (MPI)**, developed by physicist Walter von Lucadou.

### Key MPI concepts (Confirmed)

- MPI is rooted in **Generalised Quantum Theory (GQT)**, which extends quantum mechanics principles to macroscopic systems.
- Effects are understood as **non-local entanglement correlations** in organizationally closed systems.
- The **NT-Axiom** (Non-Transmission Axiom): Any attempt to use these effects as signal transfers causes them to vanish or displace.
  - "when you attempt to use a psi effect like a signal, it vanishes or displaces"
- **Organizational closure**: Systems exhibiting effects are often self-referential with internal feedback loops.

Source: "What model of consciousness does the Wyrd team work with?"
- https://gowyrd.org/faq/
- https://gowyrd.org/how-does-it-work/

### Implications for implementation

- The devices "reveal non-local correlations that emerge within meaningful systems."
- "They are not detecting energy. They are not being influenced by force."
- Effects arise when the system becomes "temporarily entangled" and "organizationally closed."

Source: https://gowyrd.org/how-does-it-work/

## What We Can Infer About the Internal Analysis

These items are not stated as implementation, but they are strongly implied by Wyrd's descriptions.

### Sampling cadence

- The App pipeline suggests 1Hz updates: "Each second the values are calculated… and the p-values are sent to the App."
- The Wyrd Light's 200-bit sampling implies a natural unit of analysis.

Inference:

- Expect a loop like:
  - every second: select 200-bit segments from each stream, compute channel p-values, update state
  - between seconds: smooth output for display (light intensity should not strobe)

Source basis:

- https://gowyrd.org/faq/

### Why segmentation matters

If the system computes "starting points" for peaks, it likely:

- builds a statistic over time (e.g., random-walk / cumulative sum style detectors)
- finds the most significant recent segment (start-to-now or start-to-peak)
- reports both the "height" (strength) and "starting point" (time)

This is consistent with their note:

- "Each channel … represents the time course of a specific data pattern mainly in random walks…"

Source:

- https://gowyrd.org/faq/

### Control data / false positives (Confirmed)

Wyrd describes a baseline/control-data modeling effort:

- "During our study on the dying process, conducted in a hospice in the UK and an ICU in Spain, we collected **1.1 million minutes (about 2 years)** of control data."
- *Control data* means recordings for which they have no information about nearby events.
- "By modelling control data mathematically, we can establish the normal statistical patterns of the system. This allows us to calculate *false positive probabilities*."

Current analysis uses:
- Maximum peak height
- Temporal distance from an event

Future plans:
- Full *pattern library* using AI
- Cataloguing properties such as turning points and symmetries

Source:

- https://gowyrd.org/faq/

### Whitening / bias handling (Confirmed)

Wyrd describes that each REG has two quantum random chips and whitening is performed internally.
They also note an option to disable whitening (raw mode) and that effects can look higher without whitening.

Key findings from their testing:

- "We did some blind tests with and without the whitening and the effects without whitening are a bit higher (we get higher peaks in the Wyrdoscope)."
- This aligns with MPI theory: "the bias (a classical effect) would mutually enhance and stabilize the correlation (the entanglement)."
- Trade-off: Without whitening, critics could claim different phenomena are being measured.
- Upcoming software will include a config switch to toggle whitening.

Sources:

- "About the noise whitening…"
- https://gowyrd.org/faq/

Manufacturer info on modes (whitened/raw/diagnostic) and throughput:

- TrueRNGpro: "Mode Selection (Whitened, Raw, Diagnostic)" and "High Output Speed: > 3.2 Mbits / second"
- https://ubld.it/products/truerngpro

## Research Findings (Confirmed)

### Dying process correlation

Wyrd reports detecting significant correlation with the moment of dying:

- **z-score of 7.2** (7.2 standard deviations from average)
- For comparison: "the z-score for the Higgs boson discovery that science now accepts is 7.0"

Source: https://gowyrd.org/wyrd-light/

### Group coherence

- "Our research has shown that the technology that drives the Light responds to strong group experiences, such as when the individuals come into synch, flow or harmony with each other, acting more in unity."

Source: https://gowyrd.org/wyrd-light/

## Mapping Patterns to Color and Brightness (Confirmed + Inferred)

### Brightness

Confirmed:

- Brightness is tied to coherence/significance:
  - "We have translated that impact into the relative brightness of the Wyrd Light."
  - "The brighter the Light, the smaller the probability that it is happening by chance."

Sources:

- https://gowyrd.org/faq/
- https://gowyrd.org/wyrd-light/

Inference (practical implementation detail):

- A natural mapping is to use a "surprisal" transform such as `S = -log10(p)` and then smooth it with rise/fall time constants to avoid flicker.
- The device is described as "lighting up" when statistically significant, which suggests a strong non-linear response (little output at high p; strong output when p is small).

### Color

Confirmed:

- "The colours are playfully assigned to different kinds of data structure (they don't carry specific meanings)".
- "The colours reflect different structures manifesting in the random data, in real time."
- They suspect "data structures reflect different qualities in the consciousness field" but don't yet know what those qualities are.

Sources:

- https://gowyrd.org/faq/
- https://gowyrd.org/wyrd-light/

Inference:

- A dominant-channel selection (winner-take-most) is likely, but with hysteresis/dwell to avoid rapid switching.
- Wyrd explicitly talks about "stays stable in one colour for a long period" as a meaningful observation cue, implying the UI intentionally allows long dwell.

Source basis:

- https://gowyrd.org/wyrd-light/

### Pattern / dynamics

Observed (from their product description, and typical lamp behavior):

- "builds towards increasing brightness" is an explicit user instruction, suggesting episodes rather than instantaneous flashes.

Source:

- https://gowyrd.org/wyrd-light/

Inference:

- The visual should be driven by a _slow envelope_ (integrator) rather than raw per-second values.
- Different channels probably modulate motion/texture in addition to hue (e.g., Pearson as swirling / ring-like dynamics), consistent with their note that Pearson behaves differently.

## Multiple Wyrd Lights Behavior (Confirmed)

### Do multiple lights synchronize?

- "We don't have enough research to say definitively."
- "People have noticed that Lights do sometimes synch up, also on zoom calls with multiple people with a Light."
- With two lights, "coherence across four random data streams needs to happen."
- Classical expectation: "two lights almost never show coherent behaviour."
- Sometimes during "strong collective concentration you get alignment, sometimes not only in the colour they are showing but also in the dynamics of brightness."

### Why can two lights behave differently?

- "They're not just in the same space—they're in different systems."
- Lights may be "entangled with different people, intentions, or emotional states" or "included (or not) in a ritual or symbolic container."
- MPI suggests "the information dilutes when you have more than one device in the same space."
  - "you still get peaks in the data at key moments, but smaller than when just one device is present."

Source: https://gowyrd.org/faq/

## Differences Between What They Say vs What We Can Observe

### What they say (public claims)

- Light is dim when random; bright when statistically significant.
- Colors are "playfully assigned" to data structures.
- There are channels, p-values, starting points, and an algorithm selecting 200-bit samples.
- The Wyrd Light uses stored data but behaves like live RNG.

Sources:

- https://gowyrd.org/faq/
- https://gowyrd.org/wyrd-light/
- https://gowyrd.org/how-does-it-work/

### What we can observe (from product media)

The Wyrd Light page links to an activation video:

- https://gowyrd.org/wp-content/uploads/2024/12/Light_Activation_V3_Vertical.mp4

Observed (high-confidence but still "observed"):

- There is a deliberate activation choreography (boot/ignite), not just immediate random wandering.
- The device appears to avoid strobing and uses smooth ramps (suggesting heavy smoothing/integration).
- Color changes are not rapid flicker; they tend to come in "phases".

Important limitation:

- We have not machine-analyzed frames or extracted exact timing curves; the observations above are qualitative.

### Likely reason for the mismatch in early emulations

If an implementation uses:

- a continuously sliding window
- direct mapping of instantaneous stats to hue/brightness

…it tends to produce either:

- jitter (if reactive)
- bland dim output (if over-smoothed)

Wyrd's mention of:

- segmentation ("starting points")
- random-walk based detectors
- calibrated false-positive modeling

…suggests their output is _episode-driven_ and _calibrated_, which is why it can be stable, "story-like", and still statistically grounded.

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

- 200-bit sampling and "p-values each second": https://gowyrd.org/faq/
- starting points: https://gowyrd.org/faq/

### Channel implementation hints

Based on the four confirmed patterns:

1. **Correlated**: Compare z-scores of bit sums in A and B. When both deviate in the same direction (both high or both low), signal correlated.
2. **Anti-correlated**: When z-scores deviate in opposite directions.
3. **Stick together**: Count positions where A[i] == B[i] over the window. High agreement = stick.
4. **Pearson**: Compute Pearson correlation coefficient between the two streams (treating bits as ±1 or 0/1).

Inference: The algorithm likely uses cumulative sums / random walk representations to detect when these patterns begin (starting points) rather than just instantaneous values.

### "Wow" vs "Mellow" modes (inference)

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

- "Adjust your Light's response speed: 5 different settings".

Inference:

- Likely adjusts:
  - tick averaging interval or window size
  - smoothing time constants
  - segmentation memory length

Source:

- https://gowyrd.org/wyrd-light/

## Historical Context: PEAR and Predecessors

### PEAR Lab (1979-2007)

- Led by physicist Robert G. Jahn and Brenda Dunne at Princeton.
- Conducted experiments showing human intention can correlate with random systems.
- Used single REG technology; Psyleron later commercialized the design.

### Helmut Schmidt (1976, 1993)

- Demonstrated that **pre-recorded random data—never seen by anyone—can reflect human intention after the fact**, so long as the data remains unobserved.
- Key foundation for the stored-data approach used in Wyrd Light.

### Wolfhardt Janu

- In the 2010s, began exploring correlations between two independent Psyleron REGs.
- Developed software to analyze correlations during tantra rituals.
- Wyrd built on Janu's twin REG technology and software.

### Double-blind validation

- Wyrd conducted internal double-blind study comparing live Wyrdoscope with stored synchronously generated twin REG data.
- "No difference in significance and time precision could be found between these setups."

Sources:

- https://gowyrd.org/faq/
- https://gowyrd.org/wyrd-light/

## Notes on Missing Information

Unknowns we cannot fill from public sources:

- Exact definition of all 6-7 channels (only 4 basic patterns described).
- Exact segmentation algorithm for "starting points".
- Exact mapping of channels to specific colors (they claim it's playful and not meaning-laden).
- Exact p-value calibration (analytic vs empirical vs hybrid).
- Details of the "patented algorithm" that interweaves the two 200-bit samples.

## Appendix: Hardware and Software Specifications

### TrueRNGpro Specifications (from manufacturer)

- High Output Speed: > 3.2 Mbits/second
- Mode Selection: Whitened, Raw, Diagnostic
- Dual independently shielded noise generators
- Shielded aluminum enclosure
- Native Windows and Linux support (CDC Virtual Serial Port)
- Passes industry standard tests (Dieharder, ENT, Rngtest, etc.)
- Low power: ~100 mA
- Compatible with Raspberry Pi

Source: https://ubld.it/products/truerngpro

### Wyrdoscope Device Specifications

- Size: 178mm x 158mm x 88.5mm
- Weight: 1.6kg
- Battery: 6 hours standalone operation
- Storage: 60GB total capacity
- Data export via Samba (WiFi)
- USB C for keyboard/mouse/hard drive
- HDMI output for external display
- Wireless bluetooth lapel microphone
- Event button for timestamping

Source: https://gowyrd.org/wyrdoscope-device/

### Software Suite Features

- Fully automated patented anomaly analysis on 6 channels
- Selectable time intervals (max 24h per run)
- Output in CSV result matrix
- Graphical UI for plotting and zooming
- Export of zoomed selections
- Re-calculation with smaller averaging intervals
- Manual starting point selection
- Channel overlay on common time axis
- Plot export (PNG, SVG)
- Audio event playback synchronized with data

Source: https://gowyrd.org/wyrdoscope-software-suite/

### Patent References

The Wyrdoscope analysis software patent applications:
- EPA 22814436.6
- USA 18/726,129

Source: https://gowyrd.org/wyrdoscope-software-suite/

## Appendix: Key Academic References (cited by Wyrd)

1. **Lucadou, W. von.** (1995, 2015). *The Model of Pragmatic Information (MPI)*.
2. **Lucadou, W. von, Romer, H., & Walach, H.** (2007). *Synchronistic Phenomena as Entanglement Correlations in Generalized Quantum Theory*.
3. **Atmanspacher, H., Romer, H., & Walach, H.** (2002). *Weak Quantum Theory: Complementarity and Entanglement in Physics and Beyond*.
4. **Tressoldi, P.** (2007). *Entanglement Correlations and the Failure of Classical Models in Parapsychology*.
5. **Lucadou, W. von.** (2024). *Self-Organization of Temporal Structures – A Possible Solution for the Intervention Problem*.

Source: https://gowyrd.org/faq/

## Appendix: Additional References (for algorithm understanding)

These papers from the broader field inform our understanding of likely algorithm approaches:

1. **Jahn, R.G., Dunne, B.J., Nelson, R.D., Dobyns, Y.H., Bradish, G.J.** (1997). *Correlations of Random Binary Sequences with Pre-Stated Operator Intention: A Review of a 12-Year Program*.
   - Documents the PEAR lab's cumulative deviation methodology.
   - https://noosphere.princeton.edu/papers/pear/correlations.12yr.pdf

2. **Bancel, P. & Nelson, R.** (2008). *The GCP Event Experiment: Design, Analytical Methods, Results*. Journal of Scientific Exploration.
   - Details the Global Consciousness Project's statistical methods including z-score calculations and network analysis.
   - https://noosphere.princeton.edu/papers/pdf/GCP.JSE.B&N.2008.pdf

3. **Schmidt, H.** (1976). *PK Effect on Pre-Recorded Targets*.
   - Foundational work showing effects on pre-recorded (stored) random data, which is the basis for Wyrd Light's stored-data approach.

4. **Jahn, R.G.** (1987). *Engineering Anomalies Research*. Journal of Scientific Exploration.
   - Original PEAR methodology paper describing random walk analysis and cumulative deviation plots.
   - https://icrl.org/wp-content/uploads/2020/02/1987-engineering-anomalies-research.pdf

5. **Lucadou, W. von.** (2000). *Backward Causation and the Hausdorff-Dimension of Singular Events*.
   - Discusses MPI implications for experimental design and the "decline effect."
   - https://www.parapsychologische-beratungsstelle.de/downloads/BACKHAUS.pdf
