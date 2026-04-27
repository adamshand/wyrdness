(() => {
    'use strict';

    const CHANNELS = ['correlated_high', 'correlated_low', 'anti_ab', 'anti_ba', 'stick', 'walk_separate', 'pearson'];
    const VISUAL_CHANNELS = ['parallel', 'antiparallel', 'stick_together', 'pearson'];
    const DEMO_CHANNELS = [...VISUAL_CHANNELS];
    const DEMO_LABELS = {
        parallel: 'Parallel',
        antiparallel: 'Antiparallel',
        stick_together: 'Stick together',
        pearson: 'Pearson'
    };
    const DISPLAY_NAMES = {
        baseline: 'Baseline',
        parallel: 'Parallel',
        antiparallel: 'Antiparallel',
        stick_together: 'Stick',
        pearson: 'Pearson'
    };
    const PALETTE = {
        parallel: { hue: 356, name: 'Parallel' },
        antiparallel: { hue: 36, name: 'Antiparallel' },
        stick_together: { hue: 212, name: 'Stick' },
        pearson: { hue: 135, name: 'Pearson' }
    };
    const BASELINE_HUES = [356, 36, 212, 135];
    const BASELINE_SEGMENT_SECONDS = 48;
    const MODE_PRESETS = {
        wow: {
            sigEnergyRiseMs: 1000,
            sigEnergyFallMs: 2000,
            hueTauMs: 6000,
            satTauMs: 5000,
            maxBrightness: 1.0,
            saturationBoost: 12,
            switchMargin: 0.06,
            keepBonus: 0.03
        },
        mellow: {
            sigEnergyRiseMs: 2000,
            sigEnergyFallMs: 3600,
            hueTauMs: 14000,
            satTauMs: 12000,
            maxBrightness: 0.85,
            saturationBoost: 0,
            switchMargin: 0.12,
            keepBonus: 0.06
        }
    };
    const SENSITIVITY_PRESETS = {
        conservative: {
            strengthZStart: 2.4,
            strengthZFull: 3.5,
            stickZStart: 3.4,
            stickZFull: 4.5,
            pearsonRStart: 0.25,
            pearsonRFull: 0.5,
            dominanceThreshold: 0.12
        },
        moderate: {
            strengthZStart: 2.0,
            strengthZFull: 3.2,
            stickZStart: 2.9,
            stickZFull: 4.0,
            pearsonRStart: 0.2,
            pearsonRFull: 0.45,
            dominanceThreshold: 0.12
        },
        engaging: {
            strengthZStart: 1.7,
            strengthZFull: 3.0,
            stickZStart: 2.6,
            stickZFull: 3.8,
            pearsonRStart: 0.16,
            pearsonRFull: 0.4,
            dominanceThreshold: 0.1
        }
    };
    const SENSITIVITY_LABELS = {
        conservative: 'Conservative',
        moderate: 'Moderate',
        engaging: 'Engaging'
    };

    const COHERENCE_FLOOR = 0.35;
    const MAX_LOOKBACK = 120;
    const MIN_SEGMENT_LEN = 3;
    const EPISODE_Z_THRESHOLD = 1.6;
    const STAGE_1_THRESHOLD = 0.12;
    const STAGE_2_THRESHOLD = 0.38;
    const STAGE_3_THRESHOLD = 0.68;
    const SIG_PULSE_THRESHOLD = STAGE_3_THRESHOLD;
    const SIG_PULSE_DURATION = 950;
    const SIG_PULSE_COOLDOWN = 3000;
    const DEMO_DURATION_MS = 5000;

    const state = {
        showHelp: false,
        showLegend: false,
        showDev: false,
        lightMode: 'mellow',
        sensitivity: 'moderate',
        sampleBits: 200,
        updatesPerSec: 1,
        coherence: 0,
        sigEnergy: 0,
        hueSmooth: 205,
        satSmooth: 58,
        zA: 0,
        zB: 0,
        pearsonR: 0,
        pearsonSpin: 0,
        pearsonDir: 1,
        pearsonPhase: 0,
        zAgree: 0,
        walkCloseZ: 0,
        walkSeparateZ: 0,
        walkCloseDistance: 0,
        walkSeparateDistance: 0,
        pMinRaw: 1,
        pOverall: 1,
        pOverallCalibrated: 1,
        surprisal: 0,
        sigPulseStart: 0,
        sigWasAboveThreshold: false,
        sigPulseLastTime: 0,
        dominant: 'baseline',
        dominance: 0,
        fps: 0,
        demoMode: false,
        demoBoost: 0,
        demoChannel: 'parallel',
        demoIndex: 0,
        demoPearsonDir: 1,
        demoStartTime: 0,
        demoPearsonBoost: 0,
        bootMs: 0,
        tickBudget: 0,
        bitsA: new Uint8Array(0),
        bitsB: new Uint8Array(0),
        onesA: 0,
        onesB: 0,
        agree: 0,
        sumX: 0,
        sumY: 0,
        sumXY: 0,
        cumSumA: [],
        cumSumB: [],
        cumSumAgree: [],
        cumSumXY: [],
        tickCount: 0,
        episodes: makeEpisodes(),
        rawLast: zeroRaw(),
        rawRender: zeroRaw(),
        visualLast: zeroVisual(),
        visualRender: zeroVisual(),
        sigEnergyRender: 0,
        renderScale: 0.75,
        raf: 0
    };

    const el = {};
    let canvasEl;
    let bufCanvas;
    let bufCtx;

    function clamp01(v) {
        return Math.min(1, Math.max(0, v));
    }

    function smoothstep(a, b, t) {
        const x = clamp01((t - a) / (b - a));
        return x * x * (3 - 2 * x);
    }

    function wrapHue(h) {
        const x = h % 360;
        return x < 0 ? x + 360 : x;
    }

    function hueApproach(current, target, k) {
        const c = wrapHue(current);
        const t = wrapHue(target);
        let d = t - c;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        return wrapHue(c + d * k);
    }

    function baselineHue(nowMs) {
        const total = nowMs / 1000 / BASELINE_SEGMENT_SECONDS;
        const i = Math.floor(total) % BASELINE_HUES.length;
        const j = (i + 1) % BASELINE_HUES.length;
        const eased = smoothstep(0, 1, total - Math.floor(total));
        return hueApproach(BASELINE_HUES[i], BASELINE_HUES[j], eased);
    }

    function currentStage() {
        const sig = state.sigEnergyRender;
        if (sig >= STAGE_3_THRESHOLD) return 3;
        if (sig >= STAGE_2_THRESHOLD) return 2;
        if (sig >= STAGE_1_THRESHOLD) return 1;
        return 0;
    }

    function erfApprox(x) {
        const sign = x < 0 ? -1 : 1;
        const ax = Math.abs(x);
        const t = 1 / (1 + 0.3275911 * ax);
        const a1 = 0.254829592;
        const a2 = -0.284496736;
        const a3 = 1.421413741;
        const a4 = -1.453152027;
        const a5 = 1.061405429;
        const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
        return sign * y;
    }

    function normalCdf(x) {
        return 0.5 * (1 + erfApprox(x / Math.SQRT2));
    }

    function twoSidedPFromZ(z) {
        const az = Math.abs(z);
        const tail = 1 - normalCdf(az);
        return Math.max(1e-18, Math.min(1, 2 * tail));
    }

    function oneSidedPFromZ(z) {
        const tail = 1 - normalCdf(z);
        return Math.max(1e-18, Math.min(1, tail));
    }

    function strengthFromZ(z, zStart, zFull) {
        return clamp01((Math.abs(z) - zStart) / (zFull - zStart));
    }

    function zeroRaw() {
        return {
            correlated_high: 0,
            correlated_low: 0,
            anti_ab: 0,
            anti_ba: 0,
            stick: 0,
            walk_separate: 0,
            pearson: 0
        };
    }

    function zeroVisual() {
        return {
            parallel: 0,
            antiparallel: 0,
            stick_together: 0,
            pearson: 0
        };
    }

    function visualFromRaw(raw) {
        return {
            parallel: Math.max(raw.correlated_high, raw.correlated_low),
            antiparallel: Math.max(raw.anti_ab, raw.anti_ba, raw.walk_separate ?? 0),
            stick_together: raw.stick,
            pearson: raw.pearson
        };
    }

    function percent(v) {
        return `${(v * 100).toFixed(1)}%`;
    }

    function defaultEpisode() {
        return { startTick: 0, peakZ: 0, currentZ: 0, strength: 0 };
    }

    function makeEpisodes() {
        return {
            correlated_high: defaultEpisode(),
            correlated_low: defaultEpisode(),
            anti_ab: defaultEpisode(),
            anti_ba: defaultEpisode(),
            stick: defaultEpisode(),
            walk_separate: defaultEpisode(),
            pearson: defaultEpisode()
        };
    }

    function getPearsonIndicator(r) {
        if (Math.abs(r) < 0.05) return '';
        return r > 0 ? ' +' : ' -';
    }

    function findOptimalStartingPoint(cumSum, currentIdx, bitsPerTick, lookback, minLen) {
        let bestZ = 0;
        let bestStart = currentIdx;
        const endSum = cumSum[currentIdx] ?? 0;
        const searchStart = Math.max(0, currentIdx - lookback);

        for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
            const startSum = cumSum[s] ?? 0;
            const delta = endSum - startSum;
            const tickSpan = currentIdx - s;
            const bitSpan = tickSpan * bitsPerTick;
            const z = delta / Math.sqrt(bitSpan);

            if (Math.abs(z) > Math.abs(bestZ)) {
                bestZ = z;
                bestStart = s;
            }
        }

        return { startIdx: bestStart, z: bestZ };
    }

    function findOptimalStartingPointAgreement(cumSum, currentIdx, bitsPerTick, lookback, minLen) {
        let bestZ = 0;
        let bestStart = currentIdx;
        const endSum = cumSum[currentIdx] ?? 0;
        const searchStart = Math.max(0, currentIdx - lookback);

        for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
            const startSum = cumSum[s] ?? 0;
            const delta = endSum - startSum;
            const tickSpan = currentIdx - s;
            const bitSpan = tickSpan * bitsPerTick;
            const z = delta / Math.sqrt(bitSpan / 4);

            if (z > bestZ) {
                bestZ = z;
                bestStart = s;
            }
        }

        return { startIdx: bestStart, z: bestZ };
    }

    function findOptimalStartingPointCorrelated(cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen) {
        let bestHighZ = 0;
        let bestLowZ = 0;
        let bestHighStart = currentIdx;
        let bestLowStart = currentIdx;
        const searchStart = Math.max(0, currentIdx - lookback);

        for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
            const tickSpan = currentIdx - s;
            const bitSpan = tickSpan * bitsPerTick;
            const deltaA = (cumSumA[currentIdx] ?? 0) - (cumSumA[s] ?? 0);
            const deltaB = (cumSumB[currentIdx] ?? 0) - (cumSumB[s] ?? 0);
            const zA = deltaA / Math.sqrt(bitSpan);
            const zB = deltaB / Math.sqrt(bitSpan);

            if (zA > 0 && zB > 0) {
                const strength = Math.min(zA, zB);
                if (strength > bestHighZ) {
                    bestHighZ = strength;
                    bestHighStart = s;
                }
            }

            if (zA < 0 && zB < 0) {
                const strength = Math.min(-zA, -zB);
                if (strength > bestLowZ) {
                    bestLowZ = strength;
                    bestLowStart = s;
                }
            }
        }

        return { highZ: bestHighZ, highStart: bestHighStart, lowZ: bestLowZ, lowStart: bestLowStart };
    }

    function findOptimalStartingPointAnti(cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen) {
        let bestAbZ = 0;
        let bestBaZ = 0;
        let bestAbStart = currentIdx;
        let bestBaStart = currentIdx;
        const searchStart = Math.max(0, currentIdx - lookback);

        for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
            const tickSpan = currentIdx - s;
            const bitSpan = tickSpan * bitsPerTick;
            const deltaA = (cumSumA[currentIdx] ?? 0) - (cumSumA[s] ?? 0);
            const deltaB = (cumSumB[currentIdx] ?? 0) - (cumSumB[s] ?? 0);
            const zA = deltaA / Math.sqrt(bitSpan);
            const zB = deltaB / Math.sqrt(bitSpan);

            if (zA > 0 && zB < 0) {
                const strength = Math.min(zA, -zB);
                if (strength > bestAbZ) {
                    bestAbZ = strength;
                    bestAbStart = s;
                }
            }

            if (zA < 0 && zB > 0) {
                const strength = Math.min(-zA, zB);
                if (strength > bestBaZ) {
                    bestBaZ = strength;
                    bestBaStart = s;
                }
            }
        }

        return { abZ: bestAbZ, abStart: bestAbStart, baZ: bestBaZ, baStart: bestBaStart };
    }

    function findOptimalStartingPointPearson(cumSumXY, cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen) {
        let bestZ = 0;
        let bestR = 0;
        let bestStart = currentIdx;
        const searchStart = Math.max(0, currentIdx - lookback);

        for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
            const tickSpan = currentIdx - s;
            const bitSpan = tickSpan * bitsPerTick;
            const sumXY = (cumSumXY[currentIdx] ?? 0) - (cumSumXY[s] ?? 0);
            const sumX = (cumSumA[currentIdx] ?? 0) - (cumSumA[s] ?? 0);
            const sumY = (cumSumB[currentIdx] ?? 0) - (cumSumB[s] ?? 0);
            const meanX = sumX / bitSpan;
            const meanY = sumY / bitSpan;
            const cov = sumXY / bitSpan - meanX * meanY;
            const varX = Math.max(1e-6, 1 - meanX * meanX);
            const varY = Math.max(1e-6, 1 - meanY * meanY);
            const r = Math.max(-1, Math.min(1, cov / Math.sqrt(varX * varY)));
            const rClamped = Math.max(-0.999, Math.min(0.999, r));
            const fisherZ = 0.5 * Math.log((1 + rClamped) / (1 - rClamped));
            const z = fisherZ * Math.sqrt(Math.max(1, bitSpan - 3));

            if (Math.abs(z) > Math.abs(bestZ)) {
                bestZ = z;
                bestR = r;
                bestStart = s;
            }
        }

        return { startIdx: bestStart, z: bestZ, r: bestR };
    }

    function walkDistanceScores(cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen) {
        let bestCloseZ = 0;
        let bestCloseStart = currentIdx;
        let bestCloseDistance = 0;
        let bestSeparateZ = 0;
        let bestSeparateStart = currentIdx;
        let bestSeparateDistance = 0;
        const searchStart = Math.max(0, currentIdx - lookback);

        for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
            const tickSpan = currentIdx - s;
            if (tickSpan < minLen) continue;

            let sumDistance = 0;
            let expectedSumDistance = 0;
            for (let i = s + 1; i <= currentIdx; i++) {
                const age = i - s;
                const walkA = (cumSumA[i] ?? 0) - (cumSumA[s] ?? 0);
                const walkB = (cumSumB[i] ?? 0) - (cumSumB[s] ?? 0);
                const distance = Math.abs(walkA - walkB);
                sumDistance += distance;

                // A-B is itself a random walk. Each tick contributes two independent
                // streams, so the variance of the difference walk is approximately 2N.
                // E(|Normal(0,sigma)|) = sigma * sqrt(2/pi). Averaging this over all
                // points in the candidate segment gives a Channel 3min/3max-like path
                // distance baseline rather than a bitwise-agreement test.
                expectedSumDistance += Math.sqrt(2 * bitsPerTick * age) * Math.sqrt(2 / Math.PI);
            }

            const meanDistance = sumDistance / tickSpan;
            const expectedMean = Math.max(1, expectedSumDistance / tickSpan);
            const ratio = meanDistance / expectedMean;
            const ratioSigma = Math.max(0.09, 0.34 / Math.pow(tickSpan, 0.25));
            const closeZ = (1 - ratio) / ratioSigma;
            const separateZ = (ratio - 1) / ratioSigma;

            if (closeZ > bestCloseZ) {
                bestCloseZ = closeZ;
                bestCloseStart = s;
                bestCloseDistance = meanDistance;
            }

            if (separateZ > bestSeparateZ) {
                bestSeparateZ = separateZ;
                bestSeparateStart = s;
                bestSeparateDistance = meanDistance;
            }
        }

        return {
            closeZ: bestCloseZ,
            closeStart: bestCloseStart,
            closeDistance: bestCloseDistance,
            separateZ: bestSeparateZ,
            separateStart: bestSeparateStart,
            separateDistance: bestSeparateDistance
        };
    }

    function randBits(count) {
        const byteCount = Math.ceil(count / 8);
        const buf = new Uint8Array(byteCount);
        crypto.getRandomValues(buf);
        const out = new Uint8Array(count);
        for (let i = 0; i < count; i++) {
            out[i] = (buf[i >> 3] >> (i & 7)) & 1;
        }
        return out;
    }

    function reseed() {
        state.bitsA = randBits(state.sampleBits);
        state.bitsB = randBits(state.sampleBits);
        recomputeAggregatesFromBuffers();
        state.zA = 0;
        state.zB = 0;
        state.pearsonR = 0;
        state.pearsonSpin = 0;
        state.pearsonDir = 1;
        state.pearsonPhase = 0;
        state.zAgree = 0;
        state.coherence = 0;
        state.sigEnergy = 0;
        state.tickBudget = 0;
        state.dominant = 'baseline';
        state.dominance = 0;
        state.hueSmooth = 205;
        state.demoBoost = 0;
        state.demoMode = false;
        state.demoIndex = 0;
        state.demoChannel = 'parallel';
        state.demoPearsonBoost = 0;
        state.bootMs = 0;
        state.cumSumA = [0];
        state.cumSumB = [0];
        state.cumSumAgree = [0];
        state.cumSumXY = [0];
        state.tickCount = 0;
        state.episodes = makeEpisodes();
        state.walkCloseZ = 0;
        state.walkSeparateZ = 0;
        state.walkCloseDistance = 0;
        state.walkSeparateDistance = 0;
        state.pMinRaw = 1;
        state.pOverall = 1;
        state.pOverallCalibrated = 1;
        state.surprisal = 0;
        state.sigPulseStart = 0;
        state.sigWasAboveThreshold = false;
        state.sigPulseLastTime = 0;
    }

    function recomputeAggregatesFromBuffers() {
        state.onesA = 0;
        state.onesB = 0;
        state.agree = 0;
        state.sumX = 0;
        state.sumY = 0;
        state.sumXY = 0;

        for (let i = 0; i < state.sampleBits; i++) {
            const a = state.bitsA[i];
            const b = state.bitsB[i];
            if (a === 1) state.onesA++;
            if (b === 1) state.onesB++;
            if (a === b) state.agree++;
            const x = a === 1 ? 1 : -1;
            const y = b === 1 ? 1 : -1;
            state.sumX += x;
            state.sumY += y;
            state.sumXY += x * y;
        }
    }

    function strengthFromZLocal(z, zStart = sensitivityPreset().strengthZStart, zFull = sensitivityPreset().strengthZFull) {
        return strengthFromZ(z, zStart, zFull);
    }

    function preset() {
        return MODE_PRESETS[state.lightMode];
    }

    function sensitivityPreset() {
        return SENSITIVITY_PRESETS[state.sensitivity];
    }

    function updateDominant(visual, dtMs) {
        let best = null;
        let bestV = 0;
        for (const k of VISUAL_CHANNELS) {
            const v = visual[k];
            if (v > bestV) {
                bestV = v;
                best = k;
            }
        }

        const sens = sensitivityPreset();
        const next = bestV > sens.dominanceThreshold && best ? best : 'baseline';
        const nextStrength = next === 'baseline' ? 0 : bestV;
        const mode = preset();
        let currentStrength = 0;
        if (state.dominant !== 'baseline') currentStrength = visual[state.dominant] ?? 0;
        currentStrength += mode.keepBonus;
        const shouldSwitch = state.dominant === 'baseline'
            ? next !== 'baseline'
            : nextStrength > currentStrength + mode.switchMargin;
        const target = next === 'baseline' ? 0 : nextStrength;
        const tau = target > state.dominance ? 1200 : 1800;
        const k = 1 - Math.exp(-dtMs / tau);
        state.dominance = state.dominance + (target - state.dominance) * k;
        if (shouldSwitch) state.dominant = next;
        if (state.dominant === 'baseline' && state.dominance < 0.05) state.dominant = 'baseline';
    }

    function signalTick() {
        state.bitsA = randBits(state.sampleBits);
        state.bitsB = randBits(state.sampleBits);
        recomputeAggregatesFromBuffers();
        state.tickCount++;

        const N = state.sampleBits;
        const prevCumA = state.cumSumA[state.cumSumA.length - 1] ?? 0;
        const prevCumB = state.cumSumB[state.cumSumB.length - 1] ?? 0;
        const prevCumAgree = state.cumSumAgree[state.cumSumAgree.length - 1] ?? 0;
        const prevCumXY = state.cumSumXY[state.cumSumXY.length - 1] ?? 0;

        state.cumSumA.push(prevCumA + state.sumX);
        state.cumSumB.push(prevCumB + state.sumY);
        state.cumSumAgree.push(prevCumAgree + (state.agree - N / 2));
        state.cumSumXY.push(prevCumXY + state.sumXY);

        const maxLen = MAX_LOOKBACK + 20;
        if (state.cumSumA.length > maxLen) {
            state.cumSumA = state.cumSumA.slice(-maxLen);
            state.cumSumB = state.cumSumB.slice(-maxLen);
            state.cumSumAgree = state.cumSumAgree.slice(-maxLen);
            state.cumSumXY = state.cumSumXY.slice(-maxLen);
        }

        const currentIdx = state.cumSumA.length - 1;
        const spA = findOptimalStartingPoint(state.cumSumA, currentIdx, N, MAX_LOOKBACK, MIN_SEGMENT_LEN);
        const spB = findOptimalStartingPoint(state.cumSumB, currentIdx, N, MAX_LOOKBACK, MIN_SEGMENT_LEN);
        const spCorr = findOptimalStartingPointCorrelated(state.cumSumA, state.cumSumB, currentIdx, N, MAX_LOOKBACK, MIN_SEGMENT_LEN);
        const corrHighZ = spCorr.highZ;
        const corrLowZ = spCorr.lowZ;
        const corrStart = Math.min(spCorr.highStart, spCorr.lowStart);
        const spAnti = findOptimalStartingPointAnti(state.cumSumA, state.cumSumB, currentIdx, N, MAX_LOOKBACK, MIN_SEGMENT_LEN);
        const antiAbZ = spAnti.abZ;
        const antiBaZ = spAnti.baZ;
        const antiStart = Math.min(spAnti.abStart, spAnti.baStart);
        const spAgree = findOptimalStartingPointAgreement(state.cumSumAgree, currentIdx, N, MAX_LOOKBACK, MIN_SEGMENT_LEN);
        const stickZ = spAgree.z;
        const spPearson = findOptimalStartingPointPearson(state.cumSumXY, state.cumSumA, state.cumSumB, currentIdx, N, MAX_LOOKBACK, MIN_SEGMENT_LEN);
        const pearsonZSeg = spPearson.z;
        const pearsonRSeg = spPearson.r;
        const spWalk = walkDistanceScores(state.cumSumA, state.cumSumB, currentIdx, N, MAX_LOOKBACK, MIN_SEGMENT_LEN);
        const walkCloseZ = spWalk.closeZ;
        const walkSeparateZ = spWalk.separateZ;
        const sens = sensitivityPreset();

        const corrHighRaw = strengthFromZLocal(corrHighZ);
        const corrLowRaw = strengthFromZLocal(corrLowZ);
        const antiAbRaw = strengthFromZLocal(antiAbZ);
        const antiBaRaw = strengthFromZLocal(antiBaZ);
        const stickRaw = strengthFromZLocal(walkCloseZ, sens.stickZStart, sens.stickZFull);
        const walkSeparateRaw = strengthFromZLocal(walkSeparateZ, sens.stickZStart, sens.stickZFull);

        const updateEpisode = (channel, currentZ, segmentStart) => {
            const ep = state.episodes[channel];
            const absZ = Math.abs(currentZ);
            if (absZ > EPISODE_Z_THRESHOLD) {
                if (absZ > ep.peakZ) {
                    if (ep.peakZ < EPISODE_Z_THRESHOLD) ep.startTick = segmentStart;
                    ep.peakZ = absZ;
                }
                ep.currentZ = absZ;
            } else if (ep.peakZ > EPISODE_Z_THRESHOLD && absZ < ep.peakZ * 0.8) {
                ep.startTick = currentIdx;
                ep.peakZ = absZ;
                ep.currentZ = absZ;
            } else {
                ep.currentZ = absZ;
            }
            const effectiveZ = ep.peakZ > EPISODE_Z_THRESHOLD ? Math.max(absZ, ep.peakZ * 0.7) : absZ;
            ep.strength = strengthFromZLocal(effectiveZ, sens.strengthZStart, sens.strengthZFull);
        };

        updateEpisode('correlated_high', corrHighZ, corrStart);
        updateEpisode('correlated_low', corrLowZ, corrStart);
        updateEpisode('anti_ab', antiAbZ, antiStart);
        updateEpisode('anti_ba', antiBaZ, antiStart);
        updateEpisode('stick', walkCloseZ, spWalk.closeStart);
        updateEpisode('walk_separate', walkSeparateZ, spWalk.separateStart);
        updateEpisode('pearson', pearsonZSeg, spPearson.startIdx);

        const statsTau = 2800;
        const statsDtMs = 1000 / Math.max(0.25, state.updatesPerSec);
        const statK = 1 - Math.exp(-statsDtMs / statsTau);
        state.zA = state.zA + (spA.z - state.zA) * statK;
        state.zB = state.zB + (spB.z - state.zB) * statK;
        state.zAgree = state.zAgree + (stickZ - state.zAgree) * statK;
        state.walkCloseZ = state.walkCloseZ + (walkCloseZ - state.walkCloseZ) * statK;
        state.walkSeparateZ = state.walkSeparateZ + (walkSeparateZ - state.walkSeparateZ) * statK;
        if (spWalk.closeStart < currentIdx) state.walkCloseDistance = state.walkCloseDistance + (spWalk.closeDistance - state.walkCloseDistance) * statK;
        if (spWalk.separateStart < currentIdx) state.walkSeparateDistance = state.walkSeparateDistance + (spWalk.separateDistance - state.walkSeparateDistance) * statK;
        state.pearsonR = state.pearsonR + (pearsonRSeg - state.pearsonR) * statK;

        const pearsonRaw = clamp01((Math.abs(pearsonRSeg) - sens.pearsonRStart) / (sens.pearsonRFull - sens.pearsonRStart));
        const raw = {
            correlated_high: state.demoChannel === 'parallel' ? Math.min(1, corrHighRaw + state.demoBoost) : corrHighRaw,
            correlated_low: corrLowRaw,
            anti_ab: state.demoChannel === 'antiparallel' ? Math.min(1, antiAbRaw + state.demoBoost) : antiAbRaw,
            anti_ba: antiBaRaw,
            stick: state.demoChannel === 'stick_together' ? Math.min(1, stickRaw + state.demoBoost) : stickRaw,
            walk_separate: walkSeparateRaw,
            pearson: state.demoChannel === 'pearson' ? Math.min(1, pearsonRaw + state.demoBoost) : pearsonRaw
        };
        const visual = visualFromRaw(raw);
        state.rawLast = raw;
        state.visualLast = visual;
        updateDominant(visual, 1000 / Math.max(0.25, state.updatesPerSec));
        state.coherence = Math.max(...VISUAL_CHANNELS.map((channel) => visual[channel]));

        if (!state.demoMode) {
            state.demoBoost *= 0.97;
            if (state.demoBoost < 0.01) state.demoBoost = 0;
        }

        const dtMs = 1000 / Math.max(0.25, state.updatesPerSec);
        const pCorrHigh = corrHighZ !== 0 ? twoSidedPFromZ(corrHighZ) : 1;
        const pCorrLow = corrLowZ !== 0 ? twoSidedPFromZ(corrLowZ) : 1;
        const pAntiAb = antiAbZ !== 0 ? twoSidedPFromZ(antiAbZ) : 1;
        const pAntiBa = antiBaZ !== 0 ? twoSidedPFromZ(antiBaZ) : 1;
        const pStick = Math.min(1, (walkCloseZ > 0 ? oneSidedPFromZ(walkCloseZ) : 1) / 0.05);
        const pWalkSeparate = Math.min(1, (walkSeparateZ > 0 ? oneSidedPFromZ(walkSeparateZ) : 1) / 0.05);
        const pPearson = Math.min(1, (pearsonZSeg !== 0 ? twoSidedPFromZ(pearsonZSeg) : 1) / 0.016);
        const pMinRaw = Math.min(pCorrHigh, pCorrLow, pAntiAb, pAntiBa, pStick, pWalkSeparate, pPearson);
        const pOverallCalibrated = Math.min(1, pMinRaw / 0.11);
        const pOverallReal = Math.min(COHERENCE_FLOOR, pOverallCalibrated);
        const pOverall = state.demoBoost > 0.05 ? Math.min(pOverallReal, 0.001 * (1 - state.demoBoost)) : pOverallReal;
        const surprisal = Math.min(6, -Math.log10(pOverall));
        state.pMinRaw = pMinRaw;
        state.pOverallCalibrated = pOverallCalibrated;
        state.pOverall = pOverall;
        state.surprisal = surprisal;
        const targetSig = clamp01((surprisal - 0.3) / 5.0);
        const mode = preset();
        const sigTau = targetSig > state.sigEnergy ? mode.sigEnergyRiseMs : mode.sigEnergyFallMs;
        const sigK = 1 - Math.exp(-dtMs / sigTau);
        state.sigEnergy = state.sigEnergy + (targetSig - state.sigEnergy) * sigK;
    }

    function step(dtMs) {
        state.bootMs += dtMs;
        const bootT = clamp01(state.bootMs / 5000);
        const bootLock = bootT < 1;
        state.tickBudget += state.updatesPerSec * (dtMs / 1000);
        let ticks = Math.floor(state.tickBudget);
        ticks = Math.min(ticks, 8);

        if (bootLock) {
            state.tickBudget = Math.min(2, state.tickBudget);
            state.dominant = 'baseline';
            state.dominance = 0;
            state.coherence = 0;
            state.sigEnergy = 0;
            state.rawLast = zeroRaw();
            state.rawRender = zeroRaw();
            state.visualLast = zeroVisual();
            state.visualRender = zeroVisual();
        } else if (ticks > 0) {
            state.tickBudget -= ticks;
            for (let t = 0; t < ticks; t++) signalTick();
        } else {
            state.tickBudget = Math.min(2, state.tickBudget);
        }

        const demoTotalSegments = DEMO_CHANNELS.length + 1;
        const isAnomalySegment = state.demoIndex === DEMO_CHANNELS.length;

        if (state.demoMode) {
            const now = performance.now();
            const elapsed = now - state.demoStartTime;
            const t = Math.min(1, elapsed / DEMO_DURATION_MS);
            const envelope = Math.pow(Math.sin(Math.PI * t), 2);

            if (isAnomalySegment) {
                state.demoBoost = 0;
                state.demoPearsonBoost = 0;
                state.dominant = 'baseline';
                state.dominance = 0;
                state.sigEnergyRender = envelope * 0.7;
                const isAbove = state.sigEnergyRender >= SIG_PULSE_THRESHOLD;
                if (isAbove && !state.sigWasAboveThreshold) state.sigPulseStart = now;
            } else {
                state.demoBoost = 0.85 * envelope;
                state.demoPearsonBoost = 0.35 * state.demoPearsonDir * envelope;
                state.sigEnergyRender = envelope * 0.7;
                state.dominant = state.demoChannel;
                state.dominance = envelope;
            }

            if (elapsed >= DEMO_DURATION_MS) {
                state.demoIndex++;
                if (state.demoIndex >= demoTotalSegments) {
                    state.demoMode = false;
                    state.demoBoost = 0;
                    state.demoPearsonBoost = 0;
                    state.dominant = 'baseline';
                    state.dominance = 0;
                } else if (state.demoIndex < DEMO_CHANNELS.length) {
                    state.demoChannel = DEMO_CHANNELS[state.demoIndex];
                    state.demoPearsonDir = state.demoPearsonDir === 1 ? -1 : 1;
                    state.demoStartTime = now;
                } else {
                    state.demoStartTime = now;
                }
            }
        }

        const dt = dtMs / 1000;
        const pearsonK = 1 - Math.exp(-dtMs / 900);
        const effectivePearson = state.demoMode ? state.demoPearsonBoost : state.pearsonR;
        state.pearsonSpin = state.pearsonSpin + (effectivePearson - state.pearsonSpin) * pearsonK;
        if (!bootLock) {
            if (Math.abs(state.pearsonSpin) > 0.05) state.pearsonDir = state.pearsonSpin > 0 ? 1 : -1;
        } else {
            state.pearsonDir = 1;
        }
        const mag = Math.max(0, Math.abs(state.pearsonSpin) - 0.05);
        const speed = mag > 0 ? 0.08 + 0.35 * Math.pow(mag / 0.95, 0.7) : 0;
        state.pearsonPhase = wrapHue(state.pearsonPhase + state.pearsonDir * speed * 360 * dt);

        for (const ch of CHANNELS) {
            const target = state.rawLast[ch];
            const current = state.rawRender[ch];
            const tau = target > current ? 1800 : 4000;
            const k = 1 - Math.exp(-dtMs / tau);
            state.rawRender[ch] = current + (target - current) * k;
        }

        for (const ch of VISUAL_CHANNELS) {
            const target = state.visualLast[ch];
            const current = state.visualRender[ch];
            const tau = target > current ? 1800 : 4000;
            const k = 1 - Math.exp(-dtMs / tau);
            state.visualRender[ch] = current + (target - current) * k;
        }

        if (!state.demoMode) {
            const k = 1 - Math.exp(-dtMs / 600);
            state.sigEnergyRender = state.sigEnergyRender + (state.sigEnergy - state.sigEnergyRender) * k;
        }

        const now = performance.now();
        const isAbove = state.sigEnergyRender >= SIG_PULSE_THRESHOLD;
        if (!state.demoMode) {
            const cooledDown = now - state.sigPulseLastTime >= SIG_PULSE_COOLDOWN;
            if (isAbove && !state.sigWasAboveThreshold && cooledDown && !bootLock) {
                state.sigPulseStart = now;
                state.sigPulseLastTime = now;
            }
        }
        state.sigWasAboveThreshold = isAbove;

        if (state.sigPulseStart > 0 && now - state.sigPulseStart >= SIG_PULSE_DURATION) {
            state.sigPulseStart = 0;
        }

        const baseHue = state.dominant === 'baseline' ? baselineHue(performance.now()) : PALETTE[state.dominant].hue;
        const hueTau = state.demoMode ? 400 : state.dominant === 'baseline' ? 14000 : preset().hueTauMs;
        const hueK = 1 - Math.exp(-dtMs / hueTau);
        state.hueSmooth = hueApproach(state.hueSmooth, baseHue, hueK);
        const baseSat = state.dominant === 'baseline' ? 10 : state.dominant === 'pearson' ? 40 : 80;
        const satTarget = baseSat + preset().saturationBoost;
        const satK = 1 - Math.exp(-dtMs / preset().satTauMs);
        state.satSmooth = state.satSmooth + (satTarget - state.satSmooth) * satK;

        renderOrb();
        syncUi();
    }

    function resize() {
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const w = Math.floor(window.innerWidth * dpr);
        const h = Math.floor(window.innerHeight * dpr);
        canvasEl.width = w;
        canvasEl.height = h;
        canvasEl.style.width = `${window.innerWidth}px`;
        canvasEl.style.height = `${window.innerHeight}px`;
        const bw = Math.max(2, Math.floor(w * state.renderScale));
        const bh = Math.max(2, Math.floor(h * state.renderScale));
        bufCanvas.width = bw;
        bufCanvas.height = bh;
    }

    function renderOrb() {
        const w = bufCanvas.width;
        const h = bufCanvas.height;
        const t = performance.now() / 1000;
        const ctx = bufCtx;
        ctx.save();
        ctx.clearRect(0, 0, w, h);

        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#05060a');
        bg.addColorStop(0.6, '#04040a');
        bg.addColorStop(1, '#020208');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        const bootT = clamp01(state.bootMs / 5000);
        const bootLock = bootT < 1;
        const sig = state.sigEnergyRender;
        const cx = w * 0.5;
        const cy = h * 0.54;
        const rFull = Math.min(w, h) * 0.42;
        const rBoot = rFull * (0.06 + 0.94 * smoothstep(0, 1, bootT));
        const r = bootLock ? rBoot : rFull;
        let hue = state.hueSmooth;
        let sat = state.satSmooth;
        const isBaseline = state.dominant === 'baseline';
        const baselineLight = isBaseline ? 6 * Math.sin(t * 0.085) : 0;
        const polarity = Math.max(-1, Math.min(1, (state.zA + state.zB) / 6));
        hue = (hue + polarity * 10 + 6 * Math.sin(t * 0.08) + 3 * Math.sin(t * 0.13 + 1.7)) % 360;
        const whiten = smoothstep(0.3, 0.8, sig) * 0.5;
        const sigVis = Math.max(sig, 0.03);
        const brightness = (0.08 + 0.92 * Math.pow(sigVis, 1.3)) * preset().maxBrightness;
        const orbAlpha = 0.5 + 0.4 * brightness;

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

        const drift = 0.08 * r * (0.3 + 0.7 * brightness);
        const ox = drift * Math.sin(t * 0.17) + drift * 0.35 * Math.sin(t * 0.31 + 2.1);
        const oy = drift * Math.cos(t * 0.14) + drift * 0.35 * Math.cos(t * 0.27 + 0.7);

        let g = ctx.createRadialGradient(cx + ox, cy + oy, r * 0.1, cx, cy, r);
        g.addColorStop(0, `hsla(${hue} ${sat}% ${Math.round(56 - 10 * whiten + baselineLight)}% / ${0.95 * orbAlpha})`);
        g.addColorStop(0.55, `hsla(${hue} ${sat}% ${Math.round(44 - 12 * whiten + baselineLight)}% / ${0.55 * orbAlpha})`);
        g.addColorStop(1, `hsla(${hue} ${Math.round(sat * 0.7)}% ${Math.round(22 - 10 * whiten + baselineLight * 0.65)}% / ${0.12 * orbAlpha})`);
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

        ctx.globalCompositeOperation = 'screen';
        ctx.filter = `blur(${Math.max(10, 16 + 10 * brightness)}px)`;
        const g2 = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
        const hue2 = (hue + 28 + 22 * Math.sin(t * 0.12)) % 360;
        const hue3 = (hue - 24 + 18 * Math.sin(t * 0.09 + 1.1)) % 360;
        g2.addColorStop(0, `hsla(${hue2} ${Math.round(sat * 0.9)}% ${Math.round(55 - 8 * whiten + baselineLight * 0.6)}% / ${0.22 * orbAlpha})`);
        g2.addColorStop(0.55, `hsla(${hue3} ${Math.round(sat * 0.75)}% ${Math.round(48 - 10 * whiten + baselineLight * 0.55)}% / ${0.18 * orbAlpha})`);
        g2.addColorStop(1, `hsla(${hue2} ${Math.round(sat * 0.7)}% ${Math.round(46 - 10 * whiten + baselineLight * 0.45)}% / ${0.12 * orbAlpha})`);
        ctx.fillStyle = g2;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        ctx.filter = 'none';

        if (whiten > 0) {
            ctx.globalCompositeOperation = 'screen';
            ctx.filter = `blur(${Math.max(14, 18 + 24 * brightness)}px)`;
            const wg = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r);
            wg.addColorStop(0, `rgba(255,255,255,${0.36 * whiten * orbAlpha})`);
            wg.addColorStop(0.55, `rgba(255,255,255,${0.1 * whiten * orbAlpha})`);
            wg.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = wg;
            ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            ctx.filter = 'none';
        }

        if (!bootLock && state.sigEnergyRender > 0.001) {
            const s = Math.pow(state.sigEnergyRender, 0.85);
            const isSignificant = state.sigEnergyRender >= SIG_PULSE_THRESHOLD;
            const coreR = r * (0.08 + (isSignificant ? 0.45 : 0.32) * s);
            const coreBlur = Math.max(8, 20 - 8 * s + 6 * brightness);
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            const baseAlpha = isSignificant ? 0.12 + 0.55 * s : 0.06 + 0.38 * s;
            ctx.globalAlpha = baseAlpha * (0.75 + 0.25 * brightness);
            ctx.filter = `blur(${coreBlur}px)`;
            const cg = ctx.createRadialGradient(cx, cy, coreR * 0.05, cx, cy, coreR);
            if (isSignificant) {
                cg.addColorStop(0, 'rgba(255, 252, 245, 1.0)');
                cg.addColorStop(0.18, 'rgba(255, 248, 235, 0.85)');
                cg.addColorStop(0.45, 'rgba(255, 245, 230, 0.45)');
                cg.addColorStop(0.75, 'rgba(240, 248, 255, 0.15)');
                cg.addColorStop(1, 'rgba(255, 255, 255, 0)');
            } else {
                cg.addColorStop(0, 'rgba(255, 245, 232, 0.95)');
                cg.addColorStop(0.22, 'rgba(255, 238, 218, 0.65)');
                cg.addColorStop(0.55, 'rgba(220, 240, 255, 0.22)');
                cg.addColorStop(1, 'rgba(255, 255, 255, 0)');
            }
            ctx.fillStyle = cg;
            ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            ctx.restore();
        }

        if (state.sigPulseStart > 0) {
            const now = performance.now();
            const elapsed = now - state.sigPulseStart;
            const pulseT = Math.min(1, elapsed / SIG_PULSE_DURATION);
            const easeOut = 1 - Math.pow(1 - pulseT, 2);
            const ringRadius = r * (0.1 + 0.9 * easeOut);
            const ringWidth = r * 0.12 * (1 - pulseT * 0.5);
            const ringAlpha = (1 - pulseT) * 0.7;
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = ringAlpha;
            ctx.filter = `blur(${8 + 12 * pulseT}px)`;
            ctx.beginPath();
            ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 252, 245, 0.9)';
            ctx.lineWidth = ringWidth;
            ctx.stroke();
            ctx.restore();
        }

        if (bootLock) {
            const ignition = 1 - bootT;
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = 0.55 * ignition;
            ctx.filter = 'blur(18px)';
            const bootG = ctx.createRadialGradient(cx, cy, r * 0.02, cx, cy, r);
            bootG.addColorStop(0, `rgba(255, 245, 232, ${0.85 * ignition})`);
            bootG.addColorStop(0.18, `rgba(255, 238, 218, ${0.5 * ignition})`);
            bootG.addColorStop(0.55, `rgba(220, 240, 255, ${0.22 * ignition})`);
            bootG.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = bootG;
            ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            ctx.filter = 'blur(10px)';
            ctx.globalAlpha = 0.28 * ignition;
            const bandH = Math.max(2, r * (0.05 + 0.03 * (1 - bootT)));
            const lg = ctx.createLinearGradient(cx - r, cy - bandH, cx + r, cy + bandH);
            lg.addColorStop(0, 'rgba(255, 245, 232, 0)');
            lg.addColorStop(0.5, 'rgba(255, 245, 232, 0.85)');
            lg.addColorStop(1, 'rgba(255, 245, 232, 0)');
            ctx.fillStyle = lg;
            ctx.fillRect(cx - r, cy - bandH, r * 2, bandH * 2);
            ctx.globalAlpha = 1;
            ctx.filter = 'none';
        }

        const pMag = Math.abs(state.pearsonSpin);
        if (!bootLock && pMag > 0.05) {
            const swirlStrength = smoothstep(0.05, 0.4, pMag);
            const swirlPhase = (state.pearsonPhase / 360) * Math.PI * 2;
            ctx.globalCompositeOperation = 'soft-light';
            ctx.globalAlpha = 0.25 + 0.35 * swirlStrength;
            ctx.filter = `blur(${Math.max(8, 16 - 6 * swirlStrength)}px)`;

            if (typeof ctx.createConicGradient === 'function') {
                const cg = ctx.createConicGradient(swirlPhase, cx, cy);
                const bandCount = 4;
                for (let i = 0; i <= bandCount; i++) {
                    const pos = i / bandCount;
                    if (i % 2 === 0) cg.addColorStop(pos, `rgba(255, 255, 255, ${0.3 + 0.2 * swirlStrength})`);
                    else cg.addColorStop(pos, `rgba(0, 0, 0, ${0.15 + 0.1 * swirlStrength})`);
                }
                ctx.fillStyle = cg;
                ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            } else {
                const angle = swirlPhase;
                const x1 = cx + Math.cos(angle) * r;
                const y1 = cy + Math.sin(angle) * r;
                const x2 = cx - Math.cos(angle) * r;
                const y2 = cy - Math.sin(angle) * r;
                const lg = ctx.createLinearGradient(x1, y1, x2, y2);
                lg.addColorStop(0, `rgba(255, 255, 255, ${0.25 * swirlStrength})`);
                lg.addColorStop(0.5, `rgba(0, 0, 0, ${0.1 * swirlStrength})`);
                lg.addColorStop(1, `rgba(255, 255, 255, ${0.25 * swirlStrength})`);
                ctx.fillStyle = lg;
                ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            }

            ctx.globalAlpha = 1;
            ctx.filter = 'none';
            ctx.globalCompositeOperation = 'source-over';
        }

        ctx.restore();
        ctx.globalCompositeOperation = 'screen';
        ctx.filter = `blur(${Math.max(16, 22 + 26 * brightness)}px)`;
        const glow = ctx.createRadialGradient(cx, cy, r * 0.65, cx, cy, r * 1.25);
        glow.addColorStop(0, `hsla(${hue} ${Math.round(sat * 0.9)}% 62% / ${0.26 * orbAlpha})`);
        glow.addColorStop(0.5, `hsla(${hue} ${Math.round(sat * 0.8)}% 56% / ${0.18 * orbAlpha})`);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
        ctx.filter = 'none';

        ctx.globalCompositeOperation = 'source-over';
        const vg = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.2, cx, cy, Math.max(w, h) * 0.78);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, 'rgba(0,0,0,0.66)');
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        const out = canvasEl.getContext('2d');
        if (!out) return;
        out.save();
        out.imageSmoothingEnabled = true;
        out.clearRect(0, 0, canvasEl.width, canvasEl.height);
        out.drawImage(bufCanvas, 0, 0, canvasEl.width, canvasEl.height);
        out.restore();
    }

    function toggleHelp(force) {
        state.showHelp = typeof force === 'boolean' ? force : !state.showHelp;
        if (state.showHelp) {
            el.helpBackdrop.hidden = false;
            if (!el.helpModal.open) el.helpModal.show();
        } else {
            el.helpBackdrop.hidden = true;
            if (el.helpModal.open) el.helpModal.close();
        }
    }

    function syncUi() {
        el.stateName.textContent = `${DISPLAY_NAMES[state.dominant]}${getPearsonIndicator(state.pearsonSpin)}`;
        el.modeInfo.textContent = `${state.lightMode === 'wow' ? 'Wow' : 'Mellow'} / ${SENSITIVITY_LABELS[state.sensitivity]}`;
        el.legendPanel.hidden = !state.showLegend;
        el.devPanel.hidden = !state.showDev;
        el.demoOverlay.hidden = !state.demoMode;

        if (state.demoMode) {
            const isAnomaly = state.demoIndex === DEMO_CHANNELS.length;
            el.demoMain.textContent = isAnomaly ? 'Anomaly' : DEMO_LABELS[state.demoChannel];
            el.demoPearson.hidden = isAnomaly;
            el.demoPearson.textContent = state.demoPearsonDir === 1 ? 'Pearson+  (clockwise)' : 'Pearson−  (counter-clockwise)';
            el.demoProgress.textContent = `${state.demoIndex + 1} / ${DEMO_CHANNELS.length + 1}`;
        }

        if (state.showDev) {
            const domNonBaseline = state.dominant === 'baseline' ? null : state.dominant;
            el.dev.dominant.textContent = domNonBaseline ? PALETTE[domNonBaseline].name : 'Baseline';
            el.dev.visualParallel.textContent = percent(state.visualRender.parallel);
            el.dev.visualAntiparallel.textContent = percent(state.visualRender.antiparallel);
            el.dev.visualStick.textContent = percent(state.visualRender.stick_together);
            el.dev.visualPearson.textContent = percent(state.visualRender.pearson);
            el.dev.stage.textContent = String(currentStage());
            el.dev.coherence.textContent = percent(state.coherence);
            el.dev.sigEnergy.textContent = percent(state.sigEnergy);
            el.dev.rawCorrelatedHigh.textContent = percent(state.rawRender.correlated_high);
            el.dev.rawCorrelatedLow.textContent = percent(state.rawRender.correlated_low);
            el.dev.rawAntiAb.textContent = percent(state.rawRender.anti_ab);
            el.dev.rawAntiBa.textContent = percent(state.rawRender.anti_ba);
            el.dev.rawStick.textContent = percent(state.rawRender.stick);
            el.dev.rawWalkSeparate.textContent = percent(state.rawRender.walk_separate);
            el.dev.rawPearson.textContent = percent(state.rawRender.pearson);
            el.dev.zAB.textContent = `${state.zA.toFixed(2)} / ${state.zB.toFixed(2)}`;
            el.dev.pearsonR.textContent = state.pearsonR.toFixed(3);
            el.dev.pearsonDir.textContent = state.pearsonDir >= 0 ? '+' : '−';
            el.dev.zAgree.textContent = state.zAgree.toFixed(2);
            el.dev.walkCloseZ.textContent = state.walkCloseZ.toFixed(2);
            el.dev.walkSeparateZ.textContent = state.walkSeparateZ.toFixed(2);
            el.dev.walkDistance.textContent = `${state.walkCloseDistance.toFixed(1)} / ${state.walkSeparateDistance.toFixed(1)}`;
            el.dev.pValues.textContent = `${state.pMinRaw.toExponential(1)} / ${state.pOverallCalibrated.toExponential(1)}`;
            el.dev.surprisal.textContent = state.surprisal.toFixed(2);
            const anomalyActive = state.sigPulseStart > 0;
            const cooldownLeft = Math.max(0, SIG_PULSE_COOLDOWN - (performance.now() - state.sigPulseLastTime));
            el.dev.anomalyState.textContent = anomalyActive ? 'ring' : state.sigEnergyRender >= SIG_PULSE_THRESHOLD ? 'above threshold' : cooldownLeft > 0 ? `cooldown ${(cooldownLeft / 1000).toFixed(1)}s` : 'armed';
            el.dev.tickCount.textContent = String(state.tickCount);
            el.dev.fps.textContent = state.fps.toFixed(0);

            const episodeText = (key) => {
                const ep = state.episodes[key];
                if (!ep) return '—';
                const len = state.tickCount > 0 ? Math.max(0, state.cumSumA.length - 1 - ep.startTick) : 0;
                return `s${ep.startTick} l${len} z${ep.currentZ.toFixed(2)} p${ep.peakZ.toFixed(2)}`;
            };
            el.dev.epCorrelatedHigh.textContent = episodeText('correlated_high');
            el.dev.epCorrelatedLow.textContent = episodeText('correlated_low');
            el.dev.epAntiAb.textContent = episodeText('anti_ab');
            el.dev.epAntiBa.textContent = episodeText('anti_ba');
            el.dev.epStick.textContent = episodeText('stick');
            el.dev.epWalkSeparate.textContent = episodeText('walk_separate');
            el.dev.epPearson.textContent = episodeText('pearson');

            const episodeKey = domNonBaseline === 'parallel'
                ? (state.rawRender.correlated_high >= state.rawRender.correlated_low ? 'correlated_high' : 'correlated_low')
                : domNonBaseline === 'antiparallel'
                    ? (state.rawRender.walk_separate >= Math.max(state.rawRender.anti_ab, state.rawRender.anti_ba) ? 'walk_separate' : state.rawRender.anti_ab >= state.rawRender.anti_ba ? 'anti_ab' : 'anti_ba')
                    : domNonBaseline === 'stick_together'
                        ? 'stick'
                        : domNonBaseline;

            if (episodeKey && state.episodes[episodeKey]) {
                const ep = state.episodes[episodeKey];
                const duration = state.tickCount > 0 ? Math.max(0, state.cumSumA.length - 1 - ep.startTick) : 0;
                el.devRows.episode.hidden = false;
                el.dev.episode.textContent = `${duration}s | peak z=${ep.peakZ.toFixed(2)}`;
            } else {
                el.devRows.episode.hidden = true;
            }

            if (state.demoBoost > 0.01 && !state.demoMode) {
                el.devRows.demoBoost.hidden = false;
                el.dev.demoBoost.textContent = `${(state.demoBoost * 100).toFixed(0)}%`;
            } else {
                el.devRows.demoBoost.hidden = true;
            }
        }
    }

    function startDemo() {
        state.demoMode = true;
        state.demoIndex = 0;
        state.demoChannel = DEMO_CHANNELS[0];
        state.demoPearsonDir = 1;
        state.demoBoost = 0;
        state.demoPearsonBoost = 0;
        state.demoStartTime = performance.now();
    }

    function stopDemo() {
        state.demoMode = false;
        state.demoBoost = 0;
        state.demoPearsonBoost = 0;
    }

    function handleKeydown(e) {
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

        if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
            toggleHelp();
            return;
        }
        if (e.key === 'l' || e.key === 'L') {
            state.showLegend = !state.showLegend;
            syncUi();
            return;
        }
        if (e.key === '`') {
            state.showDev = !state.showDev;
            syncUi();
            return;
        }
        if (e.key === 'm' || e.key === 'M') {
            state.lightMode = state.lightMode === 'wow' ? 'mellow' : 'wow';
            syncUi();
            return;
        }
        if (e.key === 's' || e.key === 'S') {
            const order = ['conservative', 'moderate', 'engaging'];
            const idx = order.indexOf(state.sensitivity);
            state.sensitivity = order[(idx + 1) % order.length];
            syncUi();
            return;
        }
        if (e.key === 'd' || e.key === 'D') {
            if (state.demoMode) stopDemo();
            else startDemo();
            syncUi();
            return;
        }
        if (e.key === 'Escape') {
            if (state.demoMode) stopDemo();
            else if (state.showHelp) toggleHelp(false);
            else if (state.showLegend) state.showLegend = false;
            else if (state.showDev) state.showDev = false;
            syncUi();
        }
    }

    function cacheElements() {
        canvasEl = document.getElementById('wyrd-canvas');
        el.devPanel = document.getElementById('wyrd-dev-panel');
        el.legendPanel = document.getElementById('wyrd-legend-panel');
        el.helpBackdrop = document.getElementById('wyrd-help-backdrop');
        el.helpModal = document.getElementById('wyrd-help-modal');
        el.demoOverlay = document.getElementById('wyrd-demo-overlay');
        el.stateName = document.querySelector('[data-ui="stateName"]');
        el.modeInfo = document.querySelector('[data-ui="modeInfo"]');
        el.demoMain = document.querySelector('[data-demo="main"]');
        el.demoPearson = document.querySelector('[data-demo="pearson"]');
        el.demoProgress = document.querySelector('[data-demo="progress"]');
        el.dev = {};
        for (const node of document.querySelectorAll('[data-dev]')) {
            el.dev[node.dataset.dev] = node;
        }
        el.devRows = {};
        for (const node of document.querySelectorAll('[data-dev-row]')) {
            el.devRows[node.dataset.devRow] = node;
        }
    }

    function init() {
        cacheElements();
        if (!canvasEl) return;
        bufCanvas = document.createElement('canvas');
        const ctx = bufCanvas.getContext('2d');
        if (!ctx) {
            console.error('WyrdWeb requires 2D canvas support.');
            return;
        }
        bufCtx = ctx;

        el.helpBackdrop.addEventListener('click', () => toggleHelp(false));
        el.helpModal.addEventListener('cancel', (event) => {
            event.preventDefault();
            toggleHelp(false);
        });

        reseed();
        resize();
        syncUi();
        window.addEventListener('resize', resize, { passive: true });
        window.addEventListener('keydown', handleKeydown);

        let last = performance.now();
        let fpsSmooth = 0;
        const loop = (now) => {
            const dt = Math.min(80, now - last);
            last = now;
            const inst = 1000 / Math.max(1, dt);
            fpsSmooth = fpsSmooth ? fpsSmooth * 0.92 + inst * 0.08 : inst;
            state.fps = fpsSmooth;
            step(dt);
            state.raf = requestAnimationFrame(loop);
        };
        state.raf = requestAnimationFrame(loop);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
