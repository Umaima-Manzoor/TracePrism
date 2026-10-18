// API endpoint configuration (local Flask backend)
const API_BASE_URL = '';

// API trigger (run trace via fetch)
async function runTrace() {
    const sourceCode = AppState.editor ? AppState.editor.getValue() : '';
    AppState.tracedCode = sourceCode;       // remember exactly what we're about to trace
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

    // Show loading indicator on animation pane
    DOM.vizCanvas.parentElement.classList.add('canvas-active');
    DOM.vizCanvas.innerHTML = `
        <div class="loading-overlay">
            <div class="loading-spinner"></div>
            <div class="loading-text">Tracing execution...</div>
        </div>
    `;

    try {           // sends HTTP POST request to Flask
        const response = await fetch(`${API_BASE_URL}/api/trace`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: sourceCode, language: 'python' })
        });

        if (!response.ok) {
            if (response.status === 429) {
                renderError({
                    error_type: 'RateLimitError',
                    message: 'Too many requests. Please wait a moment before running another trace.',
                });
                return;
            }
            if (response.status === 500 || response.status === 504) {
                renderError({
                    error_type: 'ExecutionError',
                    message: 'Execution was terminated by the server. Your code may have exceeded time or memory limits.',
                });
                return;
            }
            throw new Error(`Server returned HTTP ${response.status}`);
        }

        const data = await response.json();

        // Handle pre-execution errors (no snapshots at all)
        if (data.error && (!data.snapshots || data.snapshots.length === 0)) {
            renderError(data.error);
            return;
        }

        // Populate global state
        AppState.snapshots = data.snapshots || [];
        AppState.totalSteps = data.total_steps || 0;

        if (AppState.totalSteps === 0) {
            renderStep(-1);
            return;
        }

        // If there was an error during execution (e.g. step limit, timeout), inject it into the last snapshot so renderStep shows the error overlay
        if (data.error && AppState.snapshots.length > 0) {
            const lastSnap = AppState.snapshots[AppState.snapshots.length - 1];
            if (!lastSnap.exception) {      // avoids overwriting exceptions
                lastSnap.exception = {
                    type: data.error.error_type || 'RuntimeError',
                    message: data.error.message || 'Execution terminated.',
                };
            }
        }

        precomputeAllLocals();

        DOM.timelineSlider.max = AppState.totalSteps > 0 ? AppState.totalSteps - 1 : 0;
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
        // Re-evaluate staleness: user may have edited during the fetch
        const currentCode = AppState.editor ? AppState.editor.getValue() : '';
        AppState.isStale = currentCode !== AppState.tracedCode;
        DOM.staleIndicator.classList.toggle('hidden', !AppState.isStale);
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
    AppState.isStale = false;                       // no trace to be stale against
    AppState.tracedCode = '';
    DOM.staleIndicator.classList.add('hidden');      // hide stale warning
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

// Simulate :active press animation for keyboard activation
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        const btn = e.target.closest('.btn, .btn-deck, .btn-clear, .btn-shortcuts');
        if (btn) btn.classList.add('is-pressed');
    }
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        const btn = e.target.closest('.btn, .btn-deck, .btn-clear, .btn-shortcuts');
        if (btn) btn.classList.remove('is-pressed');
    }
});

// Global Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
    // Ctrl+Enter or Cmd+Enter to run trace from anywhere
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runTrace();
        return;
    }

    // Ctrl+, to open shortcuts modal
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        openShortcutsModal();
        return;
    }

    // Esc closes the shortcuts modal, or clears keyboard focus elsewhere
    if (e.key === 'Escape') {
        if (!DOM.shortcutsModal.classList.contains('hidden')) {
            closeShortcutsModal();
        } else if (document.activeElement instanceof HTMLElement) {     // modal closed and some other element is focused
            document.activeElement.blur();
        }
        return;
    }

    // Do not trigger playback shortcuts if user is typing in the CodeMirror editor
    const activeEl = document.activeElement;
    if (activeEl && activeEl.closest('.CodeMirror')) {
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