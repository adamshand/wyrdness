import type { Channel } from '$lib/signal/types';

export type DemoChannel = Exclude<Channel, 'baseline'>;

export const DEMO_CHANNELS: DemoChannel[] = [
	'correlated_high',
	'correlated_low',
	'anti_ab',
	'anti_ba',
	'stick',
	'pearson'
];

const ARROW_UP = String.fromCharCode(0x2191);
const ARROW_DOWN = String.fromCharCode(0x2193);

export const DEMO_LABELS: Record<DemoChannel, string> = {
	correlated_high: `Correlated ${ARROW_UP}`,
	correlated_low: `Correlated ${ARROW_DOWN}`,
	anti_ab: 'Diverging A>B',
	anti_ba: 'Diverging B>A',
	stick: 'Agreement',
	pearson: 'Pearson'
};
