<?php

declare(strict_types=1);

require_once __DIR__ . '/../_site/bootstrap.php';

$site = site_config();
$page = [
    'title' => 'Wyrdness',
    'description' => 'A browser-based Wyrd Light inspired random-signal orb for shared focus, meetings, and experiments.',
    'body_class' => 'wyrd-app-page',
];

ob_start();
?>
<section class="wyrd-app" aria-label="Wyrdness visualiser">
    <canvas id="wyrd-canvas" class="wyrd-canvas" aria-label="Wyrdness orb visualisation"></canvas>

    <aside id="wyrd-dev-panel" class="dev-panel" aria-label="Debug info" hidden>
        <h3>Debug</h3>
        <div class="dev-section-title">Visual channels</div>
        <div class="dev-row"><span class="k">Dominant</span><span class="v" data-dev="dominant">Baseline</span></div>
        <div class="dev-row"><span class="k">Parallel</span><span class="v" data-dev="visualParallel">0.0%</span></div>
        <div class="dev-row"><span class="k">Antiparallel</span><span class="v" data-dev="visualAntiparallel">0.0%</span></div>
        <div class="dev-row"><span class="k">Stick</span><span class="v" data-dev="visualStick">0.0%</span></div>
        <div class="dev-row"><span class="k">Pearson</span><span class="v" data-dev="visualPearson">0.0%</span></div>
        <div class="dev-row"><span class="k">Stage</span><span class="v" data-dev="stage">0</span></div>
        <div class="dev-row"><span class="k">Coherence</span><span class="v" data-dev="coherence">0.0%</span></div>
        <div class="dev-row"><span class="k">Significance</span><span class="v" data-dev="sigEnergy">0.0%</span></div>

        <div class="dev-section-title">Raw detector channels</div>
        <div class="dev-row"><span class="k">corr high</span><span class="v" data-dev="rawCorrelatedHigh">0.0%</span></div>
        <div class="dev-row"><span class="k">corr low</span><span class="v" data-dev="rawCorrelatedLow">0.0%</span></div>
        <div class="dev-row"><span class="k">anti A/B</span><span class="v" data-dev="rawAntiAb">0.0%</span></div>
        <div class="dev-row"><span class="k">anti B/A</span><span class="v" data-dev="rawAntiBa">0.0%</span></div>
        <div class="dev-row"><span class="k">3min close</span><span class="v" data-dev="rawStick">0.0%</span></div>
        <div class="dev-row"><span class="k">3max apart</span><span class="v" data-dev="rawWalkSeparate">0.0%</span></div>
        <div class="dev-row"><span class="k">pearson raw</span><span class="v" data-dev="rawPearson">0.0%</span></div>

        <div class="dev-section-title">Stats</div>
        <div class="dev-row"><span class="k">zA / zB</span><span class="v" data-dev="zAB">0.00 / 0.00</span></div>
        <div class="dev-row"><span class="k">Pearson r</span><span class="v" data-dev="pearsonR">0.000</span></div>
        <div class="dev-row"><span class="k">Pearson dir</span><span class="v" data-dev="pearsonDir">+</span></div>
        <div class="dev-row"><span class="k">Agree z legacy</span><span class="v" data-dev="zAgree">0.00</span></div>
        <div class="dev-row"><span class="k">3min z equiv</span><span class="v" data-dev="walkCloseZ">0.00</span></div>
        <div class="dev-row"><span class="k">3max z equiv</span><span class="v" data-dev="walkSeparateZ">0.00</span></div>
        <div class="dev-row"><span class="k">Walk ratio / p</span><span class="v" data-dev="walkDistance">0.0 / 0.0</span></div>
        <div class="dev-row"><span class="k">p raw / p adj</span><span class="v" data-dev="pValues">1.00 / 1.00</span></div>
        <div class="dev-row"><span class="k">Surprisal</span><span class="v" data-dev="surprisal">0.00</span></div>
        <div class="dev-row"><span class="k">Anomaly</span><span class="v" data-dev="anomalyState">idle</span></div>
        <div class="dev-row"><span class="k">Tick</span><span class="v" data-dev="tickCount">0</span></div>
        <div class="dev-row"><span class="k">FPS</span><span class="v" data-dev="fps">0</span></div>
        <div class="dev-row episode" data-dev-row="episode" hidden><span class="k">Episode</span><span class="v" data-dev="episode">0s | peak z=0.00</span></div>
        <div class="dev-row"><span class="k">corr high ep</span><span class="v" data-dev="epCorrelatedHigh">s0 l0 z0.00</span></div>
        <div class="dev-row"><span class="k">corr low ep</span><span class="v" data-dev="epCorrelatedLow">s0 l0 z0.00</span></div>
        <div class="dev-row"><span class="k">anti A/B ep</span><span class="v" data-dev="epAntiAb">s0 l0 z0.00</span></div>
        <div class="dev-row"><span class="k">anti B/A ep</span><span class="v" data-dev="epAntiBa">s0 l0 z0.00</span></div>
        <div class="dev-row"><span class="k">stick ep</span><span class="v" data-dev="epStick">s0 l0 z0.00</span></div>
        <div class="dev-row"><span class="k">walk apart ep</span><span class="v" data-dev="epWalkSeparate">s0 l0 z0.00</span></div>
        <div class="dev-row"><span class="k">pearson ep</span><span class="v" data-dev="epPearson">s0 l0 z0.00</span></div>
        <div class="dev-row demo" data-dev-row="demoBoost" hidden><span class="k">Demo Boost</span><span class="v" data-dev="demoBoost">0%</span></div>
    </aside>

    <aside id="wyrd-legend-panel" class="legend-panel" aria-label="Color legend" hidden>
        <h3>Color Legend</h3>
        <div class="legend-row"><span class="swatch" style="--h:356"></span><span><strong>Parallel</strong> — the streams drift in the same direction.</span></div>
        <div class="legend-row"><span class="swatch" style="--h:36"></span><span><strong>Antiparallel</strong> — the streams drift in opposite directions.</span></div>
        <div class="legend-row"><span class="swatch" style="--h:212"></span><span><strong>Stick together</strong> — the streams follow unusually similar paths.</span></div>
        <div class="legend-row"><span class="swatch" style="--h:135"></span><span><strong>Pearson</strong> — Pearson correlation is dominant.</span></div>
        <div class="legend-row"><span class="indicator">+ −</span><span>Swirl direction: clockwise / counter-clockwise Pearson sign.</span></div>
    </aside>

    <div id="wyrd-help-backdrop" class="modal-backdrop" hidden></div>
    <dialog id="wyrd-help-modal" class="help-modal" aria-label="Help">
        <h2>What is Wyrdness?</h2>
        <p>
            Wyrdness visualizes patterns in random data. Two streams of random bits, 0s and 1s,
            are continuously compared, looking for moments when they deviate from pure chance.
        </p>
        <p>
            This is an attempt to copy the <a href="https://gowyrd.org/wyrd-light/">Wyrd Light's</a>
            behaviour in a form that can be easily shared in a Zoom meeting.
        </p>

        <h3>What do the colors mean?</h3>
        <ul>
            <li><strong>Red / Parallel</strong> — both streams drift in the same direction.</li>
            <li><strong>Amber / Antiparallel</strong> — the streams drift in opposite directions.</li>
            <li><strong>Blue / Stick together</strong> — the streams follow unusually similar paths.</li>
            <li><strong>Green / Pearson</strong> — Pearson correlation is the dominant pattern.</li>
        </ul>

        <h3>What does brightness mean?</h3>
        <p>
            The brighter the orb glows, the more coherent or statistically unusual the current pattern.
            At stronger stages the colour blooms toward white. A rare calibrated anomaly can also trigger
            a single expanding white ring. The app deliberately avoids rapid white strobing.
        </p>

        <h3>What about the swirling effect?</h3>
        <p>
            The swirling motion inside the orb represents Pearson's correlation coefficient. It spins
            clockwise for positive correlation and counter-clockwise for negative correlation.
        </p>

        <h3>Keyboard shortcuts</h3>
        <ul>
            <li><strong>?</strong> Help — open or close this panel</li>
            <li><strong>M</strong> Mode — toggle Mellow / Wow visuals</li>
            <li><strong>S</strong> Sensitivity — Conservative / Moderate / Engaging</li>
            <li><strong>D</strong> Demo — start or stop demo mode</li>
            <li><strong>L</strong> Legend — toggle color legend</li>
            <li><strong>H</strong> History — open a timestamped CSV history in a new tab</li>
            <li><strong>`</strong> Debug — show additional signal data</li>
            <li><strong>Esc</strong> Close panels or stop demo</li>
        </ul>

        <h3>What is sensitivity?</h3>
        <p>Sensitivity controls how often patterns appear under pure randomness:</p>
        <ul>
            <li><strong>Conservative</strong> — calmer colour changes and stricter channel activation.</li>
            <li><strong>Moderate</strong> — balanced colour responsiveness for normal sessions.</li>
            <li><strong>Engaging</strong> — more frequent colour changes, good for demos.</li>
        </ul>

        <h3>Why does this matter?</h3>
        <p>
            Some researchers explore whether group intention or focused attention can influence random
            systems. This is a tool for that exploration: watch for changes in the orb while your group shares focus.
        </p>

        <div class="help-footer">
            <span class="help-hint">Press <kbd>?</kbd> or <kbd>Esc</kbd> to close</span>
        </div>
    </dialog>

    <div id="wyrd-demo-overlay" class="demo-overlay" hidden>
        <div class="demo-label-main" data-demo="main">Parallel</div>
        <div class="demo-label-pearson" data-demo="pearson" hidden></div>
        <div class="demo-progress" data-demo="progress">1 / 5</div>
    </div>

    <nav class="bottom-bar" aria-label="Wyrdness controls">
        <div class="bar-left">
            <span class="shortcut"><b>?</b> help</span>
            <span class="shortcut"><b>M</b> mode</span>
            <span class="shortcut"><b>S</b> sensitivity</span>
            <span class="shortcut"><b>D</b> demo</span>
            <span class="shortcut"><b>L</b> legend</span>
            <span class="shortcut"><b>H</b> history</span>
            <span class="shortcut"><b>`</b> debug</span>
        </div>
        <div class="bar-center">
            <span class="state-name" data-ui="stateName">Baseline</span>
        </div>
        <div class="bar-right">
            <span class="mode-info">
                <button type="button" class="mode-toggle" data-ui="modeToggle" title="Cycle Mellow / Wow mode">Mellow</button>
                <span aria-hidden="true">/</span>
                <button type="button" class="mode-toggle" data-ui="sensitivityToggle" title="Cycle Conservative / Moderate / Engaging sensitivity">Moderate</button>
            </span>
            <b>Wyrdness</b>
            <a title="GitHub Repository" href="https://github.com/adamshand/wyrdness" target="_blank" rel="noopener" class="brand" aria-label="Wyrdness GitHub repository">
                <svg class="github-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
            </a>
        </div>
    </nav>
</section>
<?php
$content = (string) ob_get_clean();

render_page(__DIR__, $site, $page, $content);
