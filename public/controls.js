// API endpoint configuration (local Flask backend)
const API_BASE_URL = '';

// API trigger (run trace via fetch) 
async function runTrace() {
    const sourceCode = DOM.codeInput.value;
    if (!sourceCode.trim()) {
        renderStep(-1);       // show idle state when code is empty
        return;
    }

    // UI loading state and disabling button
    DOM.btnTrace.disabled = true;
    DOM.btnTrace.innerText = 'Tracing...';
    DOM.stepIndicator.innerText = 'RUNNING';

    // Pause active playback if running
    pausePlayback();

    try {           // sends HTTP POST request to Flask
        const response = await fetch(`${API_BASE_URL}/api/trace`, {     
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: sourceCode, language: 'python' })
        });

        if (!response.ok) {
            throw new Error(`Server returned HTTP ${response.status}`);
        }

        const data = await response.json();

        // Handle any pre-execution error (syntax, import, runtime with no snapshots)
        if (data.error && (!data.snapshots || data.snapshots.length === 0)) {
            renderError(data.error);        // renders deep brown error card, no animation
            return;
        }

        // Populate global state
        AppState.snapshots = data.snapshots || [];
        AppState.totalSteps = data.total_steps || 0;

        if (AppState.totalSteps === 0) {
            renderStep(-1);
            return;
        }

        precomputeAllLocals();                  // Pre-compute O(1) state array

        // Set up scrubber max and render first meaningful step
        DOM.timelineSlider.max = AppState.totalSteps - 1;
        renderStep(0);

    } catch (err) {     // network errors
        console.error('Trace execution failed:', err);
        renderError({
            error_type: 'ConnectionError',
            message: 'Failed to connect to the execution server. Ensure the backend is running.'
        });
    } finally {
        DOM.btnTrace.disabled = false;
        DOM.btnTrace.innerText = 'Run Trace';
    }
}

// goes one step forward unless at end
function nextStep() {
    if (AppState.totalSteps === 0) return;
    if (AppState.currentStep < AppState.totalSteps - 1) {
        renderStep(AppState.currentStep + 1);
    }
}

// similar for one step back
function prevStep() {
    if (AppState.totalSteps === 0) return;
    if (AppState.currentStep > 0) {
        renderStep(AppState.currentStep - 1);
    }
}

function firstStep() {
    if (AppState.totalSteps === 0) return;
    renderStep(0);
}

function lastStep() {
    if (AppState.totalSteps === 0) return;
    renderStep(AppState.totalSteps - 1);
}

// auto-play and speed controller
function startPlayback() {
    if (AppState.totalSteps === 0) return;

    // If at the end, restart from beginning
    if (AppState.currentStep >= AppState.totalSteps - 1) {
        renderStep(0);
    }

    AppState.isPlaying = true;
    DOM.btnPlay.innerText = 'PAUSE';
    DOM.btnPlay.style.backgroundColor = 'var(--accent-lime)';
    DOM.btnPlay.style.color = 'var(--bg-app)';

    AppState.playbackIntervalId = setInterval(() => {
        if (AppState.currentStep < AppState.totalSteps - 1) {
            nextStep();
        } else {
            pausePlayback();
        }
    }, AppState.playbackSpeed);
}

function pausePlayback() {          // clears interval timer and resets buttons
    AppState.isPlaying = false;
    if (AppState.playbackIntervalId) {
        clearInterval(AppState.playbackIntervalId);
        AppState.playbackIntervalId = null;
    }
    DOM.btnPlay.innerText = 'PLAY';
    DOM.btnPlay.style.backgroundColor = '';
    DOM.btnPlay.style.color = '';
}

function togglePlay() {
    if (AppState.isPlaying) {
        pausePlayback();
    } else {
        startPlayback();
    }
}

// Run Trace button click
DOM.btnTrace.addEventListener('click', runTrace);

// Clear animation button click
DOM.btnClear.addEventListener('click', () => {
    pausePlayback();
    AppState.snapshots = [];
    AppState.totalSteps = 0;
    AppState.currentStep = -1;
    AppState.reconstructedLocals = [];
    renderStep(-1);         // idle state
});

// Deck Navigation buttons
DOM.btnFirst.addEventListener('click', () => { pausePlayback(); firstStep(); });
DOM.btnPrev.addEventListener('click', () => { pausePlayback(); prevStep(); });
DOM.btnPlay.addEventListener('click', togglePlay);
DOM.btnNext.addEventListener('click', () => { pausePlayback(); nextStep(); });
DOM.btnLast.addEventListener('click', () => { pausePlayback(); lastStep(); });

// Timeline Scrubber drag
DOM.timelineSlider.addEventListener('input', (e) => {
    pausePlayback();
    const targetStep = parseInt(e.target.value, 10);        // converting to int
    renderStep(targetStep);
});

// Speed dropdown change
DOM.speedSelect.addEventListener('change', (e) => {
    AppState.playbackSpeed = parseInt(e.target.value, 10);
    if (AppState.isPlaying) {
        pausePlayback();
        startPlayback();
    }
});

// Global Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
    // Ctrl+Enter or Cmd+Enter to run trace from anywhere
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();     // some browsers have default behaviours like submitting forms, etc.
        runTrace();
        return;
    }

    // Do not trigger playback shortcuts if user is typing code
    if (document.activeElement === DOM.codeInput) {
        return;
    }

    if (e.key === 'ArrowRight') {           // arrow keys for forward/backward (one step)
        e.preventDefault();
        pausePlayback();
        nextStep();
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        pausePlayback();
        prevStep();
    } else if (e.key === ' ' || e.code === 'Space') {       // space for pause/play
        e.preventDefault();
        togglePlay();
    } else if (e.key === 'Home') {          // home button to reach the first step
        e.preventDefault();
        pausePlayback();
        firstStep();
    } else if (e.key === 'End') {          // end button to reach the last step
        e.preventDefault();
        pausePlayback();
        lastStep();
    }
});