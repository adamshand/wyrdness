#!/usr/bin/env node

import '../app/public/signal-core.js';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_WALK_CALIBRATION = 'tools/calibration/walk-distance-200bit-lookback120-1m.json';
const P_NULL_MIN_CHANNELS = 0.11;
const MIN_SUPPORTED_TAIL = 0.0001;
const core = globalThis.WyrdSignalCore;
const DEFAULT_QUANTILES = [
	0.00001, 0.00005, 0.0001, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05,
	0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.98, 0.99, 0.995, 0.998, 0.999, 0.9995,
	0.9999, 0.99995, 0.99999
];
const DEFAULT_TAIL_PROBABILITIES = [
	0.5, 0.25, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001, 0.0005, 0.0002,
	0.0001
];
const P_CHECK_THRESHOLDS = [0.5, 0.25, 0.1, 0.05, 0.02, 0.01, 0.005, 0.001];

function usage() {
	return (
		`Usage: node tools/calibrate-signal-stack.js [options]\n\n` +
		`Runs the runtime detector stack on independent synthetic A/B bit streams and\n` +
		`calibrates the final best-channel pMin statistic after adaptive start-point\n` +
		`search and min-across-channels selection. Walk close/separate p-values are\n` +
		`loaded from the existing walk-distance calibration JSON.\n\n` +
		`Options:\n` +
		`  --ticks <n>             Total ticks to simulate. Default: 100000\n` +
		`  --walk-calibration <p>  Walk calibration JSON. Default: ${DEFAULT_WALK_CALIBRATION}\n` +
		`  --sample-bits <n>       Bits per stream per tick. Default: from walk calibration\n` +
		`  --max-lookback <n>      Starting-point search depth. Default: from walk calibration\n` +
		`  --min-segment-len <n>   Minimum segment length. Default: from walk calibration\n` +
		`  --warmup <n>            Ticks to skip before recording. Default: max-lookback\n` +
		`  --chunk-bytes <n>       Random byte buffer refill size. Default: 1048576\n` +
		`  --out <path>            Optional JSON report path\n` +
		`  --pretty                Pretty-print JSON output\n` +
		`  --help                  Show this help\n\n` +
		`Examples:\n` +
		`  node tools/calibrate-signal-stack.js --ticks 100000\n` +
		`  node tools/calibrate-signal-stack.js --ticks 1000000 --out tools/calibration/signal-stack-200bit-lookback120-1m.json --pretty\n`
	);
}

