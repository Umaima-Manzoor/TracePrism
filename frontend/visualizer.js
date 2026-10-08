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

// converting variable object into html
function renderVariables(stepIndex) {
    if (stepIndex < 0 || !AppState.reconstructedLocals || !AppState.reconstructedLocals[stepIndex]) {
        return '';
    }

    const currentLocals = AppState.reconstructedLocals[stepIndex];
    const previousLocals = stepIndex > 0 ? AppState.reconstructedLocals[stepIndex - 1] : {};        // previous step for comparison/updates checking
    const varNames = Object.keys(currentLocals);    // array of var name strings

    if (varNames.length === 0) {
        return '';
    }

    let chipsHTML = '';

    for (const name of varNames) {
        const value = currentLocals[name];
        const type = getVariableType(value);
        const formattedValue = formatVariableValue(value);

        // Check if value mutated or is newly declared
        const isNew = !(name in previousLocals);
        const isChanged = !isNew && JSON.stringify(previousLocals[name]) !== JSON.stringify(value);     // to compre strings not memories
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

    return `
        <div class="viz-section">
            <div class="viz-section-label">Active Variables (${varNames.length})</div>
            <div class="var-chips">
                ${chipsHTML}
            </div>
        </div>
    `;
}