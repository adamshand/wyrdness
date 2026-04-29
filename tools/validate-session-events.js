#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_WALK_CALIBRATION = 'tools/calibration/walk-distance-200bit-lookback120-1m.json';
const DEFAULT_STACK_CALIBRATION = 'tools/calibration/signal-stack-200bit-lookback120-1m.json';
const VISUAL_CHANNELS = ['baseline', 'parallel', 'antiparallel', 'stick_together', 'pearson'];
const MODE_PRESETS = {
	wow: {
		sigEnergyRiseMs: 1000,
		sigEnergyFallMs: 2000,
		switchMargin: 0.06,
		keepBonus: 0.03
	},
	mellow: {
		sigEnergyRiseMs: 2000,
		sigEnergyFallMs: 3600,
		switchMargin: 0.12,
		keepBonus: 0.06
	}
};
const SENSITIVITY_PRESETS = {
	conservative: {
		dominanceThreshold: 0.12,
		channelPStart: 0.005,
		channelPFull: 0.0001
	},
	moderate: {
		dominanceThreshold: 0.12,
		channelPStart: 0.02,
		channelPFull: 0.0003
	},
	engaging: {
		dominanceThreshold: 0.1,
		channelPStart: 0.05,
		channelPFull: 0.001
	}
};
const COHERENCE_FLOOR = 0.35;
const STAGE_1_THRESHOLD = 0.18;
const STAGE_2_THRESHOLD = 0.52;
const STAGE_3_THRESHOLD = 0.72;
const SIG_PULSE_COOLDOWN_MS = 3000;
const DEFAULT_UPDATES_PER_SEC = 1;

function usage() {
	return (
		`Usage: node tools/validate-session-events.js [options]\n\n` +
		`Simulates null sessions with the calibrated runtime detector stack and\n` +
		`reports session-level visual event rates: stage occupancy, stage hits,\n` +
		`pulse/ring frequency, and dominant-colour occupancy.\n\n` +
		`Options:\n` +
		`  --sessions <n>          Number of independent sessions. Default: 1000\n` +
		`  --minutes <n>           Session length in minutes. Default: 10\n` +
		`  --walk-calibration <p>  Walk calibration JSON. Default: ${DEFAULT_WALK_CALIBRATION}\n` +
		`  --stack-calibration <p> Full-stack/channel calibration JSON. Default: ${DEFAULT_STACK_CALIBRATION}\n` +
		`  --sample-bits <n>       Bits per stream per tick. Default: from calibration\n` +
		`  --max-lookback <n>      Starting-point search depth. Default: from calibration\n` +
		`  --min-segment-len <n>   Minimum segment length. Default: from calibration\n` +
		`  --prewarm <n>           Detector-only warmup ticks per session. Default: max-lookback\n` +
		`  --updates-per-sec <n>   Signal ticks per second. Default: ${DEFAULT_UPDATES_PER_SEC}\n` +
		`  --boot-seconds <n>      Browser boot/ignition seconds with no signal ticks. Default: 5\n` +
		`  --stage-1 <n>           Stage 1 sig threshold. Default: ${STAGE_1_THRESHOLD}\n` +
		`  --stage-2 <n>           Stage 2 sig threshold. Default: ${STAGE_2_THRESHOLD}\n` +
		`  --stage-3 <n>           Stage 3/pulse sig threshold. Default: ${STAGE_3_THRESHOLD}\n` +
		`  --chunk-bytes <n>       Random byte buffer refill size. Default: 1048576\n` +
		`  --out <path>            Optional JSON report path\n` +
		`  --pretty                Pretty-print JSON output\n` +
		`  --help                  Show this help\n\n` +
		`Examples:\n` +
		`  node tools/validate-session-events.js --sessions 1000 --minutes 10 --out tools/calibration/session-events-10m-1000.json --pretty\n` +
		`  node tools/validate-session-events.js --sessions 200 --minutes 60 --out tools/calibration/session-events-60m-200.json --pretty\n`
	);
}

