# WYRDLIGHT Notes (Reverse-Engineering Guide)

This document collects everything we can (publicly) infer about how **Wyrd Light** and **Wyrdoscope** work.

Goal: enable future implementations to emulate the _behavior_ and _visual grammar_ of the official devices as closely as is useful for WyrdWeb, while being clear about what is confirmed vs inferred. WyrdWeb is not intended to be a perfect clone: we intentionally adapt some behavior for web UX, screen sharing, and safety.

## Scope and Constraints

Status note (2026-04-25): the public Wyrd FAQ now links an official colour/channel PDF. This document has been updated to treat the red/amber/blue/green mapping as confirmed public information. The code may temporarily lag behind these notes until the next implementation refactor.

- This is a reverse-engineering guide based on public statements and observable product media.
- The Wyrdoscope/Wyrd Light analysis software is described as **patented** (patent applications EPA 22814436.6 and USA 18/726,129). We do **not** have the algorithm.
- We separate:
  - **Confirmed**: directly stated by Wyrd in public docs.
  - **Inferred**: plausible implementation details implied by their descriptions.
  - **Observed**: behavior from video/product media.

## Primary Sources (Cited)

- Wyrd FAQ (detailed technical-ish descriptions, channels, sampling, p-values, start points, and link to colour/channel PDF):
  - https://gowyrd.org/faq/
- Wyrd Light Data and Colours PDF (official colour/channel mapping):
  - Local copy: `Wyrd-Light-Data-and-Colours.pdf`
  - Original source: linked from https://gowyrd.org/faq/
- Wyrd Light product page (modes, speed settings, baseline wandering description, activation video link):
  - https://gowyrd.org/wyrd-light/
- "How does it work?" (conceptual framing, live vs stored RNG distinction, MPI/NT-axiom narrative):
  - https://gowyrd.org/how-does-it-work/
- Wyrdoscope device page (hardware overview + user manual link):
  - https://gowyrd.org/wyrdoscope-device/
- Wyrd Software Suite page (analysis software capabilities + patents mentioned):
  - https://gowyrd.org/wyrdoscope-software-suite/
- Wyrd Light User Guide PDF (boot, stages, modes, app speed/level settings):
  - https://gowyrd.org/wp-content/uploads/2024/12/Wyrd-Light-User-Guide-V1.pdf
- Wyrd Software User Manual 2.0.3 PDF (offline analysis interval, dynamic vs standard outputs, channel descriptions):
  - https://gowyrd.org/wyrd-light-software-users-manual-2
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

- User-facing "modes," response speed, and levels:
  - "Adjustable mode – Wow (for showing off) or Mellow (for meetings and retreats)"
  - "Adjust your Light's response speed: 5 different settings"
  - The User Guide says response speed ranges from once per second to once every 5 seconds.
  - The User Guide lists Levels: Beginner, Intermediate, Advanced. Beginner is the default and makes higher stages easiest to trigger.
  - Sources: Wyrd Light page and Wyrd Light User Guide.
  - https://gowyrd.org/wyrd-light/
  - https://gowyrd.org/wp-content/uploads/2024/12/Wyrd-Light-User-Guide-V1.pdf

- Stages / visual escalation:
  - The User Guide first gives a generic summary of three stages, with Stage 3 described as a swirling rainbow effect.
  - Later, in the Wyrd App settings section, it says the stages differ by mode.
  - In Mellow mode: Stage 1 colours brighten; Stage 2 colours move toward white; Stage 3 unlocks a rainbow effect.
  - In Wow mode: Stage 1 colours brighten; Stage 2 increases swirling of the strongest colour; Stage 3 unlocks a white strobe effect with an epilepsy warning.
  - Source: Wyrd Light User Guide.

- Boot behavior:
  - The User Guide says the physical Light takes about one minute to boot, then shows a 5-second rainbow effect, then begins processing data.
  - For WyrdWeb, we interpret the long boot as hardware startup, not as an important analytical behavior to emulate.

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

### Public Channel Breakdown (Confirmed / Partially Confirmed)

The new Wyrd Light Data and Colours PDF plus the Wyrd Software User Manual clarify the public channel model substantially.

