export function clamp01(v: number) {
	return Math.min(1, Math.max(0, v));
}

export function smoothstep(a: number, b: number, t: number) {
	const x = clamp01((t - a) / (b - a));
	return x * x * (3 - 2 * x);
}

export function wrapHue(h: number) {
	const x = h % 360;
	return x < 0 ? x + 360 : x;
}

export function hueApproach(current: number, target: number, k: number) {
	const c = wrapHue(current);
	const t = wrapHue(target);
	let d = t - c;
	if (d > 180) d -= 360;
	if (d < -180) d += 360;
	return wrapHue(c + d * k);
}

export function erfApprox(x: number) {
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

export function normalCdf(x: number) {
	return 0.5 * (1 + erfApprox(x / Math.SQRT2));
}

export function twoSidedPFromZ(z: number) {
	const az = Math.abs(z);
	const tail = 1 - normalCdf(az);
	return Math.max(1e-18, Math.min(1, 2 * tail));
}

// One-sided p-value for positive z (right tail: P(Z > z))
export function oneSidedPFromZ(z: number) {
	const tail = 1 - normalCdf(z);
	return Math.max(1e-18, Math.min(1, tail));
}

export function zFromOnes(ones: number, N: number) {
	const E = N / 2;
	const sd = Math.sqrt(N / 4);
	return (ones - E) / sd;
}

export function strengthFromZ(z: number, zStart: number, zFull: number) {
	return clamp01((Math.abs(z) - zStart) / (zFull - zStart));
}
