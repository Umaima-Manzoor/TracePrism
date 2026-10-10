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

    // 1. GENERATE CALL STACK SECTION (growing down on the left)
    let stackHTML = '';
    const stack = snapshot.stack || [];
    const prevStack = stepIndex > 0 ? (AppState.snapshots[stepIndex - 1].stack || []) : [];

    if (stack.length > 1) {
        const prevLabels = new Set(prevStack.map(f => typeof f === 'object' ? f.call_label : f));
        let framesHTML = '';
        
        for (let i = 0; i < stack.length; i++) {
            const frame = stack[i];
            const funcName = typeof frame === 'object' ? (frame.call_label || frame.func_name) : frame;
            const isActive = (i === stack.length - 1);
            const activeClass = isActive ? ' active-frame' : '';

            // Only animate genuinely new stack frames (prevents blinking)
            const isNewFrame = !prevLabels.has(funcName);
            const animClass = isNewFrame ? ' frame-new' : '';

            framesHTML += `
                <div class="stack-frame${activeClass}${animClass}">
                    <span class="frame-func">${funcName}</span>
                </div>
            `;
        }

        // Active frame is always the last element index (i = stack.length - 1)
        // Each frame has a fixed height of 32px (defined in CSS)
        // We multiply the index by 32 to calculate the absolute Y offset for the arrow!
        const arrowOffset = (stack.length - 1) * 32;

        stackHTML = `
            <div class="viz-section">
                <div class="viz-section-label">Call Stack</div>
                <div class="stack-wrapper">
                    <div class="stack-arrow-track">
                        <div id="stack-arrow" class="stack-arrow" style="transform: translateY(${arrowOffset}px);">━━▶</div>
                    </div>
                    <div class="stack-frames">
                        ${framesHTML}
                    </div>
                </div>
            </div>
        `;
    }

    // 2. GENERATE VARIABLES INLINE SECTION (flat REPL text lines)
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

            rowsHTML += `
                <div class="var-row${changeClass}" data-type="${type}">
                    <span class="var-name">${name}</span>
                    <span class="var-colon">:</span>
                    <span class="var-type">${type}</span>
                    <span class="var-equals">=</span>
                    <span class="var-value">${formattedValue}</span>
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

    // 3. GENERATE PROGRAM OUTPUT SECTION
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
            <div class="viz-section" style="width: 100%;">
                <div class="viz-section-label">Output</div>
                <div class="output-block"><pre>${safeOutput}</pre></div>
            </div>
        `;
    }

    // 4. GENERATE RUNTIME EXCEPTION SECTION
    let errorHTML = '';
    if (snapshot.exception) {
        errorHTML = `
            <div class="var-row" data-type="bool" style="margin-top: 10px;">
                <span class="var-name" style="color: var(--accent-coral); font-weight: 700;">${snapshot.exception.type}</span>
                <span class="var-colon">:</span>
                <span class="var-value" style="color: var(--text-main);">${snapshot.exception.message}</span>
            </div>
        `;
    }

    // 5. UPDATE SYSTEM STATUS MODE HEADER
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

    // 6. INJECT EVERYTHING INTO THE UNIFIED CANVAS
    // If we have both stack and other assets, we split them side-by-side using Flex
    if (stackHTML) {
        DOM.vizCanvas.innerHTML = `
            ${stackHTML}
            <div class="viz-section section-fill">
                ${errorHTML}
                ${outputHTML}
                ${varsHTML}
            </div>
        `;
    } else {
        DOM.vizCanvas.innerHTML = `
            <div class="viz-section section-fill">
                ${errorHTML}
                ${outputHTML}
                ${varsHTML}
            </div>
        `;
    }
}