<script lang="ts">
	let { onClose } = $props<{ onClose: () => void }>();
</script>

<div
	class="modal-backdrop"
	onclick={onClose}
	onkeydown={(e) => e.key === 'Escape' && onClose()}
	role="button"
	tabindex="0"
	aria-label="Close help"
></div>
<dialog class="help-modal" open aria-label="Help">
	<h2>What is Wyrdness?</h2>
	<p>
		Wyrdness visualizes patterns in random data. Two streams of random bits (0s and 1s) are
		continuously compared, looking for moments when they deviate from pure chance.
	</p>
	<p>
		This is an attempt to copy the <a href="https://gowyrd.org/wyrd-light/">Wyrd Light's</a> behaviour
		in a form that can be easily shared in a Zoom meeting.
	</p>
	<h3>What do the colors mean?</h3>
	<ul>
		<li>
			<strong>Correlated</strong> (cyan/blue) -- Both streams trending the same direction, more than expected
			by chance.
		</li>
		<li>
			<strong>Diverging</strong> (orange/coral) -- Streams trending in opposite directions, more than
			expected by chance.
		</li>
		<li>
			<strong>Agreement</strong> (green) -- Individual bits matching more often than expected.
		</li>
		<li>
			<strong>Pearson</strong> (purple) -- Correlation is the dominant pattern.
		</li>
	</ul>

	<h3>What do the symbols mean?</h3>
	<ul>
		<li><strong>&#8593; / &#8595;</strong> -- Direction of the streams (more 1s or more 0s).</li>
		<li><strong>+ / &#8722;</strong> -- Pearson correlation direction (positive or negative).</li>
		<li><strong>A&gt;B or B&gt;A</strong> -- One stream has more 1s than the other.</li>
	</ul>

	<h3>What does brightness mean?</h3>
	<p>
		The brighter the orb glows, the more statistically significant the current pattern. When an
		expanding white ring appears, significance has crossed a threshold.
	</p>

	<h3>What about the swirling effect?</h3>
	<p>
		The swirling motion inside the orb shows correlation between the two streams. It spins clockwise
		for positive correlation (+) and counter-clockwise for negative (&#8722;).
	</p>

	<h3>Why does this matter?</h3>
	<p>
		Some researchers explore whether group intention or focused attention can influence random
		systems. This is a tool for that exploration -- watch for the orb to respond to your group's
		shared focus.
	</p>

	<div class="help-footer">
		<span class="help-hint">Press <kbd>?</kbd> or <kbd>Esc</kbd> to close</span>
	</div>
</dialog>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		z-index: 200;
	}

	.help-modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(600px, calc(100vw - 48px));
		max-height: calc(100vh - 80px);
		overflow-y: auto;
		padding: 28px 32px;
		border-radius: 18px;
		background: rgba(18, 18, 26, 0.95);
		backdrop-filter: blur(20px);
		border: 1px solid rgba(255, 255, 255, 0.1);
		box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
		color: rgba(255, 255, 255, 0.9);
		z-index: 210;
	}

	.help-modal h2 {
		margin: 0 0 16px;
		font-size: 24px;
		font-weight: 600;
	}

	.help-modal h3 {
		margin: 20px 0 10px;
		font-size: 15px;
		font-weight: 600;
		opacity: 0.95;
	}

	.help-modal p {
		margin: 0 0 12px;
		line-height: 1.6;
		font-size: 14px;
		opacity: 0.85;
	}

	.help-modal ul {
		margin: 0 0 12px;
		padding-left: 20px;
		line-height: 1.7;
		font-size: 14px;
		opacity: 0.85;
	}

	.help-modal li {
		margin-bottom: 6px;
	}

	.help-modal strong {
		color: white;
		font-weight: 600;
	}

	.help-footer {
		margin-top: 24px;
		padding-top: 16px;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
		text-align: center;
	}

	.help-hint {
		font-size: 12px;
		opacity: 0.5;
	}

	.help-modal kbd {
		display: inline-block;
		padding: 2px 6px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.15);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 11px;
	}
</style>
