#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_CALIBRATION = 'tools/calibration/walk-distance-200bit-lookback120-1m.json';
const CHANNELS = ['baseline', 'parallel', 'antiparallel', 'stick_together', 'pearson'];
const SENSITIVITY_PRESETS = {
	conservative: {
		strengthZStart: 2.4,
		strengthZFull: 3.5,
		stickZStart: 3.4,
		stickZFull: 4.5,
		pearsonRStart: 0.25,
		pearsonRFull: 0.5,
		dominanceThreshold: 0.12,
		walkPStart: 0.005,
		walkPFull: 0.0001
	},
	moderate: {
		strengthZStart: 2.0,
		strengthZFull: 3.2,
		stickZStart: 2.9,
		stickZFull: 4.0,
		pearsonRStart: 0.2,
		pearsonRFull: 0.45,
		dominanceThreshold: 0.12,
		walkPStart: 0.02,
		walkPFull: 0.0003
	},
	engaging: {
		strengthZStart: 1.7,
		strengthZFull: 3.0,
		stickZStart: 2.6,
		stickZFull: 3.8,
		pearsonRStart: 0.16,
		pearsonRFull: 0.4,
		dominanceThreshold: 0.1,
		walkPStart: 0.05,
		walkPFull: 0.001
	}
};

function usage() {
	return (
		`Usage: node tools/validate-signal-null.js [options]\n\n` +
		`Runs a synthetic null validation of the full detector stack. It compares\n` +
		`the current uncalibrated walk-distance wiring against calibrated walk\n` +
		`Channel 3min/3max approximations loaded from the calibration JSON.\n\n` +
		`Options:\n` +
		`  --ticks <n>             Total ticks to simulate. Default: 100000\n` +
		`  --calibration <path>    Walk calibration JSON. Default: ${DEFAULT_CALIBRATION}\n` +
		`  --sample-bits <n>       Bits per stream per tick. Default: from calibration\n` +
		`  --max-lookback <n>      Starting-point search depth. Default: from calibration\n` +
		`  --min-segment-len <n>   Minimum segment length. Default: from calibration\n` +
		`  --warmup <n>            Ticks to skip before recording. Default: max-lookback\n` +
		`  --out <path>            Optional JSON report path\n` +
		`  --pretty                Pretty-print JSON output\n` +
		`  --help                  Show this help\n`
	);
}

function parseArgs(argv) {
	const options = {
		ticks: 100_000,
		calibration: DEFAULT_CALIBRATION,
		sampleBits: null,
		maxLookback: null,
		minSegmentLen: null,
		warmup: null,
		out: null,
		pretty: false
	};

	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => {
			const value = argv[++i];
			if (value == null || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
			return value;
		};
		switch (arg) {
			case '--ticks':
				options.ticks = Number(next());
				break;
			case '--calibration':
				options.calibration = next();
				break;
			case '--sample-bits':
				options.sampleBits = Number(next());
				break;
			case '--max-lookback':
				options.maxLookback = Number(next());
				break;
			case '--min-segment-len':
				options.minSegmentLen = Number(next());
				break;
			case '--warmup':
				options.warmup = Number(next());
				break;
			case '--out':
				options.out = next();
				break;
			case '--pretty':
				options.pretty = true;
				break;
			case '--help':
				console.log(usage());
				process.exit(0);
			default:
				throw new Error(`Unknown option: ${arg}`);
		}
	}

	options.ticks = Math.floor(options.ticks);
	if (!Number.isFinite(options.ticks) || options.ticks < 1)
		throw new Error('--ticks must be positive');
	return options;
}

class RandomByteStream {
	constructor(chunkBytes = 1_048_576) {
		this.chunkBytes = chunkBytes;
		this.buffer = randomBytes(chunkBytes);
		this.offset = 0;
	}
	reserve(byteCount) {
		if (this.buffer.length - this.offset < byteCount) {
			this.buffer = randomBytes(Math.max(this.chunkBytes, byteCount));
			this.offset = 0;
		}
		const start = this.offset;
		this.offset += byteCount;
		return start;
	}
}

function bitAt(buffer, bitIndex) {
	return (buffer[bitIndex >> 3] >> (bitIndex & 7)) & 1;
}

