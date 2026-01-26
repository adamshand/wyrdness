export type Channel =
	| 'baseline'
	| 'correlated_high'
	| 'correlated_low'
	| 'anti_ab'
	| 'anti_ba'
	| 'stick'
	| 'pearson';

export type LightMode = 'wow' | 'mellow';

export type Sensitivity = 'conservative' | 'moderate' | 'engaging';

export type ModePreset = {
	// Smoothing time constants (ms)
	sigEnergyRiseMs: number;
	sigEnergyFallMs: number;
	hueTauMs: number;
	satTauMs: number;
	// Visual intensity
	maxBrightness: number; // 0..1 multiplier on brightness
	saturationBoost: number; // added to base saturation
	// Dominance behavior
	switchMargin: number; // how much stronger new channel must be to take over
	keepBonus: number; // bonus to current channel to prevent rapid switching
};

export type EpisodeState = {
	startTick: number; // when this episode started
	peakZ: number; // best z-score seen in this episode
	currentZ: number; // current z-score from startTick to now
	strength: number; // derived strength (0..1)
};
