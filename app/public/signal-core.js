(function (root, factory) {
    const core = factory();
    if (typeof module === 'object' && module.exports) module.exports = core;
    root.WyrdSignalCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function clamp01(v) {
        return Math.min(1, Math.max(0, v));
    }

    function strengthFromP(p, pStart, pFull) {
        const safeP = Math.max(1e-12, Math.min(1, p));
        const value = -Math.log10(safeP);
        const start = -Math.log10(pStart);
        const full = -Math.log10(pFull);
        return clamp01((value - start) / (full - start));
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

    function interpolateLogP(p1, x1, p2, x2, x) {
        if (x1 === x2) return Math.max(p1, p2);
        const t = clamp01((x - x1) / (x2 - x1));
        return Math.exp(Math.log(p1) + (Math.log(p2) - Math.log(p1)) * t);
    }

    function empiricalTailP(value, table, mode) {
        if (!Number.isFinite(value) || !Array.isArray(table) || table.length === 0) return 1;

        if (mode === 'lower') {
            if (value <= table[0][1]) return table[0][0];
            if (value >= table[table.length - 1][1]) return 1;
        } else {
            if (value <= table[0][1]) return 1;
            if (value >= table[table.length - 1][1]) return table[table.length - 1][0];
        }

        for (let i = 0; i < table.length - 1; i++) {
            const [p1, x1] = table[i];
            const [p2, x2] = table[i + 1];
            if (value >= x1 && value <= x2) return interpolateLogP(p1, x1, p2, x2, value);
        }
        return 1;
    }

    function zEquivalentFromOneSidedP(p) {
        const target = 1 - Math.max(1e-12, Math.min(1, p));
        let lo = 0;
        let hi = 8;
        for (let i = 0; i < 36; i++) {
            const mid = (lo + hi) / 2;
            if (normalCdf(mid) < target) lo = mid;
            else hi = mid;
        }
        return (lo + hi) / 2;
    }

    function findOptimalStartingPoint(cumSum, currentIdx, bitsPerTick, lookback, minLen) {
        let bestZ = 0;
        let bestStart = currentIdx;
        const endSum = cumSum[currentIdx] ?? 0;
        const searchStart = Math.max(0, currentIdx - lookback);
        for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
            const delta = endSum - (cumSum[s] ?? 0);
            const bitSpan = (currentIdx - s) * bitsPerTick;
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
            const delta = endSum - (cumSum[s] ?? 0);
            const bitSpan = (currentIdx - s) * bitsPerTick;
            const z = delta / Math.sqrt(bitSpan / 4);
            if (z > bestZ) {
                bestZ = z;
                bestStart = s;
            }
        }
        return { startIdx: bestStart, z: bestZ };
    }

    function findOptimalStartingPointCorrelated(cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen) {
        let highZ = 0;
        let lowZ = 0;
        let highStart = currentIdx;
        let lowStart = currentIdx;
        const searchStart = Math.max(0, currentIdx - lookback);
        for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
            const bitSpan = (currentIdx - s) * bitsPerTick;
            const zA = ((cumSumA[currentIdx] ?? 0) - (cumSumA[s] ?? 0)) / Math.sqrt(bitSpan);
            const zB = ((cumSumB[currentIdx] ?? 0) - (cumSumB[s] ?? 0)) / Math.sqrt(bitSpan);
            if (zA > 0 && zB > 0) {
                const strength = Math.min(zA, zB);
                if (strength > highZ) {
                    highZ = strength;
                    highStart = s;
                }
            }
            if (zA < 0 && zB < 0) {
                const strength = Math.min(-zA, -zB);
                if (strength > lowZ) {
                    lowZ = strength;
                    lowStart = s;
                }
            }
        }
        return { highZ, highStart, lowZ, lowStart };
    }

    function findOptimalStartingPointAnti(cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen) {
        let abZ = 0;
        let baZ = 0;
        let abStart = currentIdx;
        let baStart = currentIdx;
        const searchStart = Math.max(0, currentIdx - lookback);
        for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
            const bitSpan = (currentIdx - s) * bitsPerTick;
            const zA = ((cumSumA[currentIdx] ?? 0) - (cumSumA[s] ?? 0)) / Math.sqrt(bitSpan);
            const zB = ((cumSumB[currentIdx] ?? 0) - (cumSumB[s] ?? 0)) / Math.sqrt(bitSpan);
            if (zA > 0 && zB < 0) {
                const strength = Math.min(zA, -zB);
                if (strength > abZ) {
                    abZ = strength;
                    abStart = s;
                }
            }
            if (zA < 0 && zB > 0) {
                const strength = Math.min(-zA, zB);
                if (strength > baZ) {
                    baZ = strength;
                    baStart = s;
                }
            }
        }
        return { abZ, abStart, baZ, baStart };
    }

    function findOptimalStartingPointPearson(cumSumXY, cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen) {
        let bestZ = 0;
        let bestR = 0;
        let bestStart = currentIdx;
        const searchStart = Math.max(0, currentIdx - lookback);
        for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
            const bitSpan = (currentIdx - s) * bitsPerTick;
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

    function walkDistanceScores(cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen, calibration) {
        let closeRatio = Number.POSITIVE_INFINITY;
        let closeStart = currentIdx;
        let closeDistance = 0;
        let closeLegacyZ = 0;
        let separateRatio = Number.NEGATIVE_INFINITY;
        let separateStart = currentIdx;
        let separateDistance = 0;
        let separateLegacyZ = 0;
        let foundCandidate = false;
        const searchStart = Math.max(0, currentIdx - lookback);
        const expectedAbsNormalScale = Math.sqrt(2 / Math.PI);

        for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
            const tickSpan = currentIdx - s;
            if (tickSpan < minLen) continue;
            foundCandidate = true;
            let sumDistance = 0;
            let expectedSumDistance = 0;
            const a0 = cumSumA[s] ?? 0;
            const b0 = cumSumB[s] ?? 0;
            for (let i = s + 1; i <= currentIdx; i++) {
                const age = i - s;
                const walkA = (cumSumA[i] ?? 0) - a0;
                const walkB = (cumSumB[i] ?? 0) - b0;
                sumDistance += Math.abs(walkA - walkB);
                expectedSumDistance += Math.sqrt(2 * bitsPerTick * age) * expectedAbsNormalScale;
            }
            const meanDistance = sumDistance / tickSpan;
            const expectedMean = Math.max(1e-12, expectedSumDistance / tickSpan);
            const ratio = meanDistance / expectedMean;
            const ratioSigma = Math.max(0.09, 0.34 / Math.pow(tickSpan, 0.25));
            if (ratio < closeRatio) {
                closeRatio = ratio;
                closeStart = s;
                closeDistance = meanDistance;
                closeLegacyZ = (1 - ratio) / ratioSigma;
            }
            if (ratio > separateRatio) {
                separateRatio = ratio;
                separateStart = s;
                separateDistance = meanDistance;
                separateLegacyZ = (ratio - 1) / ratioSigma;
            }
        }

        if (!foundCandidate) {
            return {
                closeRatio: 1, closeP: 1, closeZ: 0, closeLegacyZ: 0, closeStart: currentIdx, closeDistance: 0,
                separateRatio: 1, separateP: 1, separateZ: 0, separateLegacyZ: 0, separateStart: currentIdx, separateDistance: 0
            };
        }

        const closeP = empiricalTailP(closeRatio, calibration.walkCloseLowerTail, 'lower');
        const separateP = empiricalTailP(separateRatio, calibration.walkSeparateUpperTail, 'upper');
        return {
            closeRatio,
            closeP,
            closeZ: zEquivalentFromOneSidedP(closeP),
            closeLegacyZ,
            closeStart,
            closeDistance,
            separateRatio,
            separateP,
            separateZ: zEquivalentFromOneSidedP(separateP),
            separateLegacyZ,
            separateStart,
            separateDistance
        };
    }

    function computeRuntimeSignal(cumSumA, cumSumB, cumSumXY, currentIdx, bitsPerTick, lookback, minLen, calibration) {
        const corr = findOptimalStartingPointCorrelated(cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen);
        const anti = findOptimalStartingPointAnti(cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen);
        const pearson = findOptimalStartingPointPearson(cumSumXY, cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen);
        const walk = walkDistanceScores(cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen, calibration);
        const p = {
            corrHigh: empiricalTailP(corr.highZ, calibration.corrHighUpperTail, 'upper'),
            corrLow: empiricalTailP(corr.lowZ, calibration.corrLowUpperTail, 'upper'),
            antiAb: empiricalTailP(anti.abZ, calibration.antiAbUpperTail, 'upper'),
            antiBa: empiricalTailP(anti.baZ, calibration.antiBaUpperTail, 'upper'),
            stick: walk.closeP,
            walkSeparate: walk.separateP,
            pearson: empiricalTailP(Math.abs(pearson.z), calibration.pearsonAbsUpperTail, 'upper')
        };
        const pMinRaw = Math.min(p.corrHigh, p.corrLow, p.antiAb, p.antiBa, p.stick, p.walkSeparate, p.pearson);
        const pOverallCalibrated = empiricalTailP(pMinRaw, calibration.fullStackPMinLowerTail, 'lower');
        return { corr, anti, pearson, walk, p, pMinRaw, pOverallCalibrated };
    }

    return {
        clamp01,
        strengthFromP,
        normalCdf,
        twoSidedPFromZ,
        empiricalTailP,
        zEquivalentFromOneSidedP,
        findOptimalStartingPoint,
        findOptimalStartingPointAgreement,
        findOptimalStartingPointCorrelated,
        findOptimalStartingPointAnti,
        findOptimalStartingPointPearson,
        walkDistanceScores,
        computeRuntimeSignal
    };
});
