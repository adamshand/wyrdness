import type { Channel } from '$lib/signal/types';

export const palette: Record<Exclude<Channel, 'baseline'>, { hue: number; name: string }> = {
	correlated_high: { hue: 170, name: 'Corr +' }, // Teal/cyan (both toward 1s)
	correlated_low: { hue: 238, name: 'Corr -' }, // Deep indigo/blue (both toward 0s)
	anti_ab: { hue: 50, name: 'Anti A>B' }, // Golden orange (A high, B low)
	anti_ba: { hue: 350, name: 'Anti B>A' }, // Crimson rose (B high, A low)
	stick: { hue: 112, name: 'Stick' }, // Green (agreement)
	pearson: { hue: 252, name: 'Pearson' } // Violet (rendered pearly when dominant)
};

export const DISPLAY_NAMES: Record<Channel, string> = {
	baseline: 'Baseline',
	correlated_high: 'Correlated',
	correlated_low: 'Correlated',
	anti_ab: 'Diverging A>B',
	anti_ba: 'Diverging B>A',
	stick: 'Agreement',
	pearson: 'Pearson'
};

export function getDirectionArrow(channel: Channel): string {
	// Avoid non-ASCII literals in source; output is still arrow glyphs.
	if (channel === 'correlated_high') return ` ${String.fromCharCode(0x2191)}`;
	if (channel === 'correlated_low') return ` ${String.fromCharCode(0x2193)}`;
	return '';
}

const PEARSON_DISPLAY_THRESHOLD = 0.05;
export function getPearsonIndicator(r: number): string {
	if (Math.abs(r) < PEARSON_DISPLAY_THRESHOLD) return '';
	return r > 0 ? ' +' : ' -';
}
