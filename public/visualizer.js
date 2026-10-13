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

// pretty-print nested structures with indentation (shown on expand)
function formatVariablePretty(value, indent) {
    indent = indent || 0;
    const pad = '    '.repeat(indent);
    const padInner = '    '.repeat(indent + 1);

    if (value === null || value === undefined) return 'None';
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    if (typeof value === 'number' || typeof value === 'string') return formatVariableValue(value);

    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        const hasNested = value.some(v => Array.isArray(v) || (typeof v === 'object' && v !== null));
        if (!hasNested && value.length <= 5) return formatVariableValue(value);
        const items = value.map(v => padInner + formatVariablePretty(v, indent + 1));
        return '[\n' + items.join(',\n') + '\n' + pad + ']';
    }

    if (typeof value === 'object') {
        if (value.__type__ === 'tuple') {
            const items = value.value;
            if (items.length === 0) return '()';
            const hasNested = items.some(v => Array.isArray(v) || (typeof v === 'object' && v !== null));
            if (!hasNested && items.length <= 5) return formatVariableValue(value);
            const formatted = items.map(v => padInner + formatVariablePretty(v, indent + 1));
            return '(\n' + formatted.join(',\n') + (items.length === 1 ? ',' : '') + '\n' + pad + ')';
        }
        if (value.__type__ === 'set') {
            const items = value.value;
            if (items.length === 0) return 'set()';
            const formatted = items.map(v => padInner + formatVariablePretty(v, indent + 1));
            return '{\n' + formatted.join(',\n') + '\n' + pad + '}';
        }
        const entries = Object.entries(value);
        if (entries.length === 0) return '{}';
        const formatted = entries.map(([k, v]) => padInner + `"${k}": ${formatVariablePretty(v, indent + 1)}`);
        return '{\n' + formatted.join(',\n') + '\n' + pad + '}';
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

// suggestion dictionary for common python errors
const ERROR_SUGGESTIONS = {
    'SyntaxError': 'Check for missing colons, parentheses, quotes, or indentation errors.',
    'ImportError': 'TracePrism blocks system modules for security. Use only standard algorithm libraries like math or random.',
    'NameError': 'Check if the variable or function name is spelled correctly and defined before use.',
    'TypeError': 'Check that you are using the correct data types in your operation.',
    'ValueError': 'Check that the value you are passing is valid for this operation.',
    'ZeroDivisionError': 'You are dividing by zero. Check the denominator value before dividing.',
    'IndexError': 'The index is out of range. Check the length of your list or string.',
    'KeyError': 'The key does not exist in the dictionary. Check your dictionary keys.',
    'AttributeError': 'The object does not have this attribute or method. Check the object type.',
    'RecursionError': 'Maximum recursion depth exceeded. Check your base case in the recursive function.',
    'RuntimeError': 'Execution exceeded the time/step limit. Check for infinite loops.',
    'ConnectionError': 'Failed to connect to the execution server. Ensure the backend is running.',
};

// standalone error renderer - dark card on peach bg, vertically centered
function renderError(errorObj) {
    const errorType = errorObj.error_type || 'Error';
    const errorMsg = errorObj.message || 'An unknown error occurred.';
    let suggestion = '';
    if (errorType.includes('+')) {
        const types = errorType.split('+').map(t => t.trim());
        const suggestions = types.map(t => ERROR_SUGGESTIONS[t]).filter(Boolean);
        suggestion = suggestions.length > 0 ? suggestions.join(' ') : 'Review your code and try again.';
    } else {
        suggestion = ERROR_SUGGESTIONS[errorType] || 'Review your code and try again.';
    }

    pausePlayback();
    AppState.snapshots = [];
    AppState.totalSteps = 0;
    AppState.currentStep = -1;
    AppState.reconstructedLocals = [];

    if (errorObj.line) {
        highlightLine(errorObj.line);
    } else {
        highlightLine(null);
    }

    DOM.vizCanvas.parentElement.classList.add('canvas-active');
    DOM.stepIndicator.innerText = errorType.toUpperCase();
    DOM.vizMode.innerText = 'ERROR';
    DOM.stepCounter.innerText = '0 / 0';
    DOM.timelineSlider.value = 0;
    DOM.timelineSlider.max = 0;

    const safeMsg = errorMsg
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    DOM.vizCanvas.innerHTML = `
        <div class="error-display">
            <div class="error-display-heading">Execution Terminated</div>
            <div class="error-display-card">
                <div class="error-display-type">${errorType}</div>
                <div class="error-display-message">${safeMsg}</div>
            </div>
            <div class="error-display-suggestion">${suggestion}</div>
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

    // Display Step 0-indexed: "STEP 0 / 6" up to "STEP 6 / 6"
    const maxStepIndex = AppState.totalSteps > 0 ? AppState.totalSteps - 1 : 0;
    DOM.stepIndicator.innerText = `STEP ${stepIndex} / ${maxStepIndex}`;
    DOM.stepCounter.innerText = `${stepIndex} / ${maxStepIndex}`;
    DOM.timelineSlider.value = stepIndex;

    DOM.vizCanvas.parentElement.classList.add('canvas-active');

    // VARIABLE SECTION ([type] name = value format)
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

            const safeValue = formattedValue
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            const isNested = (type === 'list' || type === 'dict' || type === 'tuple' || type === 'set')
                && (formattedValue.includes('[') || formattedValue.includes('{') || formattedValue.includes('('))
                && formattedValue.length > 40;
            const nestedAttr = isNested ? ' data-nested="true"' : '';

            rowsHTML += `
                <div class="var-row${changeClass}" data-type="${type}">
                    <span class="var-type-tag">[${type}]</span>
                    <span class="var-name">${name}</span>
                    <span class="var-equals">=</span>
                    <span class="var-value"${nestedAttr} title="Click to expand/collapse">${safeValue}</span>
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

    // CALL STACK SECTION (grows upward, new frames on top, bold ➤ arrow)
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

            const isNewFrame = !prevLabels.has(funcName);
            const animClass = isNewFrame ? ' frame-new' : '';

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

        stackHTML = `
            <div class="viz-section">
                <div class="viz-section-label">Call Stack</div>
                <div class="stack-wrapper">
                    <div class="stack-arrow-track">
                        <div id="stack-arrow" class="stack-arrow">➤</div>
                    </div>
                    <div class="stack-frames">
                        ${framesHTML}
                    </div>
                </div>
            </div>
        `;
    }

    // OUTPUT SECTION (accumulated up to current step with click-to-expand)
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
                <div class="output-block" title="Click to expand/collapse"><pre>${safeOutput}</pre></div>
            </div>
        `;
    }

    // EXCEPTION OVERLAY (shown on top of animation state)
    let errorOverlayHTML = '';
    if (snapshot.exception) {
        const safeType = snapshot.exception.type
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeMsg = snapshot.exception.message
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const suggestion = ERROR_SUGGESTIONS[safeType] || 'Review your code and try again.';

        errorOverlayHTML = `
            <div class="error-overlay">
                <div class="error-overlay-heading">Execution Terminated</div>
                <div class="error-overlay-card">
                    <div class="error-overlay-type">${safeType}</div>
                    <div class="error-overlay-message">${safeMsg}</div>
                </div>
                <div class="error-overlay-suggestion">${suggestion}</div>
            </div>
        `;
        DOM.vizMode.innerText = 'EXCEPTION';
    }

    //  UPDATE STATUS MODE TAG
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

    DOM.vizCanvas.innerHTML = varsHTML + stackHTML + outputHTML + errorOverlayHTML;

    // Attach click handlers for expandable values & output
    const valueElements = DOM.vizCanvas.querySelectorAll('.var-value');
    valueElements.forEach((el) => {
        el.addEventListener('click', () => {
            el.classList.toggle('expanded');
            if (el.getAttribute('data-nested') === 'true') {
                const varName = el.parentElement.querySelector('.var-name').textContent;
                const rawValue = AppState.reconstructedLocals[AppState.currentStep]?.[varName];
                if (rawValue !== undefined) {
                    if (el.classList.contains('expanded')) {
                        const pretty = formatVariablePretty(rawValue)
                            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        el.innerHTML = pretty;
                    } else {
                        const compact = formatVariableValue(rawValue)
                            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        el.textContent = compact;
                    }
                }
            }
        });
    });

    const outputBlocks = DOM.vizCanvas.querySelectorAll('.output-block');
    outputBlocks.forEach((block) => {
        block.addEventListener('click', () => {
            block.classList.toggle('expanded');
        });
    });
}