function parseArgs(argv) {
	const options = {
		ticks: 100_000,
		walkCalibration: DEFAULT_WALK_CALIBRATION,
		sampleBits: null,
		maxLookback: null,
		minSegmentLen: null,
		warmup: null,
		chunkBytes: 1_048_576,
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
			case '--walk-calibration':
				options.walkCalibration = next();
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
			case '--chunk-bytes':
				options.chunkBytes = Number(next());
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

	for (const key of ['ticks', 'sampleBits', 'maxLookback', 'minSegmentLen', 'warmup', 'chunkBytes']) {
		if (options[key] != null) options[key] = Math.floor(options[key]);
	}
	if (!Number.isFinite(options.ticks) || options.ticks < 1) throw new Error('--ticks must be positive');
	if (!Number.isFinite(options.chunkBytes) || options.chunkBytes < 1)
		throw new Error('--chunk-bytes must be positive');
	return options;
}

class RandomByteStream {
	constructor(chunkBytes) {
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

function conservativeTailTable(rows) {
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

function empiricalTailP(value, table, mode) {
	return core.empiricalTailP(value, table, mode);
}

function quantile(sorted, q) {
	if (sorted.length === 0) return null;
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
	return sorted[idx];
}

function quantileTable(sorted, probabilities = DEFAULT_QUANTILES) {
	return probabilities.map((q) => [q, quantile(sorted, q)]);
}

function conservativeDuplicateThresholds(rows) {
	const byThreshold = new Map();
	for (const [p, threshold] of rows) {
		const previous = byThreshold.get(threshold);
		byThreshold.set(threshold, previous == null ? p : Math.max(previous, p));
	}
	return [...byThreshold.entries()]
		.map(([threshold, p]) => [p, threshold])
		.sort((a, b) => b[0] - a[0]);
}

function lowerTailThresholds(sortedAscending, tailProbabilities = DEFAULT_TAIL_PROBABILITIES) {
	return conservativeDuplicateThresholds(tailProbabilities.map((p) => [p, quantile(sortedAscending, p)]));
}

function upperTailThresholds(sortedAscending, tailProbabilities = DEFAULT_TAIL_PROBABILITIES) {
	return conservativeDuplicateThresholds(tailProbabilities.map((p) => [p, quantile(sortedAscending, 1 - p)]));
}

function observedRates(sortedAscending, thresholds) {
	const rates = {};
	for (const threshold of thresholds) {
		let hi = sortedAscending.length;
		let lo = 0;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (sortedAscending[mid] <= threshold) lo = mid + 1;
			else hi = mid;
		}
		rates[threshold] = lo / sortedAscending.length;
	}
	return rates;
}

function formatNumber(value, digits = 6) {
	return Number.isFinite(value) ? value.toFixed(digits) : String(value);
}

function printSummary(report) {
	const q = (table, p) => table.find(([x]) => x === p)?.[1];
	const pMin = report.signal.pMinRaw;
	console.log('\nSignal stack null calibration summary');
	console.log('-------------------------------------');
	console.log(`ticks:          ${report.params.ticks.toLocaleString()}`);
	console.log(`recorded:       ${report.params.recordedSamples.toLocaleString()}`);
	console.log(`sample bits:    ${report.params.sampleBits}`);
	console.log(`lookback:       ${report.params.maxLookback}`);
	console.log(`min segment:    ${report.params.minSegmentLen}`);
	console.log(`duration:       ${(report.runtime.durationMs / 1000).toFixed(2)}s`);
	console.log(`throughput:     ${Math.round(report.runtime.ticksPerSecond).toLocaleString()} ticks/s`);
	console.log('\nRuntime pMinRaw under null');
	console.log(
		`q50=${formatNumber(q(pMin.quantiles, 0.5))} q05=${formatNumber(q(pMin.quantiles, 0.05))} q01=${formatNumber(q(pMin.quantiles, 0.01))} q001=${formatNumber(q(pMin.quantiles, 0.001))}`
	);
	console.log('\nOld scalar pMin / 0.11 calibration check (observed <= threshold):');
	console.log(report.diagnostics.oldScalarPOverallObservedRates);
	console.log('\nUse signal.pMinRaw.lowerTailThresholds as FULL_STACK_PMIN_LOWER_TAIL.');
}

function main() {
	const options = parseArgs(process.argv);
	const walkCalibrationPath = resolve(options.walkCalibration);
	const walkCalibration = JSON.parse(readFileSync(walkCalibrationPath, 'utf8'));
	const sampleBits = Math.floor(options.sampleBits ?? walkCalibration.params.sampleBits);
	const maxLookback = Math.floor(options.maxLookback ?? walkCalibration.params.maxLookback);
	const minSegmentLen = Math.floor(options.minSegmentLen ?? walkCalibration.params.minSegmentLen);
	const warmup = Math.floor(options.warmup ?? maxLookback);
	if (options.ticks <= warmup) throw new Error('--ticks must be greater than warmup');
	if (minSegmentLen > maxLookback) throw new Error('--min-segment-len must be <= --max-lookback');

	if (
		sampleBits !== walkCalibration.params.sampleBits ||
		maxLookback !== walkCalibration.params.maxLookback ||
		minSegmentLen !== walkCalibration.params.minSegmentLen
	) {
		console.warn('Warning: runtime detector settings do not match the walk calibration table.');
	}

	const closeTable = conservativeTailTable(
		walkCalibration.walkDistance.closeRatio.lowerTailThresholds,
		'lower'
	);
	const separateTable = conservativeTailTable(
		walkCalibration.walkDistance.separateRatio.upperTailThresholds,
		'upper'
	);
	const recordedSamples = options.ticks - warmup;
	const corrHighZ = new Float64Array(recordedSamples);
	const corrLowZ = new Float64Array(recordedSamples);
	const antiAbZ = new Float64Array(recordedSamples);
	const antiBaZ = new Float64Array(recordedSamples);
	const pearsonAbsZ = new Float64Array(recordedSamples);
	const walkCloseP = new Float64Array(recordedSamples);
	const walkSeparateP = new Float64Array(recordedSamples);
	const pMinRaw = new Float64Array(recordedSamples);
	const oldScalarPOverall = new Float64Array(recordedSamples);

	let cumSumA = [0];
	let cumSumB = [0];
	let cumSumXY = [0];
	const maxStoredTicks = maxLookback + 20;
	const byteStream = new RandomByteStream(options.chunkBytes);
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
		const corr = core.findOptimalStartingPointCorrelated(
			cumSumA,
			cumSumB,
			currentIdx,
			sampleBits,
			maxLookback,
			minSegmentLen
		);
		const anti = core.findOptimalStartingPointAnti(
			cumSumA,
			cumSumB,
			currentIdx,
			sampleBits,
			maxLookback,
			minSegmentLen
		);
		const pearson = core.findOptimalStartingPointPearson(
			cumSumXY,
			cumSumA,
			cumSumB,
			currentIdx,
			sampleBits,
			maxLookback,
			minSegmentLen
		);
		const walk = core.walkDistanceScores(
			cumSumA,
			cumSumB,
			currentIdx,
			sampleBits,
			maxLookback,
			minSegmentLen,
			{ walkCloseLowerTail: closeTable, walkSeparateUpperTail: separateTable }
		);
		const pClose = walk.closeP;
		const pSeparate = walk.separateP;

		corrHighZ[recorded] = corr.highZ;
		corrLowZ[recorded] = corr.lowZ;
		antiAbZ[recorded] = anti.abZ;
		antiBaZ[recorded] = anti.baZ;
		pearsonAbsZ[recorded] = Math.abs(pearson.z);
		walkCloseP[recorded] = pClose;
		walkSeparateP[recorded] = pSeparate;
		recorded++;
	}

	const corrHighZSorted = Float64Array.from(corrHighZ).sort();
	const corrLowZSorted = Float64Array.from(corrLowZ).sort();
	const antiAbZSorted = Float64Array.from(antiAbZ).sort();
	const antiBaZSorted = Float64Array.from(antiBaZ).sort();
	const pearsonAbsZSorted = Float64Array.from(pearsonAbsZ).sort();

	const corrHighUpperTail = upperTailThresholds(corrHighZSorted);
	const corrLowUpperTail = upperTailThresholds(corrLowZSorted);
	const antiAbUpperTail = upperTailThresholds(antiAbZSorted);
	const antiBaUpperTail = upperTailThresholds(antiBaZSorted);
	const pearsonAbsUpperTail = upperTailThresholds(pearsonAbsZSorted);
	const corrHighTable = conservativeTailTable(corrHighUpperTail, 'upper');
	const corrLowTable = conservativeTailTable(corrLowUpperTail, 'upper');
	const antiAbTable = conservativeTailTable(antiAbUpperTail, 'upper');
	const antiBaTable = conservativeTailTable(antiBaUpperTail, 'upper');
	const pearsonTable = conservativeTailTable(pearsonAbsUpperTail, 'upper');

	for (let i = 0; i < recordedSamples; i++) {
		const pMin = Math.min(
			empiricalTailP(corrHighZ[i], corrHighTable, 'upper'),
			empiricalTailP(corrLowZ[i], corrLowTable, 'upper'),
			empiricalTailP(antiAbZ[i], antiAbTable, 'upper'),
			empiricalTailP(antiBaZ[i], antiBaTable, 'upper'),
			walkCloseP[i],
			walkSeparateP[i],
			empiricalTailP(pearsonAbsZ[i], pearsonTable, 'upper')
		);
		pMinRaw[i] = pMin;
		oldScalarPOverall[i] = Math.min(1, pMin / P_NULL_MIN_CHANNELS);
	}
	const pMinRawSorted = Float64Array.from(pMinRaw).sort();
	oldScalarPOverall.sort();

	const ended = performance.now();
	const report = {
		version: 1,
		kind: 'wyrdweb-signal-stack-null-calibration',
		createdAt: new Date().toISOString(),
		params: {
			ticks: options.ticks,
			warmupTicks: warmup,
			recordedSamples,
			sampleBits,
			maxLookback,
			minSegmentLen,
			minSupportedTail: MIN_SUPPORTED_TAIL,
			randomSource: 'node:crypto.randomBytes',
			walkCalibration: options.walkCalibration,
			search: 'runtime best-starting-point detectors, runtime pMinRaw min across corr/anti/walk/Pearson channels',
			pMinRawDefinition:
				'min(empiricalUpperTailP(corrHighZ), empiricalUpperTailP(corrLowZ), empiricalUpperTailP(antiAbZ), empiricalUpperTailP(antiBaZ), walkCloseP, walkSeparateP, empiricalUpperTailP(abs(pearsonZ)))'
		},
		runtime: {
			durationMs: ended - started,
			ticksPerSecond: options.ticks / ((ended - started) / 1000),
			recordedSamplesPerSecond: recordedSamples / ((ended - started) / 1000)
		},
		signal: {
			corrHighZ: {
				meaning: 'higher is more parallel/high after adaptive start search',
				quantiles: quantileTable(corrHighZSorted),
				upperTailThresholds: corrHighUpperTail
			},
			corrLowZ: {
				meaning: 'higher is more parallel/low after adaptive start search',
				quantiles: quantileTable(corrLowZSorted),
				upperTailThresholds: corrLowUpperTail
			},
			antiAbZ: {
				meaning: 'higher is more antiparallel A-high/B-low after adaptive start search',
				quantiles: quantileTable(antiAbZSorted),
				upperTailThresholds: antiAbUpperTail
			},
			antiBaZ: {
				meaning: 'higher is more antiparallel B-high/A-low after adaptive start search',
				quantiles: quantileTable(antiBaZSorted),
				upperTailThresholds: antiBaUpperTail
			},
			pearsonAbsZ: {
				meaning: 'absolute selected Fisher-z score after adaptive start search',
				quantiles: quantileTable(pearsonAbsZSorted),
				upperTailThresholds: pearsonAbsUpperTail
			},
			pMinRaw: {
				meaning: 'lower is more unusual for the exact runtime min-across-channels statistic',
				quantiles: quantileTable(pMinRawSorted),
				lowerTailThresholds: lowerTailThresholds(pMinRawSorted)
			}
		},
		diagnostics: {
			oldScalar: {
				pNullMinChannels: P_NULL_MIN_CHANNELS,
				definition: 'Math.min(1, pMinRaw / P_NULL_MIN_CHANNELS)'
			},
			oldScalarPOverallObservedRates: observedRates(oldScalarPOverall, P_CHECK_THRESHOLDS)
		}
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
