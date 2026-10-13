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

// standalone error renderer - renders high-contrast deep brown error card immediately
function renderError(errorObj) {    
    const errorType = errorObj.error_type || errorObj.type || 'Error';          // synatx/import - runtime errors - fallback
    const errorMsg = errorObj.message || 'An error occurred during execution.';
    const errorLine = errorObj.line ? `Line ${errorObj.line}` : 'Pre-execution';

    if (errorObj.line) {
        highlightLine(errorObj.line);       // highlight the failing line in editor
    } else {
        highlightLine(null);                // hide highlight for pre-execution errors
    }

    DOM.vizCanvas.parentElement.classList.add('canvas-active');     // activate peach bg
    DOM.stepIndicator.innerText = errorType.toUpperCase();
    DOM.vizMode.innerText = 'ERROR';
    DOM.stepCounter.innerText = '0 / 0';
    DOM.timelineSlider.value = 0;
    DOM.timelineSlider.max = 0;

    DOM.vizCanvas.innerHTML = `
        <div class="viz-section" style="width: 100%;">
            <div class="viz-section-label" style="color: var(--text-on-peach-muted);">Execution Terminated</div>
            <div class="error-card">
                <div class="error-card-header">
                    <span class="error-card-type">${errorType}</span>
                    <span class="error-card-line">${errorLine}</span>
                </div>
                <div class="error-card-message">${errorMsg}</div>
            </div>
        </div>
    `;
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

    DOM.stepIndicator.innerText = `STEP ${stepIndex + 1} / ${AppState.totalSteps}`;
    DOM.stepCounter.innerText = `${stepIndex + 1} / ${AppState.totalSteps}`;
    DOM.timelineSlider.value = stepIndex;

    DOM.vizCanvas.parentElement.classList.add('canvas-active');

    // variable sections (inline rows, truncation on long values)
    let varsHTML = '';
    const currentLocals = AppState.reconstructedLocals[stepIndex] || {};
    const previousLocals = stepIndex > 0 ? AppState.reconstructedLocals[stepIndex - 1] : {};
    const varNames = Object.keys(currentLocals).filter(name => typeof currentLocals[name] !== 'function');

    if (varNames.length > 0) {
        let rowsHTML = '';
        for (const name of varNames) {
            const value = currentLocals[name];
            const type = getVariableType(value);
            const formattedValue = formatVariableValue(value);

            const isNew = !(name in previousLocals);
            const isChanged = !isNew && JSON.stringify(previousLocals[name]) !== JSON.stringify(value);
            const changeClass = (isNew || isChanged) ? ' chip-changed' : '';

            // Escape HTML in value to prevent injection
            const safeValue = formattedValue
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            rowsHTML += `
                <div class="var-row${changeClass}" data-type="${type}">
                    <span class="var-name">${name}</span>
                    <span class="var-colon">:</span>
                    <span class="var-type">${type}</span>
                    <span class="var-equals">=</span>
                    <span class="var-value" title="Click to expand/collapse">${safeValue}</span>
                </div>
            `;
        }
        varsHTML = `
            <div class="viz-section">
                <div class="viz-section-label">Variables</div>
                <div class="var-rows">
                    ${rowsHTML}
                </div>
            </div>
        `;
    }

    // call stack section (grows upward, new frames on top)
    let stackHTML = '';
    const stack = snapshot.stack || [];
    const prevStack = stepIndex > 0 ? (AppState.snapshots[stepIndex - 1].stack || []) : [];

    if (stack.length > 1) {
        const prevLabels = new Set(prevStack.map(f => typeof f === 'object' ? f.call_label : f));
        let framesHTML = '';

        // Render in natural order (index 0 = main, last = active)
        // CSS column-reverse will visually flip so last (active) appears at TOP
        for (let i = 0; i < stack.length; i++) {
            const frame = stack[i];
            const funcName = typeof frame === 'object' ? (frame.call_label || frame.func_name) : frame;
            const isActive = (i === stack.length - 1);
            const activeClass = isActive ? ' active-frame' : '';

            const isNewFrame = !prevLabels.has(funcName);
            const animClass = isNewFrame ? ' frame-new' : '';

            // Escape HTML in function name
            const safeFuncName = funcName
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            framesHTML += `
                <div class="stack-frame${activeClass}${animClass}" title="${safeFuncName}">
                    <span class="frame-func">${safeFuncName}</span>
                </div>
            `;
        }

        // Arrow position: since column-reverse flips the order, the active frame
        // (last in array) is visually at the TOP (position 0 from top)
        // So the arrow stays at position 0 pointing to the top frame
        const arrowOffset = 0;

        stackHTML = `
            <div class="viz-section">
                <div class="viz-section-label">Call Stack</div>
                <div class="stack-wrapper">
                    <div class="stack-arrow-track">
                        <div id="stack-arrow" class="stack-arrow" style="transform: translateY(${arrowOffset}px);">▶</div>
                    </div>
                    <div class="stack-frames">
                        ${framesHTML}
                    </div>
                </div>
            </div>
        `;
    }

    // output section (accumulated up to current step)
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

    // exception section (uses deep brown error card for high contrast)
    let errorHTML = '';
    if (snapshot.exception) {
        const safeType = snapshot.exception.type
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeMsg = snapshot.exception.message
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        errorHTML = `
            <div class="viz-section" style="width: 100%;">
                <div class="viz-section-label" style="color: var(--text-on-peach-muted);">Execution Terminated</div>
                <div class="error-card">
                    <div class="error-card-header">
                        <span class="error-card-type">${safeType}</span>
                        <span class="error-card-line">Line ${snapshot.line}</span>
                    </div>
                    <div class="error-card-message">${safeMsg}</div>
                </div>
            </div>
        `;
    }

    // update status mode tag
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

    DOM.vizCanvas.innerHTML = varsHTML + stackHTML + outputHTML + errorHTML;

    // attach click handlers for value expand/collapse
    const valueElements = DOM.vizCanvas.querySelectorAll('.var-value');
    valueElements.forEach(el => {
        el.addEventListener('click', () => {
            el.classList.toggle('expanded');
        });
    });
}