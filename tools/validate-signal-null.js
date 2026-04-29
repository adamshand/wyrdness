#!/usr/bin/env node

import '../app/public/signal-core.js';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_CALIBRATION = 'tools/calibration/walk-distance-200bit-lookback120-1m.json';
const DEFAULT_STACK_CALIBRATION = 'tools/calibration/signal-stack-200bit-lookback120-1m.json';
const P_NULL_MIN_CHANNELS = 0.11;
const MIN_SUPPORTED_TAIL = 0.0001;
const core = globalThis.WyrdSignalCore;
const P_CHECK_THRESHOLDS = [0.5, 0.25, 0.1, 0.05, 0.02, 0.01, 0.005, 0.001];
const CHANNELS = ['baseline', 'parallel', 'antiparallel', 'stick_together', 'pearson'];
const SENSITIVITY_PRESETS = {
	conservative: {
		legacyZStart: 2.4,
		legacyZFull: 3.5,
		legacyStickZStart: 3.4,
		legacyStickZFull: 4.5,
		legacyPearsonRStart: 0.25,
		legacyPearsonRFull: 0.5,
		dominanceThreshold: 0.12,
		channelPStart: 0.005,
		channelPFull: 0.0001
	},
	moderate: {
		legacyZStart: 2.0,
		legacyZFull: 3.2,
		legacyStickZStart: 2.9,
		legacyStickZFull: 4.0,
		legacyPearsonRStart: 0.2,
		legacyPearsonRFull: 0.45,
		dominanceThreshold: 0.12,
		channelPStart: 0.02,
		channelPFull: 0.0003
	},
	engaging: {
		legacyZStart: 1.7,
		legacyZFull: 3.0,
		legacyStickZStart: 2.6,
		legacyStickZFull: 3.8,
		legacyPearsonRStart: 0.16,
		legacyPearsonRFull: 0.4,
		dominanceThreshold: 0.1,
		channelPStart: 0.05,
		channelPFull: 0.001
	}
};

