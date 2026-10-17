// global - single source of truth
const AppState = {
    snapshots: [],              // holds the full array of execution snapshots from API
    reconstructedLocals: [],    // pre-computed full variables for every step (O(1) lookup)
    totalSteps: 0,              // cached count of snapshots
    currentStep: -1,            // index of currently displayed snapshot (-1 means idle)
    isPlaying: false,           // true if auto-play is currently running
    playbackIntervalId: null,   // stored interval ID so we can clear/pause playback
    playbackSpeed: 600,         // millisecond duration per auto-advance step
    editor: null,               // CodeMirror editor instance
    highlightedLine: null,      // currently highlighted line (0-indexed for CodeMirror)
    isStale: false,             // true when editor code changed after last trace
     tracedCode: '',             // exact code string sent to backend on last run
};

// DOM cache - storing references to avoid repeated lookups
const DOM = {
    // Top Bar Elements
    btnTrace: document.getElementById('btn-trace'),         // Run Trace button

    // Editor Elements
    editorContainer: document.getElementById('code-editor-container'),  // CodeMirror mounts here
    stepIndicator: document.getElementById('step-indicator'),           // status tag at editor top
    staleIndicator: document.getElementById('stale-indicator'),         // "code modified" warning

    // Canvas Elements
    vizCanvas: document.getElementById('viz-canvas'),       // animation/visualization side
    vizMode: document.getElementById('viz-mode'),           // status tag at canvas top

    // Controls Bar Elements
    btnClear: document.getElementById('btn-clear'),         // clear animation button
    btnFirst: document.getElementById('btn-first'),         // home button
    btnPrev: document.getElementById('btn-prev'),           // prev button
    btnPlay: document.getElementById('btn-play'),           // play button
    btnNext: document.getElementById('btn-next'),           // next button
    btnLast: document.getElementById('btn-last'),           // end button
    timelineSlider: document.getElementById('timeline-slider'), // progress bar range input
    stepCounter: document.getElementById('step-counter'),   // metadata counter (e.g. 14 / 87)
    speedSelect: document.getElementById('speed-select'),   // speed dropdown picker

    // Shortcuts
    btnShortcuts: document.getElementById('btn-shortcuts'),
    shortcutsModal: document.getElementById('shortcuts-modal'),
    btnCloseShortcuts: document.getElementById('btn-close-shortcuts'),
};

// python keywords for auto-complete - codemirror doesn't include a list for python
const PYTHON_KEYWORDS = [
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
    'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
    'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
    'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
    'try', 'while', 'with', 'yield', 'print', 'range', 'len', 'int',
    'str', 'float', 'bool', 'list', 'dict', 'tuple', 'set', 'type',
    'input', 'map', 'filter', 'zip', 'enumerate', 'sorted', 'reversed',
    'min', 'max', 'sum', 'abs', 'round', 'isinstance', 'append',
    'extend', 'insert', 'remove', 'pop', 'index', 'count', 'sort',
    'keys', 'values', 'items', 'get', 'update', 'split', 'join',
    'strip', 'replace', 'find', 'format', 'upper', 'lower',
];

// codemirror initialization
function initEditor() {
    // Read saved code from previous session, or fallback to default factorial
    const savedCode = localStorage.getItem('traceprism_code');
    const defaultCode = 'def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n\nresult = factorial(3)';

    AppState.editor = CodeMirror(DOM.editorContainer, {
        value: savedCode !== null ? savedCode : defaultCode,
        mode: 'python',
        theme: 'traceprism',
        lineNumbers: true,
        lineWrapping: false,
        indentUnit: 4,
        tabSize: 4,
        indentWithTabs: false,
        matchBrackets: true,
        autoCloseBrackets: true,
        styleActiveLine: true,
        gutters: ['CodeMirror-linenumbers'],
        extraKeys: {
            'Ctrl-/': 'toggleComment',       // toggle # comment on selected lines
            'Cmd-/': 'toggleComment',        // same for Mac
            'Ctrl-Space': 'autocomplete',    // trigger keyword autocomplete
            'Esc': function(cm) {            // removes focus from editor
                cm.getInputField().blur();
            },
            'Ctrl-D': function(cm) {         // duplicate current line
                const cursor = cm.getCursor();
                const line = cm.getLine(cursor.line);
                cm.replaceRange('\n' + line, { line: cursor.line, ch: line.length });
                cm.setCursor({ line: cursor.line + 1, ch: cursor.ch });
            },
            'Alt-K': function(cm) {   // delete current line
                const cursor = cm.getCursor();
                const lastLine = cm.lastLine();
                if (cursor.line === lastLine) {
                    cm.replaceRange('', { line: cursor.line - 1, ch: cm.getLine(cursor.line - 1).length }, { line: cursor.line, ch: cm.getLine(cursor.line).length });
                } else {        // deletes line upward if on the last line
                    cm.replaceRange('', { line: cursor.line, ch: 0 }, { line: cursor.line + 1, ch: 0 });
                }
            },
        },
        hintOptions: {
            hint: function(cm) {             // custom autocomplete from PYTHON_KEYWORDS
                const cursor = cm.getCursor();
                const token = cm.getTokenAt(cursor);
                const start = token.start;
                const end = cursor.ch;
                const word = token.string;
                const list = PYTHON_KEYWORDS.filter(kw => kw.startsWith(word) && kw !== word);
                return { list: list, from: CodeMirror.Pos(cursor.line, start), to: CodeMirror.Pos(cursor.line, end) };
            }
        },
    });
}