function sampleTick(byteStream, sampleBits) {
	const byteCount = Math.ceil((2 * sampleBits) / 8);
	const baseByte = byteStream.reserve(byteCount);
	const buffer = byteStream.buffer;
	let sumX = 0;
	let sumY = 0;
	let sumXY = 0;
	let agree = 0;

	for (let i = 0; i < sampleBits; i++) {
		const pairBit = i * 2;
		const a = bitAt(buffer, baseByte * 8 + pairBit);
		const b = bitAt(buffer, baseByte * 8 + pairBit + 1);
		if (a === b) agree++;
		const x = a === 1 ? 1 : -1;
		const y = b === 1 ? 1 : -1;
		sumX += x;
		sumY += y;
		sumXY += x * y;
	}

	return { sumX, sumY, sumXY, agree };
}

function clamp01(v) {
	return Math.min(1, Math.max(0, v));
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
	const tail = 1 - normalCdf(Math.abs(z));
	return Math.max(1e-18, Math.min(1, 2 * tail));
}

function oneSidedPFromZ(z) {
	return Math.max(1e-18, Math.min(1, 1 - normalCdf(z)));
}

function strengthFromZ(z, zStart, zFull) {
	return clamp01((Math.abs(z) - zStart) / (zFull - zStart));
}

function strengthFromP(p, pStart, pFull) {
	const safeP = Math.max(1e-12, Math.min(1, p));
	const start = -Math.log10(pStart);
	const full = -Math.log10(pFull);
	const value = -Math.log10(safeP);
	return clamp01((value - start) / (full - start));
}

function findOptimalStartingPointAgreement(cumSum, currentIdx, bitsPerTick, lookback, minLen) {
	let bestZ = 0;
	const endSum = cumSum[currentIdx] ?? 0;
	const searchStart = Math.max(0, currentIdx - lookback);
	for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
		const delta = endSum - (cumSum[s] ?? 0);
		const bitSpan = (currentIdx - s) * bitsPerTick;
		const z = delta / Math.sqrt(bitSpan / 4);
		if (z > bestZ) bestZ = z;
	}
	return bestZ;
}

function findOptimalStartingPointCorrelated(
	cumSumA,
	cumSumB,
	currentIdx,
	bitsPerTick,
	lookback,
	minLen
) {
	let highZ = 0;
	let lowZ = 0;
	const searchStart = Math.max(0, currentIdx - lookback);
	for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
		const bitSpan = (currentIdx - s) * bitsPerTick;
		const zA = ((cumSumA[currentIdx] ?? 0) - (cumSumA[s] ?? 0)) / Math.sqrt(bitSpan);
		const zB = ((cumSumB[currentIdx] ?? 0) - (cumSumB[s] ?? 0)) / Math.sqrt(bitSpan);
		if (zA > 0 && zB > 0) highZ = Math.max(highZ, Math.min(zA, zB));
		if (zA < 0 && zB < 0) lowZ = Math.max(lowZ, Math.min(-zA, -zB));
	}
	return { highZ, lowZ };
}

function findOptimalStartingPointAnti(cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen) {
	let abZ = 0;
	let baZ = 0;
	const searchStart = Math.max(0, currentIdx - lookback);
	for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
		const bitSpan = (currentIdx - s) * bitsPerTick;
		const zA = ((cumSumA[currentIdx] ?? 0) - (cumSumA[s] ?? 0)) / Math.sqrt(bitSpan);
		const zB = ((cumSumB[currentIdx] ?? 0) - (cumSumB[s] ?? 0)) / Math.sqrt(bitSpan);
		if (zA > 0 && zB < 0) abZ = Math.max(abZ, Math.min(zA, -zB));
		if (zA < 0 && zB > 0) baZ = Math.max(baZ, Math.min(-zA, zB));
	}
	return { abZ, baZ };
}

function findOptimalStartingPointPearson(
	cumSumXY,
	cumSumA,
	cumSumB,
	currentIdx,
	bitsPerTick,
	lookback,
	minLen
) {
	let bestZ = 0;
	let bestR = 0;
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
		}
	}
	return { z: bestZ, r: bestR };
}

