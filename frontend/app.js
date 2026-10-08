// global - single source of truth
const AppState = {
    snapshots: [],              // holds the full array of execution snapshots from API
    totalSteps: 0,              // cached count of snapshots
    currentStep: -1,            // index of currently displayed snapshot (-1 means idle)
    isPlaying: false,           // true if auto-play is currently running
    playbackIntervalId: null,   // stored interval ID so we can clear/pause playback
    playbackSpeed: 600,         // millisecond duration per auto-advance step
};

// DOM cache - storing references to avoid repeated lookups 
const DOM = {
    // Top Bar Elements
    btnTrace: document.getElementById('btn-trace'),         // Run Trace button

    // Editor Elements
    codeInput: document.getElementById('code-input'),       // textarea for python code
    lineNumbers: document.getElementById('line-numbers'),   // gutter containing line numbers
    lineHighlight: document.getElementById('line-highlight'), // gliding overlay bar on current line
    stepIndicator: document.getElementById('step-indicator'), // status tag at editor top
    
    // Canvas Elements
    vizCanvas: document.getElementById('viz-canvas'),       // animation/visualization side
    vizMode: document.getElementById('viz-mode'),           // status tag at canvas top
    
    // Controls Bar Elements
    btnFirst: document.getElementById('btn-first'),         // home button
    btnPrev: document.getElementById('btn-prev'),           // prev button
    btnPlay: document.getElementById('btn-play'),           // play button
    btnNext: document.getElementById('btn-next'),           // next button
    btnLast: document.getElementById('btn-last'),           // end button
    timelineSlider: document.getElementById('timeline-slider'), // progress bar range input
    stepCounter: document.getElementById('step-counter'),   // metadata counter (e.g. 14 / 87)
    speedSelect: document.getElementById('speed-select'),   // speed dropdown picker
};

// Dropdown State Tracking: Fixes native browser focus trap
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