initEditor();       // create the editor on page load
AppState.editor.setOption('styleActiveLine', false);     // hide blue bar until user clicks in

// auto-show autocomplete suggestions as user types (75ms delay like VS Code)
let autocompleteTimeout = null;
AppState.editor.on('change', function(cm, changeObj) {
    // Save current code to localStorage automatically
    localStorage.setItem('traceprism_code', cm.getValue());

    // Compare current editor content against last traced code
    if (AppState.totalSteps > 0) {
        const isNowStale = cm.getValue() !== AppState.tracedCode;
        if (isNowStale !== AppState.isStale) {      // only touch DOM when state actually flips
            AppState.isStale = isNowStale;
            DOM.staleIndicator.classList.toggle('hidden', !isNowStale);
        }
    }

    // Autocomplete suggestions logic
    if (changeObj.origin === '+delete' || changeObj.origin === 'paste' || changeObj.origin === 'undo' || changeObj.origin === 'redo') return;
    clearTimeout(autocompleteTimeout);
    autocompleteTimeout = setTimeout(function() {
        const cursor = cm.getCursor();
        const token = cm.getTokenAt(cursor);
        if (token.string.length >= 2 && /^[a-zA-Z_]+$/.test(token.string)) {
            const matches = PYTHON_KEYWORDS.filter(kw => kw.startsWith(token.string) && kw !== token.string);
            if (matches.length > 0) {
                cm.showHint({ completeSingle: false });
            }
        }
    }, 75);
});

AppState.editor.on('blur', updateEditingHighlightVisibility);
AppState.editor.on('focus', updateEditingHighlightVisibility);
AppState.editor.on('cursorActivity', updateEditingHighlightVisibility);     // re-check when cursor moves

function highlightLine(lineNumber) {
    const cm = AppState.editor;
    if (!cm) return;

    // clear previous highlight
    if (AppState.highlightedLine !== null) {
        cm.removeLineClass(AppState.highlightedLine, 'background', 'trace-highlight-line');
    }

    if (lineNumber === null || lineNumber <= 0) {
        AppState.highlightedLine = null;
        updateEditingHighlightVisibility();     // re-check if blue should show
        return;
    }

    // CodeMirror lines are 0-indexed, our snapshots are 1-indexed
    const cmLine = lineNumber - 1;
    if (cmLine >= 0 && cmLine <= cm.lastLine()) {
        cm.addLineClass(cmLine, 'background', 'trace-highlight-line');
        AppState.highlightedLine = cmLine;
        // Only auto-scroll editor on desktop (prevents mobile jump to code pane)
        if (window.innerWidth > 900) {
            cm.scrollIntoView({ line: cmLine, ch: 0 }, 100);
        }
        updateEditingHighlightVisibility();     // hide blue if it would collide with peach
    }
}

// hide blue editing bar when cursor is on the same line as peach execution bar
function updateEditingHighlightVisibility() {
    const cm = AppState.editor;
    if (!cm) return;
    const cursorLine = cm.getCursor().line;
    const isColliding = AppState.highlightedLine !== null && cursorLine === AppState.highlightedLine;
    const editorFocused = cm.hasFocus();        // if the user is in the editor
    cm.setOption('styleActiveLine', editorFocused && !isColliding);
}

// dropdown state tracking
let isDropdownOpen = false;

DOM.speedSelect.addEventListener('mousedown', (e) => {
    if (isDropdownOpen) {
        e.preventDefault();             // Prevents browser from reopening the menu
        DOM.speedSelect.blur();         // Forces dropdown to lose focus
        isDropdownOpen = false;         // Updates state to closed (arrow flips down!)
    } else {
        isDropdownOpen = true;          // Updates state to open (arrow flips up!)
    }
});

DOM.speedSelect.addEventListener('change', () => {
    DOM.speedSelect.blur();             // Drops focus when an option is selected
    isDropdownOpen = false;             // Resets state to closed
});

DOM.speedSelect.addEventListener('blur', () => {
    isDropdownOpen = false;             // Resets state if user clicks outside to close
});

//shortcuts modal
function openShortcutsModal() {
    DOM.shortcutsModal.classList.remove('hidden');
}

function closeShortcutsModal() {
    DOM.shortcutsModal.classList.add('hidden');
}

DOM.btnShortcuts.addEventListener('click', openShortcutsModal);
DOM.btnCloseShortcuts.addEventListener('click', closeShortcutsModal);
DOM.shortcutsModal.querySelector('.shortcuts-modal-backdrop').addEventListener('click', closeShortcutsModal);