Official Wyrd Software / Light channel names currently visible in public material:

1. **Channel 1** — absolute z-score of vertical deviation; captures both Channel 2a and Channel 2 at once. The Wyrd Light colour PDF says this is **not used in the Light** because it is redundant.
2. **Channel 2a** — the **parallel / correlated** pattern, where both streams show statistical significance in the same direction.
3. **Channel 2** — the **antiparallel / anti-correlated** pattern, where the two streams mirror each other on opposite sides of the statistical parabola.
4. **Channel 3min** — the **stick together** effect, where neither stream is significant alone, but following the same data path creates significance. The software manual describes it as minimum mean distance / decreased variance.
5. **Channel 3max** — maximum mean distance between Alice and Bob over the longer term; related to Channel 2 and used for amber in the Light.
6. **Channel 4** — mean absolute z-score / absolute height of both streams; a longer-term/average version of Channel 1 and used for red in the Light.
7. **Channel 5** — Pearson correlation of the random numbers; different from the random-walk channels.

This resolves much of the earlier "6 vs 7 channels" ambiguity: some public wording counts six automated analysis channels, while app/light material refers to seven channel values if Channel 2a and/or other variants are counted separately.

Sources:

- Local `Wyrd-Light-Data-and-Colours.pdf`
- Wyrd Software User Manual 2.0.3
- https://gowyrd.org/faq/
- https://gowyrd.org/wyrdoscope-software-suite/

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
- Early inference: create agreement sequence `agree(i) = 1 if A_i == B_i`, then test excess bit-by-bit agreement.
- Newer public material suggests the official Light's Channel 3min is closer to a **random-walk closeness / minimum-distance** detector:
  - The colour PDF says neither stream would be statistically significant on its own, but following the same data path creates significance.
  - The software manual describes Channel 3min as the probability of the minimum mean distance of Alice and Bob from the starting point, and statistically as a decrease of variance.
- Practical guidance: keep bitwise agreement as a possible supplemental/debug statistic, but a Wyrd-aligned implementation should prioritize random-walk distance/closeness for "stick together."

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

### Standard vs dynamic analysis outputs (Confirmed)

The Wyrd Software User Manual 2.0.3 describes two result-file flavors:

- **Standard output**: calculated with some noise reduction, favors longer-term correlations, may miss short peaks, useful as a cleaner overview.
- **Dynamic output**: full processing without noise reduction, catches shorter peaks, noisier and more volatile, assigns start points more directly.

It also includes a **Use Live Settling Value** setting for Wyrd Light and Wyrdoscope-Live data. With this enabled, processing raw Alice/Bob files should produce the same dynamic output values as the live Light / Wyrdoscope-Live.

Implementation decision for WyrdWeb:

- Do **not** expose Standard/Dynamic as a main UI control yet.
- Let `Mellow` behave calmer/stabler and `Wow` behave more dynamic/dramatic internally.
- Keep the possibility of an advanced/debug “analysis feel” control for future technical users.

Source: Wyrd Software User Manual 2.0.3

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

### Sampling cadence and response speed

- The App pipeline suggests 1Hz live values: "Each second the values are calculated… and the p-values are sent to the App."
- The Wyrd Light's 200-bit sampling implies a natural unit of analysis.
- The Wyrd Light User Guide says the app response speed setting ranges from once per second to once every 5 seconds.
- The Wyrd Software User Manual says offline analysis default interval is 60 seconds, with 3 seconds minimum and 6 seconds recommended for shorter sessions. This is likely an offline-analysis resolution setting, not necessarily the live Light cadence.

Implementation guidance:

- Keep cadence and visual style conceptually separate:
  - **Cadence / response speed** = how often new signal values are computed/applied (1s..5s in the official Light).
  - **Style / mode** = how Mellow/Wow renders those values.
- WyrdWeb currently keeps the public UI simple and does not expose response speed. Future versions may add it.
- Between signal updates, smooth output for display and avoid dangerous strobe behavior.

Source basis:

- https://gowyrd.org/faq/
- Wyrd Light User Guide PDF
- Wyrd Software User Manual 2.0.3

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
- The Wyrd Light Data and Colours PDF now gives an official public mapping between Light colours and data channels.

