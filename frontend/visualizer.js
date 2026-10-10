// identifying data type
function getVariableType(value) {
    if (value === null || value === undefined) return 'NoneType';
    if (typeof value === 'boolean') return 'bool';
    if (typeof value === 'number') {
        return Number.isInteger(value) ? 'int' : 'float';
    }
    if (typeof value === 'string') return 'str';
    if (Array.isArray(value)) return 'list';
    if (typeof value === 'object') {
        if (value.__type__ === 'tuple') return 'tuple';
        if (value.__type__ === 'set') return 'set';
        return 'dict';
    }
    return 'object';
}

// converting JSON string into python format
function formatVariableValue(value) {
    if (value === null || value === undefined) return 'None';
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    if (typeof value === 'string') return `"${value}"`;
    if (Array.isArray(value)) {
        const items = value.map(item => formatVariableValue(item)).join(', ');
        return `[${items}]`;
    }
    if (typeof value === 'object') {
        if (value.__type__ === 'tuple') {
            const items = value.value.map(item => formatVariableValue(item)).join(', ');
            return `(${items}${value.value.length === 1 ? ',' : ''})`;
        }
        if (value.__type__ === 'set') {
            const items = value.value.map(item => formatVariableValue(item)).join(', ');
            return `{${items}}`;
        }
        const entries = Object.entries(value).map(([k, v]) => `"${k}": ${formatVariableValue(v)}`).join(', ');
        return `{${entries}}`;
    }
    return String(value);
}

// pre-compute all variable states once after API response (O(1) playback)
function precomputeAllLocals() {
    AppState.reconstructedLocals = [];
    if (!AppState.snapshots || AppState.snapshots.length === 0) return;

    let currentLocals = {};

    for (let i = 0; i < AppState.snapshots.length; i++) {
        const snap = AppState.snapshots[i];

        if (snap.is_keyframe) {
            currentLocals = Object.assign({}, snap.locals || {});     // reset baseline at keyframe
        } else if (snap.locals_delta) {
            Object.assign(currentLocals, snap.locals_delta);          // merge delta on top
        }

        AppState.reconstructedLocals.push(Object.assign({}, currentLocals));  // store snapshot of state
    }
}

