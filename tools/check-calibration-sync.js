#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['tools/generate-runtime-calibration.js', '--out', '/tmp/wyrd-calibration-check.js'], {
	encoding: 'utf8'
});
if (result.status !== 0) {
	process.stderr.write(result.stdout || '');
	process.stderr.write(result.stderr || '');
	process.exit(result.status ?? 1);
}

function withoutGeneratedAt(text) {
	return text.replace(/"generatedAt": "[^"]+"/, '"generatedAt": "<ignored>"');
}

const expected = withoutGeneratedAt(readFileSync('/tmp/wyrd-calibration-check.js', 'utf8'));
const actual = withoutGeneratedAt(readFileSync('app/public/calibration.js', 'utf8'));
if (actual !== expected) {
	console.error('app/public/calibration.js is out of sync. Run: node tools/generate-runtime-calibration.js');
	process.exit(1);
}
console.log('Runtime calibration is in sync.');
