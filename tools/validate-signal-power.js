#!/usr/bin/env node

import '../app/public/signal-core.js';
import '../app/public/calibration.js';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const core = globalThis.WyrdSignalCore;
const calibration = globalThis.WyrdCalibration;
const SAMPLE_BITS = calibration.params.sampleBits;
const MAX_LOOKBACK = calibration.params.maxLookback;
const MIN_SEGMENT_LEN = calibration.params.minSegmentLen;
const PRESET = { channelPStart: 0.02, channelPFull: 0.0003, dominanceThreshold: 0.12 };
const SCENARIOS = {
	parallel_high: { expect: 'parallel', kind: 'bias', pA: 0.58, pB: 0.58 },
	parallel_low: { expect: 'parallel', kind: 'bias', pA: 0.42, pB: 0.42 },
	anti_ab: { expect: 'antiparallel', kind: 'bias', pA: 0.58, pB: 0.42 },
	anti_ba: { expect: 'antiparallel', kind: 'bias', pA: 0.42, pB: 0.58 },
	stick_together: { expect: 'stick_together', kind: 'matched_walk' },
	pearson_positive: { expect: 'pearson', kind: 'pearson', sameProb: 0.62 },
	pearson_negative: { expect: 'pearson', kind: 'pearson', sameProb: 0.38 }
};

function usage() {
	return `Usage: node tools/validate-signal-power.js [--ticks n] [--out path] [--pretty]\n`;
}

function parseArgs(argv) {
	const options = { ticks: 5000, out: null, pretty: false };
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => {
			const value = argv[++i];
			if (value == null || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
			return value;
		};
		switch (arg) {
			case '--ticks': options.ticks = Math.floor(Number(next())); break;
			case '--out': options.out = next(); break;
			case '--pretty': options.pretty = true; break;
			case '--help': console.log(usage()); process.exit(0);
			default: throw new Error(`Unknown option: ${arg}`);
		}
	}
	if (!Number.isFinite(options.ticks) || options.ticks <= MAX_LOOKBACK) throw new Error('--ticks must be > max lookback');
	return options;
}

class RandomBits {
	constructor() { this.buffer = randomBytes(1 << 20); this.bit = 0; }
	refill() { this.buffer = randomBytes(1 << 20); this.bit = 0; }
	nextBit() { if (this.bit >= this.buffer.length * 8) this.refill(); const v = (this.buffer[this.bit >> 3] >> (this.bit & 7)) & 1; this.bit++; return v; }
	uniform8() { let v = 0; for (let i = 0; i < 8; i++) v = (v << 1) | this.nextBit(); return v / 256; }
	bernoulli(p) { return this.uniform8() < p ? 1 : 0; }
}

function sampleScenario(rng, scenario) {
	if (scenario.kind === 'matched_walk') {
		let sum = 0;
		let sumXY = 0;
		for (let i = 0; i < SAMPLE_BITS; i++) {
			const x = rng.bernoulli(0.5) ? 1 : -1;
			const yIndependent = rng.bernoulli(0.5) ? 1 : -1;
			sum += x;
			sumXY += x * yIndependent;
		}
		// Same per-tick vertical displacement for both streams, but no bitwise
		// Pearson structure. This targets the walk-distance/3min detector.
		return { sumX: sum, sumY: sum, sumXY };
	}

	let sumX = 0, sumY = 0, sumXY = 0;
	for (let i = 0; i < SAMPLE_BITS; i++) {
		let a, b;
		if (scenario.kind === 'bias') {
			a = rng.bernoulli(scenario.pA);
			b = rng.bernoulli(scenario.pB);
		} else {
			a = rng.bernoulli(0.5);
			b = rng.bernoulli(scenario.sameProb) ? a : 1 - a;
		}
		const x = a === 1 ? 1 : -1;
		const y = b === 1 ? 1 : -1;
		sumX += x; sumY += y; sumXY += x * y;
	}
	return { sumX, sumY, sumXY };
}

function visualFromSignal(signal) {
	const raw = {
		parallel: Math.max(core.strengthFromP(signal.p.corrHigh, PRESET.channelPStart, PRESET.channelPFull), core.strengthFromP(signal.p.corrLow, PRESET.channelPStart, PRESET.channelPFull)),
		antiparallel: Math.max(core.strengthFromP(signal.p.antiAb, PRESET.channelPStart, PRESET.channelPFull), core.strengthFromP(signal.p.antiBa, PRESET.channelPStart, PRESET.channelPFull), core.strengthFromP(signal.p.walkSeparate, PRESET.channelPStart, PRESET.channelPFull)),
		stick_together: core.strengthFromP(signal.p.stick, PRESET.channelPStart, PRESET.channelPFull),
		pearson: core.strengthFromP(signal.p.pearson, PRESET.channelPStart, PRESET.channelPFull)
	};
	let best = 'baseline';
	let bestV = 0;
	for (const [channel, value] of Object.entries(raw)) if (value > bestV) { best = channel; bestV = value; }
	return bestV > PRESET.dominanceThreshold ? best : 'baseline';
}

function runScenario(options, scenario) {
	const rng = new RandomBits();
	let cumSumA = [0], cumSumB = [0], cumSumXY = [0];
	const counts = { baseline: 0, parallel: 0, antiparallel: 0, stick_together: 0, pearson: 0 };
	for (let tick = 1; tick <= options.ticks; tick++) {
		const s = sampleScenario(rng, scenario);
		cumSumA.push((cumSumA.at(-1) ?? 0) + s.sumX);
		cumSumB.push((cumSumB.at(-1) ?? 0) + s.sumY);
		cumSumXY.push((cumSumXY.at(-1) ?? 0) + s.sumXY);
		if (cumSumA.length > MAX_LOOKBACK + 20) { cumSumA = cumSumA.slice(-(MAX_LOOKBACK + 20)); cumSumB = cumSumB.slice(-(MAX_LOOKBACK + 20)); cumSumXY = cumSumXY.slice(-(MAX_LOOKBACK + 20)); }
		if (tick <= MAX_LOOKBACK) continue;
		const signal = core.computeRuntimeSignal(cumSumA, cumSumB, cumSumXY, cumSumA.length - 1, SAMPLE_BITS, MAX_LOOKBACK, MIN_SEGMENT_LEN, calibration);
		counts[visualFromSignal(signal)]++;
	}
	const recorded = options.ticks - MAX_LOOKBACK;
	return { counts, percent: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / recorded])) };
}

function main() {
	const options = parseArgs(process.argv);
	const results = Object.fromEntries(Object.entries(SCENARIOS).map(([name, scenario]) => [name, { expect: scenario.expect, ...runScenario(options, scenario) }]));
	const report = { version: 1, kind: 'wyrdweb-signal-power-validation', createdAt: new Date().toISOString(), params: { ticks: options.ticks, sampleBits: SAMPLE_BITS, maxLookback: MAX_LOOKBACK, minSegmentLen: MIN_SEGMENT_LEN }, results };
	for (const [name, row] of Object.entries(results)) console.log(`${name.padEnd(18)} expect=${row.expect.padEnd(14)} observed=${Object.entries(row.percent).sort((a,b)=>b[1]-a[1])[0].join(':')}`);
	if (options.out) { const outPath = resolve(options.out); mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, JSON.stringify(report, null, options.pretty ? 2 : 0) + '\n'); console.log(`Wrote ${outPath}`); }
}

try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); console.error('\n' + usage()); process.exit(1); }