function walkDistanceScores(cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen) {
	let closeRatio = Number.POSITIVE_INFINITY;
	let separateRatio = Number.NEGATIVE_INFINITY;
	let closeLegacyZ = 0;
	let separateLegacyZ = 0;
	const searchStart = Math.max(0, currentIdx - lookback);
	const expectedAbsNormalScale = Math.sqrt(2 / Math.PI);

	for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
		const tickSpan = currentIdx - s;
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
		const ratio = sumDistance / tickSpan / Math.max(1e-12, expectedSumDistance / tickSpan);
		const ratioSigma = Math.max(0.09, 0.34 / Math.pow(tickSpan, 0.25));
		if (ratio < closeRatio) {
			closeRatio = ratio;
			closeLegacyZ = (1 - ratio) / ratioSigma;
		}
		if (ratio > separateRatio) {
			separateRatio = ratio;
			separateLegacyZ = (ratio - 1) / ratioSigma;
		}
	}
	return { closeRatio, separateRatio, closeLegacyZ, separateLegacyZ };
}

function prepareTailTable(rows, mode) {
	const mapped = rows
		.map(([p, threshold]) => ({ p, threshold }))
		.filter((row) => Number.isFinite(row.p) && Number.isFinite(row.threshold) && row.p > 0)
		.sort((a, b) => a.threshold - b.threshold);
	if (mode === 'upper') return mapped;
	return mapped;
}

function interpolateLogP(p1, x1, p2, x2, x) {
	if (x1 === x2) return Math.min(p1, p2);
	const t = Math.max(0, Math.min(1, (x - x1) / (x2 - x1)));
	const logP = Math.log(p1) + (Math.log(p2) - Math.log(p1)) * t;
	return Math.exp(logP);
}

function empiricalTailP(value, table, mode) {
	if (!Number.isFinite(value) || table.length === 0) return 1;
	if (mode === 'lower') {
		if (value <= table[0].threshold) return table[0].p;
		if (value >= table[table.length - 1].threshold) return 1;
		for (let i = 0; i < table.length - 1; i++) {
			const a = table[i];
			const b = table[i + 1];
			if (value >= a.threshold && value <= b.threshold) {
				return interpolateLogP(a.p, a.threshold, b.p, b.threshold, value);
			}
		}
		return 1;
	}

	// Upper tail: thresholds ascend while p descends. Low/non-extreme values are p~1.
	if (value <= table[0].threshold) return 1;
	if (value >= table[table.length - 1].threshold) return table[table.length - 1].p;
	for (let i = 0; i < table.length - 1; i++) {
		const a = table[i];
		const b = table[i + 1];
		if (value >= a.threshold && value <= b.threshold) {
			return interpolateLogP(a.p, a.threshold, b.p, b.threshold, value);
		}
	}
	return 1;
}

function zeroCounts() {
	return Object.fromEntries(CHANNELS.map((channel) => [channel, 0]));
}

function chooseDominant(visual, threshold) {
	let best = 'baseline';
	let bestV = 0;
	for (const channel of CHANNELS) {
		if (channel === 'baseline') continue;
		const v = visual[channel] ?? 0;
		if (v > bestV) {
			best = channel;
			bestV = v;
		}
	}
	return bestV > threshold ? best : 'baseline';
}

function quantile(sorted, q) {
	if (sorted.length === 0) return null;
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

function quantileTable(values, probabilities = [0.01, 0.05, 0.1, 0.5, 0.9, 0.95, 0.99]) {
	values.sort();
	return probabilities.map((p) => [p, quantile(values, p)]);
}

function countsToPercent(counts, total) {
	return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, total > 0 ? v / total : 0]));
}

function printSummary(report) {
	console.log('\nSignal null validation summary');
	console.log('------------------------------');
	console.log(`ticks:       ${report.params.ticks.toLocaleString()}`);
	console.log(`recorded:    ${report.params.recordedSamples.toLocaleString()}`);
	console.log(`duration:    ${(report.runtime.durationMs / 1000).toFixed(2)}s`);
	console.log(`throughput:  ${Math.round(report.runtime.ticksPerSecond).toLocaleString()} ticks/s`);

	for (const sensitivity of Object.keys(SENSITIVITY_PRESETS)) {
		const row = report.results[sensitivity];
		console.log(`\n${sensitivity}`);
		console.log('  current uncalibrated dominance:', row.currentUncalibrated.percent);
		console.log('  calibrated walk dominance:     ', row.calibratedWalk.percent);
		console.log('  calibrated pMin q50/q05/q01:   ', {
			q50: row.calibratedWalk.pMinQuantiles.find(([p]) => p === 0.5)?.[1],
			q05: row.calibratedWalk.pMinQuantiles.find(([p]) => p === 0.05)?.[1],
			q01: row.calibratedWalk.pMinQuantiles.find(([p]) => p === 0.01)?.[1]
		});
	}
}