// master unified canvas orchestrator - renders complete state for any step
function renderStep(stepIndex) {
    // idle state - reset everything to default
    if (stepIndex < 0 || !AppState.snapshots || !AppState.snapshots[stepIndex]) {
        highlightLine(null);
        DOM.vizCanvas.parentElement.classList.remove('canvas-active');
        DOM.vizCanvas.innerHTML = `
            <div class="canvas-placeholder">
                <span class="placeholder-title">No Active Execution</span>
                <span class="placeholder-sub">Click "Run Trace" to visualize runtime execution</span>
            </div>
        `;
        DOM.stepIndicator.innerText = 'READY';
        DOM.vizMode.innerText = 'IDLE';
        DOM.stepCounter.innerText = '0 / 0';
        return;
    }

    AppState.currentStep = stepIndex;
    const snapshot = AppState.snapshots[stepIndex];

    highlightLine(snapshot.line);

    // updating headers and slider
    DOM.stepIndicator.innerText = `STEP ${stepIndex + 1} / ${AppState.totalSteps}`;
    DOM.stepCounter.innerText = `${stepIndex + 1} / ${AppState.totalSteps}`;
    DOM.timelineSlider.value = stepIndex;

    DOM.vizCanvas.parentElement.classList.add('canvas-active');

    // build variables section (only if variables exist at this step)
    let varsHTML = '';
    const currentLocals = AppState.reconstructedLocals[stepIndex] || {};
    const previousLocals = stepIndex > 0 ? AppState.reconstructedLocals[stepIndex - 1] : {};
    const varNames = Object.keys(currentLocals).filter(name => {
        const val = currentLocals[name];
        return typeof val !== 'function';       // safety net: skip any callables that slipped through
    });

    if (varNames.length > 0) {
        let chipsHTML = '';
        for (const name of varNames) {
            const value = currentLocals[name];
            const type = getVariableType(value);
            const formattedValue = formatVariableValue(value);

            const isNew = !(name in previousLocals);
            const isChanged = !isNew && JSON.stringify(previousLocals[name]) !== JSON.stringify(value);
            const changeClass = (isNew || isChanged) ? ' chip-changed' : '';

            chipsHTML += `
                <div class="var-chip${changeClass}" data-type="${type}">
                    <div class="var-chip-head">
                        <span class="var-chip-name">${name}</span>
                        <span class="var-chip-type">${type}</span>
                    </div>
                    <div class="var-chip-value">${formattedValue}</div>
                </div>
            `;
        }
        varsHTML = `
            <div class="viz-section">
                <div class="viz-section-label">Active Variables (${varNames.length})</div>
                <div class="var-chips">${chipsHTML}</div>
            </div>
        `;
    }

    // build call stack section (only if inside a function call)
    let stackHTML = '';
    const stack = snapshot.stack || [];
    const prevStack = stepIndex > 0 ? (AppState.snapshots[stepIndex - 1].stack || []) : [];

    if (stack.length > 1) {
        // build set of previous stack labels for diffing
        const prevLabels = new Set(prevStack.map(f => typeof f === 'object' ? f.call_label : f));

        let framesHTML = '';
        for (let i = 0; i < stack.length; i++) {
            const frame = stack[i];
            const funcName = typeof frame === 'object' ? (frame.call_label || frame.func_name) : frame;
            const isActive = (i === stack.length - 1);
            const activeClass = isActive ? ' active-frame' : '';

            // only animate frames that are genuinely new (not in previous step's stack)
            const isNewFrame = !prevLabels.has(funcName);
            const animClass = isNewFrame ? ' frame-new' : '';

            const arrow = isActive ? '<span class="frame-arrow">▶</span> ' : '';

            framesHTML += `
                <div class="stack-frame${activeClass}${animClass}">
                    <span class="frame-func">${arrow}${funcName}</span>
                </div>
            `;
        }
        stackHTML = `
            <div class="viz-section">
                <div class="viz-section-label">Call Stack (Depth: ${stack.length})</div>
                <div class="stack-frames">${framesHTML}</div>
            </div>
        `;
    }

    // build output section (accumulates print output up to current step)
    let outputHTML = '';
    let accumulatedOutput = '';
    for (let i = 0; i <= stepIndex; i++) {
        const snap = AppState.snapshots[i];
        if (snap && snap.step_output) {
            accumulatedOutput += snap.step_output;
        }
    }

    if (accumulatedOutput.length > 0) {
        const safeOutput = accumulatedOutput
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        outputHTML = `
            <div class="viz-section">
                <div class="viz-section-label">Output</div>
                <div class="output-block"><pre>${safeOutput}</pre></div>
            </div>
        `;
    }

    // build exception section (only if this step threw an error)
    let errorHTML = '';
    if (snapshot.exception) {
        errorHTML = `
            <div class="viz-section">
                <div class="viz-section-label" style="color: var(--accent-coral);">Exception Raised</div>
                <div class="var-chip" data-type="bool" style="border-color: var(--accent-coral);">
                    <div class="var-chip-head">
                        <span class="var-chip-name" style="color: var(--accent-coral);">${snapshot.exception.type}</span>
                        <span class="var-chip-type" style="color: var(--accent-coral);">ERROR</span>
                    </div>
                    <div class="var-chip-value">${snapshot.exception.message}</div>
                </div>
            </div>
        `;
    }

    // update mode tag based on what is being displayed
    if (snapshot.exception) {
        DOM.vizMode.innerText = 'EXCEPTION';
    } else if (varsHTML && stackHTML) {
        DOM.vizMode.innerText = 'VARS + STACK';
    } else if (stackHTML) {
        DOM.vizMode.innerText = 'CALL STACK';
    } else if (varsHTML) {
        DOM.vizMode.innerText = 'VARIABLES';
    } else if (outputHTML) {
        DOM.vizMode.innerText = 'OUTPUT';
    } else {
        DOM.vizMode.innerText = 'RUNNING';
    }

    // inject everything into unified canvas in one DOM update
    DOM.vizCanvas.innerHTML = errorHTML + outputHTML + varsHTML + stackHTML;
}