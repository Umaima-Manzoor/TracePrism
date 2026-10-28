# TracePrism

Refracting complex code execution into clear, animated understanding.

**Live:** [traceprism.runs-on.dev](https://traceprism.runs-on.dev)

TracePrism is a Python code visualization tool that lets you write code in the browser and watch it execute step by step. Every variable change, function call, stack frame, and return value is rendered on an animated canvas. Built to help CS students see what their code actually does at runtime.

---

## What It Does

1. Write Python in the left pane (CodeMirror editor with syntax highlighting)
2. Click **Run Trace** or press **Ctrl+Enter**
3. The right pane lights up and walks through your code one step at a time
4. Variables appear and update with type-colored values
5. The call stack grows and shrinks as functions are called and return
6. Return values animate outward from the stack with an extending arrow
7. Use the playback controls to step forward, backward, scrub the timeline, or auto-play at adjustable speed

---

## Features

**Editor**
- CodeMirror 5 with Python syntax highlighting and autocomplete
- Active line highlighting with collision detection against trace highlights
- Stale indicator warns when code has changed since the last trace (ignores whitespace-only edits)

**Execution**
- Step-by-step tracing via Python `sys.settrace`
- Delta compression with keyframes every 100 steps for efficient playback
- 5-second timeout and 50,000-step limit to prevent infinite loops
- SHA-256 code hashing with LRU cache (256 entries) for instant re-runs
- Print output capture and display

**Visualization**
- Variable table with per-type coloring (int, float, str, bool, list, tuple, dict, set, None)
- Expandable nested structures (click long values to pretty-print)
- Call stack rendered in reverse order (newest frame on top)
- Return value badges with spring-animated arrows
- Error overlays with contextual suggestions for 14 common Python exceptions

**Playback**
- Play, pause, step forward, step back, jump to first/last
- Timeline scrubber with keyboard focus indicator
- Speed control: 0.5x, 1x, 2x, 4x
- Full keyboard shortcut system (press `Ctrl+,` to see all)

**Accessibility**
- ARIA live regions, labels, and dialog roles
- `:focus-visible` outlines on all interactive elements
- `prefers-reduced-motion` disables all animations
- Keyboard-navigable playback and modal

---

## Architecture

```
Frontend (static, Vercel CDN)        Backend (Flask, Vercel Serverless)
+----------------------------+       +------------------------------+
|  index.html                |       |  api/index.py (entry point)  |
|  style.css                 | POST  |  backend/app.py (Flask)      |
|  app.js (init + editor)    | ----> |  backend/python/tracer.py    |
|  controls.js (playback)    | <---- |  backend/python/processor.py |
|  visualizer.js (canvas)    | JSON  |  backend/tracers/registry.py |
+----------------------------+       +------------------------------+
```

The backend uses a **language router pattern** (`TracerRegistry`) so new languages can be added without modifying the core app. Each language gets its own tracer class inheriting from `BaseTracer`.

**Adding a new language takes 3 steps:**
1. Create `backend/<lang>/tracer.py` inheriting from `BaseTracer`
2. Create `backend/<lang>/__init__.py`
3. Register in `app.py`: `TracerRegistry.register('<lang>', YourTracer)`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Editor | CodeMirror 5 |
| Frontend | Vanilla HTML, CSS, JavaScript |
| Backend | Python 3.12, Flask |
| Deployment | Vercel (Fluid Compute, serverless) |
| Domain | runs-on.dev (free subdomain registry) |
| Rate Limiting | flask-limiter (100 req/min per IP) |

No frameworks. No build step. No dependencies beyond Flask and its extensions.

---

## Security

The backend executes user-submitted Python code. Security measures in place:

| Measure | Detail |
|---------|--------|
| Execution sandbox | Vercel microVM isolation per invocation |
| Input limits | 1MB payload, 50KB code length |
| Timeout | 5-second hard limit per execution |
| Step limit | 50,000 trace steps maximum |
| Rate limiting | 100 requests/minute per IP |
| CORS | Restricted to verified origins via environment variable |
| Error handling | Generic messages for unexpected errors (no internal leakage) |
| Content-Type | Enforced `application/json` (415 on mismatch) |
| Instance isolation | Fresh tracer per request (no shared state) |
| Debug mode | Disabled in production |

---

## Design

Warm earthy dark palette with a peach canvas accent during execution.

- **Dark pane:** `#0e0f12` background, `#ede8df` text
- **Peach canvas:** `#ffd7a8` background, `#2a1f14` text
- **Accents:** Celadon teal (`#5eead4`) for active line, peach (`#ffd7a8`) for trace highlights
- **Fonts:** Outfit (UI), JetBrains Mono (code)
- **No AI-slop patterns:** No gradients, no frosted glass, no glowing halos, no pill badges

---

## Run Locally

**Prerequisites:** Python 3.10+, Node.js (for Vercel CLI, optional)

```bash
git clone https://github.com/Umaima-Manzoor/TracePrism.git
cd TracePrism

pip install -r requirements.txt

cd backend
python app.py

# In a separate terminal:
cd public
python -m http.server 3000
```

Open `http://localhost:3000` in your browser.

---

## Project Structure

```
TracePrism/
├── api/
│   └── index.py
├── backend/
│   ├── app.py
│   ├── tracers/
│   │   ├── base.py
│   │   └── registry.py
│   └── python/
│       ├── tracer.py
│       └── processor.py
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── controls.js
│   └── visualizer.js
├── requirements.txt
└── vercel.json
```

---

## License

MIT