function parseArgs(argv) {
	const options = {
		sessions: 1000,
		minutes: 10,
		walkCalibration: DEFAULT_WALK_CALIBRATION,
		stackCalibration: DEFAULT_STACK_CALIBRATION,
		sampleBits: null,
		maxLookback: null,
		minSegmentLen: null,
		prewarm: null,
		updatesPerSec: DEFAULT_UPDATES_PER_SEC,
		bootSeconds: 5,
		stage1: STAGE_1_THRESHOLD,
		stage2: STAGE_2_THRESHOLD,
		stage3: STAGE_3_THRESHOLD,
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
			case '--sessions':
				options.sessions = Number(next());
				break;
			case '--minutes':
				options.minutes = Number(next());
				break;
			case '--walk-calibration':
				options.walkCalibration = next();
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
			case '--prewarm':
				options.prewarm = Number(next());
				break;
			case '--updates-per-sec':
				options.updatesPerSec = Number(next());
				break;
			case '--boot-seconds':
				options.bootSeconds = Number(next());
				break;
			case '--stage-1':
				options.stage1 = Number(next());
				break;
			case '--stage-2':
				options.stage2 = Number(next());
				break;
			case '--stage-3':
				options.stage3 = Number(next());
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

	options.sessions = Math.floor(options.sessions);
	options.sampleBits = options.sampleBits == null ? null : Math.floor(options.sampleBits);
	options.maxLookback = options.maxLookback == null ? null : Math.floor(options.maxLookback);
	options.minSegmentLen = options.minSegmentLen == null ? null : Math.floor(options.minSegmentLen);
	options.prewarm = options.prewarm == null ? null : Math.floor(options.prewarm);
	options.chunkBytes = Math.floor(options.chunkBytes);

	if (!Number.isFinite(options.sessions) || options.sessions < 1) throw new Error('--sessions must be positive');
	if (!Number.isFinite(options.minutes) || options.minutes <= 0) throw new Error('--minutes must be positive');
	if (!Number.isFinite(options.updatesPerSec) || options.updatesPerSec <= 0)
		throw new Error('--updates-per-sec must be positive');
	if (!Number.isFinite(options.bootSeconds) || options.bootSeconds < 0) throw new Error('--boot-seconds must be non-negative');
	if (![options.stage1, options.stage2, options.stage3].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
		throw new Error('--stage-1/2/3 must be finite values in [0, 1]');
	}
	if (!(options.stage1 <= options.stage2 && options.stage2 <= options.stage3)) {
		throw new Error('--stage-1 must be <= --stage-2, and --stage-2 must be <= --stage-3');
	}
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

function clamp01(v) {
	return Math.min(1, Math.max(0, v));
}

function smoothValue(current, target, k) {
	return current + (target - current) * k;
}

function strengthFromP(p, pStart, pFull) {
	const safeP = Math.max(1e-12, Math.min(1, p));
	const start = -Math.log10(pStart);
	const full = -Math.log10(pFull);
	const value = -Math.log10(safeP);
	return clamp01((value - start) / (full - start));
}

function stageFromSig(sig, thresholds) {
	if (sig >= thresholds.stage3) return 3;
	if (sig >= thresholds.stage2) return 2;
	if (sig >= thresholds.stage1) return 1;
	return 0;
}

function findOptimalStartingPointCorrelated(cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen) {
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

function findOptimalStartingPointPearson(cumSumXY, cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen) {
	let bestZ = 0;
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
		if (Math.abs(z) > Math.abs(bestZ)) bestZ = z;
	}
	return { z: bestZ };
}

function walkDistanceScores(cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen) {
	let closeRatio = Number.POSITIVE_INFINITY;
	let separateRatio = Number.NEGATIVE_INFINITY;
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
		const ratio = sumDistance / tickSpan / Math.max(1e-12, expectedSumDistance / tickSpan);
		if (ratio < closeRatio) closeRatio = ratio;
		if (ratio > separateRatio) separateRatio = ratio;
	}
	return foundCandidate ? { closeRatio, separateRatio } : { closeRatio: 1, separateRatio: 1 };
}

function prepareTailTable(rows) {
	const byThreshold = new Map();
	for (const [p, threshold] of rows) {
		if (!Number.isFinite(p) || !Number.isFinite(threshold) || p <= 0) continue;
		const previous = byThreshold.get(threshold);
		byThreshold.set(threshold, previous == null ? p : Math.max(previous, p));
	}
	return [...byThreshold.entries()]
		.map(([threshold, p]) => ({ p, threshold }))
		.sort((a, b) => a.threshold - b.threshold);
}

function interpolateLogP(p1, x1, p2, x2, x) {
	if (x1 === x2) return Math.max(p1, p2);
	const t = Math.max(0, Math.min(1, (x - x1) / (x2 - x1)));
	return Math.exp(Math.log(p1) + (Math.log(p2) - Math.log(p1)) * t);
}

function empiricalTailP(value, table, mode) {
	if (!Number.isFinite(value) || table.length === 0) return 1;
	if (mode === 'lower') {
		if (value <= table[0].threshold) return table[0].p;
		if (value >= table[table.length - 1].threshold) return 1;
	} else {
		if (value <= table[0].threshold) return 1;
		if (value >= table[table.length - 1].threshold) return table[table.length - 1].p;
	}
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
	return Object.fromEntries(VISUAL_CHANNELS.map((channel) => [channel, 0]));
}

function updateDominantState(state, visual, dtMs, sensitivityPreset, modePreset) {
	let best = null;
	let bestV = 0;
	for (const channel of VISUAL_CHANNELS) {
		if (channel === 'baseline') continue;
		const value = visual[channel] ?? 0;
		if (value > bestV) {
			bestV = value;
			best = channel;
		}
	}

	const next = bestV > sensitivityPreset.dominanceThreshold && best ? best : 'baseline';
	const nextStrength = next === 'baseline' ? 0 : bestV;
	let currentStrength = 0;
	if (state.dominant !== 'baseline') currentStrength = visual[state.dominant] ?? 0;
	currentStrength += modePreset.keepBonus;
	const shouldSwitch =
		state.dominant === 'baseline'
			? next !== 'baseline'
			: nextStrength > currentStrength + modePreset.switchMargin;
	const target = next === 'baseline' ? 0 : nextStrength;
	const tau = target > state.dominance ? 1200 : 1800;
	state.dominance = smoothValue(state.dominance, target, 1 - Math.exp(-dtMs / tau));
	if (shouldSwitch) state.dominant = next;
	if (next === 'baseline' && state.dominance < 0.05) state.dominant = 'baseline';
}

function quantileSorted(sorted, q) {
	if (sorted.length === 0) return null;
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
	return sorted[idx];
}

function sortedStats(values, secondsPerSession = null) {
	const sorted = [...values].sort((a, b) => a - b);
	const total = values.reduce((a, b) => a + b, 0);
	const out = {
		mean: total / values.length,
		q50: quantileSorted(sorted, 0.5),
		q90: quantileSorted(sorted, 0.9),
		q95: quantileSorted(sorted, 0.95),
		q99: quantileSorted(sorted, 0.99),
		max: sorted[sorted.length - 1]
	};
	if (secondsPerSession != null) out.meanFraction = out.mean / secondsPerSession;
	return out;
}

function summarizeHit(values) {
	const count = values.filter(Boolean).length;
	return { sessions: count, fraction: count / values.length };
}

function printSummary(report) {
	console.log('\nSession event null validation summary');
	console.log('-------------------------------------');
	console.log(`sessions:      ${report.params.sessions.toLocaleString()}`);
	console.log(`minutes:       ${report.params.minutes}`);
	console.log(`ticks/session: ${report.params.sessionTicks}`);
	console.log(`duration:      ${(report.runtime.durationMs / 1000).toFixed(2)}s`);
	for (const [mode, row] of Object.entries(report.results.modes)) {
		console.log(`\n${mode}`);
		console.log('  stage hit rates:', {
			stage1: row.stageHitRates.stage1.fraction,
			stage2: row.stageHitRates.stage2.fraction,
			stage3: row.stageHitRates.stage3.fraction
		});
		console.log('  pulses:', row.pulsesPerSession);
		console.log('  mean stage occupancy:', {
			stage1Plus: row.stageSeconds.stage1Plus.meanFraction,
			stage2Plus: row.stageSeconds.stage2Plus.meanFraction,
			stage3: row.stageSeconds.stage3.meanFraction
		});
	}
}

function main() {
	const options = parseArgs(process.argv);
	const walkCalibration = JSON.parse(readFileSync(resolve(options.walkCalibration), 'utf8'));
	const stackCalibration = JSON.parse(readFileSync(resolve(options.stackCalibration), 'utf8'));
	const sampleBits = Math.floor(options.sampleBits ?? walkCalibration.params.sampleBits);
	const maxLookback = Math.floor(options.maxLookback ?? walkCalibration.params.maxLookback);
	const minSegmentLen = Math.floor(options.minSegmentLen ?? walkCalibration.params.minSegmentLen);
	const prewarmTicks = Math.floor(options.prewarm ?? maxLookback);
	const sessionTicks = Math.floor(options.minutes * 60 * options.updatesPerSec);
	const bootTicks = Math.min(sessionTicks, Math.floor(options.bootSeconds * options.updatesPerSec));
	const dtMs = 1000 / options.updatesPerSec;
	const stageThresholds = { stage1: options.stage1, stage2: options.stage2, stage3: options.stage3 };
	if (sessionTicks < 1) throw new Error('Session length is shorter than one signal tick');

	if (
		sampleBits !== stackCalibration.params.sampleBits ||
		maxLookback !== stackCalibration.params.maxLookback ||
		minSegmentLen !== stackCalibration.params.minSegmentLen
	) {
		console.warn('Warning: runtime detector settings do not match the full-stack calibration table.');
	}

	const tables = {
		close: prepareTailTable(walkCalibration.walkDistance.closeRatio.lowerTailThresholds),
		separate: prepareTailTable(walkCalibration.walkDistance.separateRatio.upperTailThresholds),
		corrHigh: prepareTailTable(stackCalibration.signal.corrHighZ.upperTailThresholds),
		corrLow: prepareTailTable(stackCalibration.signal.corrLowZ.upperTailThresholds),
		antiAb: prepareTailTable(stackCalibration.signal.antiAbZ.upperTailThresholds),
		antiBa: prepareTailTable(stackCalibration.signal.antiBaZ.upperTailThresholds),
		pearson: prepareTailTable(stackCalibration.signal.pearsonAbsZ.upperTailThresholds),
		pMin: prepareTailTable(stackCalibration.signal.pMinRaw.lowerTailThresholds)
	};

	const modeState = Object.fromEntries(
		Object.keys(MODE_PRESETS).map((mode) => [
			mode,
			{
				pulses: [],
				maxStage: [],
				maxSig: [],
				stage1PlusSeconds: [],
				stage2PlusSeconds: [],
				stage3Seconds: []
			}
		])
	);
	const dominanceState = Object.fromEntries(
		Object.keys(SENSITIVITY_PRESETS).map((sensitivity) => [
			sensitivity,
			{
				counts: zeroCounts(),
				sessionHits: Object.fromEntries(VISUAL_CHANNELS.map((channel) => [channel, 0]))
			}
		])
	);

	const byteStream = new RandomByteStream(options.chunkBytes);
	const maxStoredTicks = maxLookback + 20;
	const started = performance.now();

	for (let session = 0; session < options.sessions; session++) {
		let cumSumA = [0];
		let cumSumB = [0];
		let cumSumXY = [0];

		const appendSample = () => {
			const sample = sampleTick(byteStream, sampleBits);
			cumSumA.push((cumSumA[cumSumA.length - 1] ?? 0) + sample.sumX);
			cumSumB.push((cumSumB[cumSumB.length - 1] ?? 0) + sample.sumY);
			cumSumXY.push((cumSumXY[cumSumXY.length - 1] ?? 0) + sample.sumXY);
			if (cumSumA.length > maxStoredTicks) {
				cumSumA = cumSumA.slice(-maxStoredTicks);
				cumSumB = cumSumB.slice(-maxStoredTicks);
				cumSumXY = cumSumXY.slice(-maxStoredTicks);
			}
		};

		for (let i = 0; i < prewarmTicks; i++) appendSample();

		const modes = Object.fromEntries(
			Object.entries(MODE_PRESETS).map(([mode, preset]) => [
				mode,
				{
					preset,
					sigEnergy: 0,
					sigEnergyRender: 0,
					sigWasAbove: false,
					pulseLastMs: -Infinity,
					pulses: 0,
					maxStage: 0,
					maxSig: 0,
					stage1PlusSeconds: 0,
					stage2PlusSeconds: 0,
					stage3Seconds: 0
				}
			])
		);
		const sensitivities = Object.fromEntries(
			Object.entries(SENSITIVITY_PRESETS).map(([sensitivity, preset]) => [
				sensitivity,
				{
					preset,
					dominant: 'baseline',
					dominance: 0,
					seen: Object.fromEntries(VISUAL_CHANNELS.map((channel) => [channel, false]))
				}
			])
		);

		for (let tick = 0; tick < sessionTicks; tick++) {
			if (tick < bootTicks) {
				for (const [sensitivity, state] of Object.entries(sensitivities)) {
					dominanceState[sensitivity].counts.baseline++;
					state.seen.baseline = true;
				}
				continue;
			}

			appendSample();
			const currentIdx = cumSumA.length - 1;
			const corr = findOptimalStartingPointCorrelated(cumSumA, cumSumB, currentIdx, sampleBits, maxLookback, minSegmentLen);
			const anti = findOptimalStartingPointAnti(cumSumA, cumSumB, currentIdx, sampleBits, maxLookback, minSegmentLen);
			const pearson = findOptimalStartingPointPearson(cumSumXY, cumSumA, cumSumB, currentIdx, sampleBits, maxLookback, minSegmentLen);
			const walk = walkDistanceScores(cumSumA, cumSumB, currentIdx, sampleBits, maxLookback, minSegmentLen);

			const pCorrHigh = empiricalTailP(corr.highZ, tables.corrHigh, 'upper');
			const pCorrLow = empiricalTailP(corr.lowZ, tables.corrLow, 'upper');
			const pAntiAb = empiricalTailP(anti.abZ, tables.antiAb, 'upper');
			const pAntiBa = empiricalTailP(anti.baZ, tables.antiBa, 'upper');
			const pClose = empiricalTailP(walk.closeRatio, tables.close, 'lower');
			const pSeparate = empiricalTailP(walk.separateRatio, tables.separate, 'upper');
			const pPearson = empiricalTailP(Math.abs(pearson.z), tables.pearson, 'upper');
			const pMinRaw = Math.min(pCorrHigh, pCorrLow, pAntiAb, pAntiBa, pClose, pSeparate, pPearson);
			const pOverallCalibrated = empiricalTailP(pMinRaw, tables.pMin, 'lower');
			const pOverallDisplay = Math.min(COHERENCE_FLOOR, pOverallCalibrated);
			const surprisal = Math.min(6, -Math.log10(pOverallDisplay));
			const targetSig = clamp01((surprisal - 0.3) / 5.0);
			const nowMs = tick * dtMs;

			for (const mode of Object.values(modes)) {
				const tau = targetSig > mode.sigEnergy ? mode.preset.sigEnergyRiseMs : mode.preset.sigEnergyFallMs;
				mode.sigEnergy = smoothValue(mode.sigEnergy, targetSig, 1 - Math.exp(-dtMs / tau));
				mode.sigEnergyRender = smoothValue(mode.sigEnergyRender, mode.sigEnergy, 1 - Math.exp(-dtMs / 600));
				mode.maxSig = Math.max(mode.maxSig, mode.sigEnergyRender);
				const stage = stageFromSig(mode.sigEnergyRender, stageThresholds);
				mode.maxStage = Math.max(mode.maxStage, stage);
				if (stage >= 1) mode.stage1PlusSeconds += dtMs / 1000;
				if (stage >= 2) mode.stage2PlusSeconds += dtMs / 1000;
				if (stage >= 3) mode.stage3Seconds += dtMs / 1000;

				const isAbove = mode.sigEnergyRender >= stageThresholds.stage3;
				const cooledDown = nowMs - mode.pulseLastMs >= SIG_PULSE_COOLDOWN_MS;
				if (isAbove && !mode.sigWasAbove && cooledDown) {
					mode.pulses++;
					mode.pulseLastMs = nowMs;
				}
				mode.sigWasAbove = isAbove;
			}

			for (const [sensitivity, state] of Object.entries(sensitivities)) {
				const preset = state.preset;
				const raw = {
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
				updateDominantState(state, raw, dtMs, preset, MODE_PRESETS.mellow);
				dominanceState[sensitivity].counts[state.dominant]++;
				state.seen[state.dominant] = true;
			}
		}

		for (const [modeName, mode] of Object.entries(modes)) {
			const bucket = modeState[modeName];
			bucket.pulses.push(mode.pulses);
			bucket.maxStage.push(mode.maxStage);
			bucket.maxSig.push(mode.maxSig);
			bucket.stage1PlusSeconds.push(mode.stage1PlusSeconds);
			bucket.stage2PlusSeconds.push(mode.stage2PlusSeconds);
			bucket.stage3Seconds.push(mode.stage3Seconds);
		}
		for (const [sensitivity, state] of Object.entries(sensitivities)) {
			for (const [channel, seen] of Object.entries(state.seen)) {
				if (seen) dominanceState[sensitivity].sessionHits[channel]++;
			}
		}
	}

	const ended = performance.now();
	const secondsPerSession = sessionTicks / options.updatesPerSec;
	const results = {
		modes: Object.fromEntries(
			Object.entries(modeState).map(([mode, bucket]) => [
				mode,
				{
					stageHitRates: {
						stage1: summarizeHit(bucket.maxStage.map((stage) => stage >= 1)),
						stage2: summarizeHit(bucket.maxStage.map((stage) => stage >= 2)),
						stage3: summarizeHit(bucket.maxStage.map((stage) => stage >= 3))
					},
					pulsesPerSession: sortedStats(bucket.pulses),
					pulsesPerHourMean: (bucket.pulses.reduce((a, b) => a + b, 0) / options.sessions) * (3600 / secondsPerSession),
					maxSigEnergyRender: sortedStats(bucket.maxSig),
					stageSeconds: {
						stage1Plus: sortedStats(bucket.stage1PlusSeconds, secondsPerSession),
						stage2Plus: sortedStats(bucket.stage2PlusSeconds, secondsPerSession),
						stage3: sortedStats(bucket.stage3Seconds, secondsPerSession)
					}
				}
			])
		),
		dominance: Object.fromEntries(
			Object.entries(dominanceState).map(([sensitivity, bucket]) => [
				sensitivity,
				{
					occupancy: Object.fromEntries(
						Object.entries(bucket.counts).map(([channel, count]) => [channel, count / (options.sessions * sessionTicks)])
					),
					sessionHitRates: Object.fromEntries(
						Object.entries(bucket.sessionHits).map(([channel, count]) => [channel, count / options.sessions])
					)
				}
			])
		)
	};

	const report = {
		version: 1,
		kind: 'wyrdweb-session-event-null-validation',
		createdAt: new Date().toISOString(),
		params: {
			sessions: options.sessions,
			minutes: options.minutes,
			sessionTicks,
			prewarmTicks,
			bootSeconds: options.bootSeconds,
			bootTicks,
			updatesPerSec: options.updatesPerSec,
			sampleBits,
			maxLookback,
			minSegmentLen,
			walkCalibration: options.walkCalibration,
			stackCalibration: options.stackCalibration,
			stageThresholds,
			randomSource: 'node:crypto.randomBytes',
			note: 'Detector is prewarmed per session; visual smoothing and pulse logic start from zero at session start.'
		},
		runtime: {
			durationMs: ended - started,
			ticksPerSecond: (options.sessions * (sessionTicks + prewarmTicks)) / ((ended - started) / 1000)
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