Official Wyrd Light colour mapping:

| Colour | Channel(s) | Meaning / pattern |
| --- | --- | --- |
| **Red** | `max(Channel 2a, Channel 4)` | Parallel/correlated and longer-term absolute-height structures |
| **Amber** | `max(Channel 2, Channel 3max)` | Antiparallel/diverging and longer-term maximum-distance structures |
| **Blue** | `Channel 3min` | Stick-together / random-walk closeness |
| **Green** | `Channel 5` | Pearson correlation |
| **N/A** | `Channel 1` | Redundant in the Light; not used |

Sources:

- Local `Wyrd-Light-Data-and-Colours.pdf`
- https://gowyrd.org/faq/
- https://gowyrd.org/wyrd-light/

Implementation guidance:

- Use Wyrd's colour grammar for user-facing visuals: red / amber / blue / green.
- Keep directional details (both high vs both low, A-high/B-low vs B-high/A-low, Pearson +/-) as debug/internal information for now.
- A dominant-channel selection (winner-take-most) is still likely useful, but with hysteresis/dwell to avoid rapid switching.
- Baseline should remain dim and slowly wander through softened colours rather than imply a specific channel.

Source basis:

- https://gowyrd.org/wyrd-light/

### Pattern / dynamics / stages

Confirmed / observed:

- "builds towards increasing brightness" is an explicit user instruction, suggesting episodes rather than instantaneous flashes.
- The Wyrd Light User Guide describes three visual stages. Its early technical summary describes Stage 3 generically as a swirling rainbow effect; the later app settings section clarifies that Stage 3 differs by mode:
  - Stage 1: colours increase/fluctuate in brightness.
  - Stage 2: colours move toward white light.
  - Stage 3: rainbow/full spectrum in Mellow; white strobe in Wow with seizure warning.

Sources:

- https://gowyrd.org/wyrd-light/
- Wyrd Light User Guide PDF

Implementation guidance:

- The visual should be driven by a _slow envelope_ (integrator) rather than raw per-second values.
- WyrdWeb should avoid dangerous strobe behavior. Use the existing anomaly animation (white core / expanding white ring) as the safe Stage 3 substitute.
- Suggested WyrdWeb stage mapping:
  - Stage 1: selected official channel colour brightens.
  - Stage 2: channel colour whitens/blooms.
  - Stage 3: expanding white anomaly ring / safe pulse, optionally with subtle rainbow shimmer.
- Different channels may later modulate motion/texture, but for now keep user-facing visuals simple and place directional details in debug.

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
- The Wyrd Light uses stored data, and Wyrd reports that their double-blind comparison found no difference in significance or time precision versus live REG data.

Sources:

- https://gowyrd.org/faq/
- https://gowyrd.org/wyrd-light/
- https://gowyrd.org/how-does-it-work/

### What we can observe (from product media)

The Wyrd Light page links to an activation video:

- https://gowyrd.org/wp-content/uploads/2024/12/Light_Activation_V3_Vertical.mp4

Observed / documented:

- There is a deliberate activation choreography (boot/ignite), not just immediate random wandering.
- The User Guide says the physical Light takes about one minute to boot, then shows a 5-second rainbow effect.
- The User Guide documents a Wow Stage 3 white strobe effect with an epilepsy warning.
- Product media still suggests most ordinary color changes are not rapid flicker; they tend to come in "phases".

Important limitation:

- We have not machine-analyzed frames or extracted exact timing curves; the observations above are qualitative.
- WyrdWeb intentionally prioritizes safe screen-share behavior and should use pulse/bloom/ring effects rather than dangerous strobe.

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
  - default/base live cadence: choose 200-bit segments from each at about 1Hz
  - future response-speed support may apply/update values every 1-5 seconds, matching Wyrd's app setting
- Per tick:
  - compute per-channel test statistics
  - apply segmentation to detect start points and peak heights
  - output per-channel probability-like values (p-values)