function usage() {
	return (
		`Usage: node tools/validate-signal-null.js [options]\n\n` +
		`Runs a synthetic null validation of the full detector stack. It compares\n` +
		`the legacy uncalibrated visual wiring against the calibrated runtime stack\n` +
		`using walk and full-stack/channel calibration JSON files.\n\n` +
		`Options:\n` +
		`  --ticks <n>             Total ticks to simulate. Default: 100000\n` +
		`  --calibration <path>    Walk calibration JSON. Default: ${DEFAULT_CALIBRATION}\n` +
		`  --stack-calibration <p> Full-stack pMin calibration JSON. Default: ${DEFAULT_STACK_CALIBRATION}\n` +
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
		stackCalibration: DEFAULT_STACK_CALIBRATION,
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
			case '--stack-calibration':
				options.stackCalibration = next();
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

	for (let i = 0; i < sampleBits; i++) {
		const pairBit = i * 2;
		const a = bitAt(buffer, baseByte * 8 + pairBit);
		const b = bitAt(buffer, baseByte * 8 + pairBit + 1);
		const x = a === 1 ? 1 : -1;
		const y = b === 1 ? 1 : -1;
		sumX += x;
		sumY += y;
		sumXY += x * y;
	}

	return { sumX, sumY, sumXY };
}

function clamp01(v) {
	return Math.min(1, Math.max(0, v));
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

function prepareTailTable(rows) {
	const byThreshold = new Map();
	for (const [p, threshold] of rows) {
		if (!Number.isFinite(p) || !Number.isFinite(threshold) || p < MIN_SUPPORTED_TAIL) continue;
		const previous = byThreshold.get(threshold);
		byThreshold.set(threshold, previous == null ? p : Math.max(previous, p));
	}
	return [...byThreshold.entries()]
		.map(([threshold, p]) => [p, threshold])
		.sort((a, b) => a[1] - b[1]);
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

function observedRates(values, thresholds) {
	const rates = {};
	for (const threshold of thresholds) {
		let count = 0;
		for (const value of values) if (value <= threshold) count++;
		rates[threshold] = values.length > 0 ? count / values.length : 0;
	}
	return rates;
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
		console.log('  calibrated runtime dominance:  ', row.calibratedRuntime.percent);
		console.log('  calibrated pMin q50/q05/q01:   ', {
			q50: row.calibratedRuntime.pMinQuantiles.find(([p]) => p === 0.5)?.[1],
			q05: row.calibratedRuntime.pMinQuantiles.find(([p]) => p === 0.05)?.[1],
			q01: row.calibratedRuntime.pMinQuantiles.find(([p]) => p === 0.01)?.[1]
		});
		console.log('  full-stack p overall observed: ', row.calibratedRuntime.pOverallObservedRates);
	}
}

function main() {
	const options = parseArgs(process.argv);
	const calibrationPath = resolve(options.calibration);
	const calibration = JSON.parse(readFileSync(calibrationPath, 'utf8'));
	const stackCalibrationPath = resolve(options.stackCalibration);
	const stackCalibration = JSON.parse(readFileSync(stackCalibrationPath, 'utf8'));
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
		console.warn('Warning: runtime detector settings do not match the walk calibration table.');
	}
	if (
		sampleBits !== stackCalibration.params.sampleBits ||
		maxLookback !== stackCalibration.params.maxLookback ||
		minSegmentLen !== stackCalibration.params.minSegmentLen
	) {
		console.warn('Warning: runtime detector settings do not match the full-stack calibration table.');
	}

	const closeTable = prepareTailTable(
		calibration.walkDistance.closeRatio.lowerTailThresholds,
		'lower'
	);
	const separateTable = prepareTailTable(
		calibration.walkDistance.separateRatio.upperTailThresholds,
		'upper'
	);
	const corrHighTable = prepareTailTable(stackCalibration.signal.corrHighZ.upperTailThresholds, 'upper');
	const corrLowTable = prepareTailTable(stackCalibration.signal.corrLowZ.upperTailThresholds, 'upper');
	const antiAbTable = prepareTailTable(stackCalibration.signal.antiAbZ.upperTailThresholds, 'upper');
	const antiBaTable = prepareTailTable(stackCalibration.signal.antiBaZ.upperTailThresholds, 'upper');
	const pearsonTable = prepareTailTable(stackCalibration.signal.pearsonAbsZ.upperTailThresholds, 'upper');
	const pMinTable = prepareTailTable(stackCalibration.signal.pMinRaw.lowerTailThresholds, 'lower');
	const runtimeCalibration = {
		walkCloseLowerTail: closeTable,
		walkSeparateUpperTail: separateTable,
		corrHighUpperTail: corrHighTable,
		corrLowUpperTail: corrLowTable,
		antiAbUpperTail: antiAbTable,
		antiBaUpperTail: antiBaTable,
		pearsonAbsUpperTail: pearsonTable,
		fullStackPMinLowerTail: pMinTable
	};
	const recordedSamples = options.ticks - warmup;
	const stateBySensitivity = Object.fromEntries(
		Object.keys(SENSITIVITY_PRESETS).map((sensitivity) => [
			sensitivity,
			{
				currentCounts: zeroCounts(),
				calibratedCounts: zeroCounts(),
				pMin: new Float64Array(recordedSamples),
				oldScalarPOverall: new Float64Array(recordedSamples),
				pOverall: new Float64Array(recordedSamples)
			}
		])
	);

	let cumSumA = [0];
	let cumSumB = [0];
	let cumSumXY = [0];
	const maxStoredTicks = maxLookback + 20;
	const byteStream = new RandomByteStream();
	const started = performance.now();
	let recorded = 0;

	for (let tick = 1; tick <= options.ticks; tick++) {
		const sample = sampleTick(byteStream, sampleBits);
		cumSumA.push((cumSumA[cumSumA.length - 1] ?? 0) + sample.sumX);
		cumSumB.push((cumSumB[cumSumB.length - 1] ?? 0) + sample.sumY);
		cumSumXY.push((cumSumXY[cumSumXY.length - 1] ?? 0) + sample.sumXY);
		if (cumSumA.length > maxStoredTicks) {
			cumSumA = cumSumA.slice(-maxStoredTicks);
			cumSumB = cumSumB.slice(-maxStoredTicks);
			cumSumXY = cumSumXY.slice(-maxStoredTicks);
		}
		if (tick <= warmup) continue;

		const currentIdx = cumSumA.length - 1;
		const signal = core.computeRuntimeSignal(
			cumSumA,
			cumSumB,
			cumSumXY,
			currentIdx,
			sampleBits,
			maxLookback,
			minSegmentLen,
			runtimeCalibration
		);
		const corr = signal.corr;
		const anti = signal.anti;
		const pearson = signal.pearson;
		const walk = signal.walk;
		const pClose = signal.p.stick;
		const pSeparate = signal.p.walkSeparate;
		const pCorrHigh = signal.p.corrHigh;
		const pCorrLow = signal.p.corrLow;
		const pAntiAb = signal.p.antiAb;
		const pAntiBa = signal.p.antiBa;
		const pPearson = signal.p.pearson;

		for (const [sensitivity, preset] of Object.entries(SENSITIVITY_PRESETS)) {
			const currentVisual = {
				parallel: Math.max(
					strengthFromZ(corr.highZ, preset.legacyZStart, preset.legacyZFull),
					strengthFromZ(corr.lowZ, preset.legacyZStart, preset.legacyZFull)
				),
				antiparallel: Math.max(
					strengthFromZ(anti.abZ, preset.legacyZStart, preset.legacyZFull),
					strengthFromZ(anti.baZ, preset.legacyZStart, preset.legacyZFull),
					strengthFromZ(walk.separateLegacyZ, preset.legacyStickZStart, preset.legacyStickZFull)
				),
				stick_together: strengthFromZ(walk.closeLegacyZ, preset.legacyStickZStart, preset.legacyStickZFull),
				pearson: clamp01(
					(Math.abs(pearson.r) - preset.legacyPearsonRStart) /
						(preset.legacyPearsonRFull - preset.legacyPearsonRStart)
				)
			};

			const calibratedVisual = {
				parallel: Math.max(
					strengthFromP(pCorrHigh, preset.channelPStart, preset.channelPFull),
					strengthFromP(pCorrLow, preset.channelPStart, preset.channelPFull)
				),
				antiparallel: Math.max(
					strengthFromP(pAntiAb, preset.channelPStart, preset.channelPFull),
					strengthFromP(pAntiBa, preset.channelPStart, preset.channelPFull),
					strengthFromP(pSeparate, preset.channelPStart, preset.channelPFull)
				),
				stick_together: strengthFromP(pClose, preset.channelPStart, preset.channelPFull),
				pearson: strengthFromP(pPearson, preset.channelPStart, preset.channelPFull)
			};

			const bucket = stateBySensitivity[sensitivity];
			bucket.currentCounts[chooseDominant(currentVisual, preset.dominanceThreshold)]++;
			bucket.calibratedCounts[chooseDominant(calibratedVisual, preset.dominanceThreshold)]++;

			const pMinRuntime = signal.pMinRaw;
			bucket.pMin[recorded] = pMinRuntime;
			bucket.oldScalarPOverall[recorded] = Math.min(1, pMinRuntime / P_NULL_MIN_CHANNELS);
			bucket.pOverall[recorded] = signal.pOverallCalibrated;
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
			calibratedRuntime: {
				counts: bucket.calibratedCounts,
				percent: countsToPercent(bucket.calibratedCounts, recordedSamples),
				pMinQuantiles: quantileTable(bucket.pMin),
				oldScalarPOverallObservedRates: observedRates(bucket.oldScalarPOverall, P_CHECK_THRESHOLDS),
				pOverallObservedRates: observedRates(bucket.pOverall, P_CHECK_THRESHOLDS)
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
			calibration: options.calibration,
			stackCalibration: options.stackCalibration,
			channelStrengthPThresholds: Object.fromEntries(
				Object.entries(SENSITIVITY_PRESETS).map(([key, value]) => [
					key,
					{ channelPStart: value.channelPStart, channelPFull: value.channelPFull }
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
