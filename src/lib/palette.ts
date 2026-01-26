import type { Channel } from '$lib/signal/types';

const ARROW_UP = String.fromCharCode(0x2191);
const ARROW_DOWN = String.fromCharCode(0x2193);
const ARROW_LEFT = String.fromCharCode(0x2190);
const ARROW_RIGHT = String.fromCharCode(0x2192);

export const palette: Record<Exclude<Channel, 'baseline'>, { hue: number; name: string }> = {
	correlated_high: { hue: 170, name: 'Corr +' }, // Teal/cyan (both toward 1s)
	correlated_low: { hue: 238, name: 'Corr -' }, // Deep indigo/blue (both toward 0s)
	anti_ab: { hue: 50, name: `Anti ${ARROW_LEFT}` }, // Golden orange (A high, B low)
	anti_ba: { hue: 350, name: `Anti ${ARROW_RIGHT}` }, // Crimson rose (B high, A low)
	stick: { hue: 112, name: 'Stick' }, // Green (agreement)
	pearson: { hue: 252, name: 'Pearson' } // Violet (rendered pearly when dominant)
};

export const DISPLAY_NAMES: Record<Channel, string> = {
	baseline: 'Baseline',
	correlated_high: 'Correlated',
	correlated_low: 'Correlated',
	anti_ab: 'Diverging',
	anti_ba: 'Diverging',
	stick: 'Agreement',
	pearson: 'Pearson'
};

export function getDirectionArrow(channel: Channel): string {
	// Avoid non-ASCII literals in source; output is still arrow glyphs.
	if (channel === 'correlated_high') return ` ${ARROW_UP}`;
	if (channel === 'correlated_low') return ` ${ARROW_DOWN}`;
	if (channel === 'anti_ab') return ` ${ARROW_LEFT}`;
	if (channel === 'anti_ba') return ` ${ARROW_RIGHT}`;
	return '';
}

const PEARSON_DISPLAY_THRESHOLD = 0.05;
export function getPearsonIndicator(r: number): string {
	if (Math.abs(r) < PEARSON_DISPLAY_THRESHOLD) return '';
	return r > 0 ? ' +' : ' -';
}