function main() {
	const options = parseArgs(process.argv);
	const calibrationPath = resolve(options.calibration);
	const calibration = JSON.parse(readFileSync(calibrationPath, 'utf8'));
	const sampleBits = Math.floor(options.sampleBits ?? calibration.params.sampleBits);
	const maxLookback = Math.floor(options.maxLookback ?? calibration.params.maxLookback);
	const minSegmentLen = Math.floor(options.minSegmentLen ?? calibration.params.minSegmentLen);
	const warmup = Math.floor(options.warmup ?? maxLookback);
	if (options.ticks <= warmup) throw new Error('--ticks must be greater than warmup');

	if (
		sampleBits !== calibration.params.sampleBits ||
		maxLookback !== calibration.params.maxLookback ||
		minSegmentLen !== calibration.params.minSegmentLen
	) {
		console.warn('Warning: runtime detector settings do not match the calibration table.');
	}

	const closeTable = prepareTailTable(
		calibration.walkDistance.closeRatio.lowerTailThresholds,
		'lower'
	);
	const separateTable = prepareTailTable(
		calibration.walkDistance.separateRatio.upperTailThresholds,
		'upper'
	);
	const recordedSamples = options.ticks - warmup;
	const stateBySensitivity = Object.fromEntries(
		Object.keys(SENSITIVITY_PRESETS).map((sensitivity) => [
			sensitivity,
			{
				currentCounts: zeroCounts(),
				calibratedCounts: zeroCounts(),
				pMin: new Float64Array(recordedSamples)
			}
		])
	);

	let cumSumA = [0];
	let cumSumB = [0];
	let cumSumAgree = [0];
	let cumSumXY = [0];
	const maxStoredTicks = maxLookback + 20;
	const byteStream = new RandomByteStream();
	const started = performance.now();
	let recorded = 0;

	for (let tick = 1; tick <= options.ticks; tick++) {
		const sample = sampleTick(byteStream, sampleBits);
		cumSumA.push((cumSumA[cumSumA.length - 1] ?? 0) + sample.sumX);
		cumSumB.push((cumSumB[cumSumB.length - 1] ?? 0) + sample.sumY);
		cumSumAgree.push((cumSumAgree[cumSumAgree.length - 1] ?? 0) + (sample.agree - sampleBits / 2));
		cumSumXY.push((cumSumXY[cumSumXY.length - 1] ?? 0) + sample.sumXY);
		if (cumSumA.length > maxStoredTicks) {
			cumSumA = cumSumA.slice(-maxStoredTicks);
			cumSumB = cumSumB.slice(-maxStoredTicks);
			cumSumAgree = cumSumAgree.slice(-maxStoredTicks);
			cumSumXY = cumSumXY.slice(-maxStoredTicks);
		}
		if (tick <= warmup) continue;

		const currentIdx = cumSumA.length - 1;
		const corr = findOptimalStartingPointCorrelated(
			cumSumA,
			cumSumB,
			currentIdx,
			sampleBits,
			maxLookback,
			minSegmentLen
		);
		const anti = findOptimalStartingPointAnti(
			cumSumA,
			cumSumB,
			currentIdx,
			sampleBits,
			maxLookback,
			minSegmentLen
		);
		const stickAgreeZ = findOptimalStartingPointAgreement(
			cumSumAgree,
			currentIdx,
			sampleBits,
			maxLookback,
			minSegmentLen
		);
		const pearson = findOptimalStartingPointPearson(
			cumSumXY,
			cumSumA,
			cumSumB,
			currentIdx,
			sampleBits,
			maxLookback,
			minSegmentLen
		);
		const walk = walkDistanceScores(
			cumSumA,
			cumSumB,
			currentIdx,
			sampleBits,
			maxLookback,
			minSegmentLen
		);
		const pClose = empiricalTailP(walk.closeRatio, closeTable, 'lower');
		const pSeparate = empiricalTailP(walk.separateRatio, separateTable, 'upper');

		for (const [sensitivity, preset] of Object.entries(SENSITIVITY_PRESETS)) {
			const currentVisual = {
				parallel: Math.max(
					strengthFromZ(corr.highZ, preset.strengthZStart, preset.strengthZFull),
					strengthFromZ(corr.lowZ, preset.strengthZStart, preset.strengthZFull)
				),
				antiparallel: Math.max(
					strengthFromZ(anti.abZ, preset.strengthZStart, preset.strengthZFull),
					strengthFromZ(anti.baZ, preset.strengthZStart, preset.strengthZFull),
					strengthFromZ(walk.separateLegacyZ, preset.stickZStart, preset.stickZFull)
				),
				stick_together: strengthFromZ(walk.closeLegacyZ, preset.stickZStart, preset.stickZFull),
				pearson: clamp01(
					(Math.abs(pearson.r) - preset.pearsonRStart) /
						(preset.pearsonRFull - preset.pearsonRStart)
				)
			};

			const calibratedVisual = {
				parallel: currentVisual.parallel,
				antiparallel: Math.max(
					strengthFromZ(anti.abZ, preset.strengthZStart, preset.strengthZFull),
					strengthFromZ(anti.baZ, preset.strengthZStart, preset.strengthZFull),
					strengthFromP(pSeparate, preset.walkPStart, preset.walkPFull)
				),
				stick_together: strengthFromP(pClose, preset.walkPStart, preset.walkPFull),
				pearson: currentVisual.pearson
			};

			const bucket = stateBySensitivity[sensitivity];
			bucket.currentCounts[chooseDominant(currentVisual, preset.dominanceThreshold)]++;
			bucket.calibratedCounts[chooseDominant(calibratedVisual, preset.dominanceThreshold)]++;

			const pCorrHigh = corr.highZ !== 0 ? twoSidedPFromZ(corr.highZ) : 1;
			const pCorrLow = corr.lowZ !== 0 ? twoSidedPFromZ(corr.lowZ) : 1;
			const pAntiAb = anti.abZ !== 0 ? twoSidedPFromZ(anti.abZ) : 1;
			const pAntiBa = anti.baZ !== 0 ? twoSidedPFromZ(anti.baZ) : 1;
			const pStickAgree = Math.min(1, (stickAgreeZ > 0 ? oneSidedPFromZ(stickAgreeZ) : 1) / 0.05);
			const pPearson = Math.min(1, (pearson.z !== 0 ? twoSidedPFromZ(pearson.z) : 1) / 0.016);
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
		}
		recorded++;
	}

	const ended = performance.now();
	const results = {};
	for (const [sensitivity, bucket] of Object.entries(stateBySensitivity)) {
		results[sensitivity] = {
			currentUncalibrated: {
				counts: bucket.currentCounts,
				percent: countsToPercent(bucket.currentCounts, recordedSamples)
			},
			calibratedWalk: {
				counts: bucket.calibratedCounts,
				percent: countsToPercent(bucket.calibratedCounts, recordedSamples),
				pMinQuantiles: quantileTable(bucket.pMin)
			}
		};
	}

	const report = {
		version: 1,
		kind: 'wyrdweb-signal-null-validation',
		createdAt: new Date().toISOString(),
		params: {
			ticks: options.ticks,
			warmupTicks: warmup,
			recordedSamples,
			sampleBits,
			maxLookback,
			minSegmentLen,
			calibration: calibrationPath,
			walkStrengthPThresholds: Object.fromEntries(
				Object.entries(SENSITIVITY_PRESETS).map(([key, value]) => [
					key,
					{ walkPStart: value.walkPStart, walkPFull: value.walkPFull }
				])
			)
		},
		runtime: {
			durationMs: ended - started,
			ticksPerSecond: options.ticks / ((ended - started) / 1000)
		},
		results
	};

	printSummary(report);
	if (options.out) {
		const outPath = resolve(options.out);
		mkdirSync(dirname(outPath), { recursive: true });
		writeFileSync(outPath, JSON.stringify(report, null, options.pretty ? 2 : 0) + '\n');
		console.log(`\nWrote ${outPath}`);
	}
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	console.error('\n' + usage());
	process.exit(1);
}