- Output mapping:
  - brightness driven primarily by p-values (with smoothing)
  - colour driven by the dominant Wyrd-aligned visual channel (red parallel, amber antiparallel, blue stick, green Pearson) with dwell/hysteresis
  - baseline as dim, slow colour wandering
  - high significance as staged whitening and safe pulse/ring effects
  - channel-specific motion/texture parameters can be added later, but keep the first refactor simple

Source basis:

- 200-bit sampling and base "p-values each second": https://gowyrd.org/faq/
- 1-5 second response speed: Wyrd Light User Guide PDF
- starting points: https://gowyrd.org/faq/

### Channel implementation hints

Target Wyrd-aligned visual channels:

1. **Red / parallel**: combine a short-term parallel detector (Channel 2a-like) with a longer-term absolute-height detector (Channel 4-like); use the stronger value.
2. **Amber / antiparallel**: combine a short-term antiparallel detector (Channel 2-like) with a longer-term maximum-distance detector (Channel 3max-like); use the stronger value.
3. **Blue / stick together**: implement Channel 3min-like random-walk closeness / minimum-distance, not only raw bit-by-bit equality.
4. **Green / Pearson**: compute Pearson correlation coefficient between the two streams (treating bits as ±1 or 0/1); keep positive/negative direction in debug for now.

Implementation notes:

- Directional subcases are still useful internally (`both high`, `both low`, `A high/B low`, `B high/A low`, Pearson +/-), but should not create separate public colours.
- The algorithm likely uses cumulative sums / random-walk representations to detect when these patterns begin (starting points) rather than just instantaneous values.
- Keep bitwise agreement as an optional supplemental/debug statistic until the random-walk closeness detector is validated.

### "Wow" vs "Mellow" modes

Confirmed:

- The product states two modes exist.
- The User Guide says Mellow Stage 3 unlocks rainbow/full-spectrum behavior, while Wow Stage 3 unlocks a white strobe with an epilepsy warning.

WyrdWeb implementation decision:

- Keep only Mellow/Wow as the public mode control.
- `Mellow`: calmer, more stable, background-friendly; suitable for meetings, retreats, screen sharing, and long sessions.
- `Wow`: more dynamic, dramatic, engaging; suitable when groups actively watch and experiment.
- Do not copy dangerous strobe. Use soft pulse/bloom/expanding ring as the high-intensity effect.
- Let Mellow/Wow internally tune visual style and some settling/dynamic feel, but keep Standard/Dynamic as future advanced/debug terminology only.

Source:

- https://gowyrd.org/wyrd-light/
- Wyrd Light User Guide PDF

### Response speed (5 settings)

Confirmed:

- "Adjust your Light's response speed: 5 different settings".
- The User Guide defines these as once per second through once every 5 seconds.

WyrdWeb implementation decision:

- Do not add this to the public UI yet; keep the current controls simple.
- Document as future work.
- If added later, treat it as cadence (how often new values are computed/applied), separate from style (Mellow/Wow rendering).

Source:

- https://gowyrd.org/wyrd-light/
- Wyrd Light User Guide PDF

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

- Exact patented formulas for each channel, especially the segmentation and start-point algorithm.
- Exact p-value calibration (analytic vs empirical vs hybrid).
- Exact live-settling behavior used in Wyrd Light vs offline software outputs.
- Details of the "patented algorithm" that interweaves the two 200-bit samples.
- Exact visual timing curves for stages, whitening, rainbow, and official strobe.

No longer unknown:

- Public Wyrd Light colour/channel mapping is now documented in `Wyrd-Light-Data-and-Colours.pdf`.

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
- Output/result matrix support; v1 used CSV, while v2 defaults to JSON and also supports CBOR, with CSV still supported
- Standard output and dynamic output result files
- Live Settling Value option for matching Wyrd Light / Wyrdoscope-Live behavior
- Graphical UI for plotting and zooming
- Export of zoomed selections
- Re-calculation with smaller averaging intervals
- Manual starting point selection
- Channel overlay on common time axis
- Plot export (PNG, SVG)
- Audio event playback synchronized with data

Sources:

- https://gowyrd.org/wyrdoscope-software-suite/
- Wyrd Software User Manual 2.0.3

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
