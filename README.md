<div align="center">

# TracePrism

> *Refracting complex code execution into clear, animated understanding.*

**[Live Demo →](https://traceprism.runs-on.dev)** &nbsp;·&nbsp; **[How It Works](#how-it-works)** &nbsp;·&nbsp; **[Architecture](#architecture)**

<br>

![TracePrism Demo](assets/demo.gif)

*Step through Python code and watch variables, stacks, and return values animate in real time.*

</div>

---

## The Problem

You write a recursive function. It returns the wrong answer. You stare at the code. You add `print()` statements. You lose track of which call is which. You start over.

**TracePrism fixes this.** Paste your code, hit Run, and watch every step unfold on an animated canvas — variables light up when they change, the call stack grows and shrinks, and return values fly out with spring-animated arrows.

---

## How It Works

```
  You type Python          TracePrism shows you
  ───────────────          ────────────────────

  def fib(n):              ► Line 3 highlighted (peach border)
      if n <= 1:           ► Variables: [int] n = 5 (orange flash)
          return n         ► Stack: fib(5) → fib(4) → fib(3)
      return fib(n-1)      ► Return badge: ← 3 (animated arrow)
           + fib(n-2)      ► Output: (captured prints)
```

No debuggers to configure. No IDE plugins to install. Just a browser.

---

## Features at a Glance

<div align="center">

| 🎨 Editor | ⚡ Execution | 📊 Visualization |
|:---:|:---:|:---:|
| CodeMirror 5 | `sys.settrace` | Type-colored variables |
| Syntax highlighting | Delta compression | Animated call stack |
| Stale detection | 50K step limit | Return value arrows |
| Autocomplete | LRU cache | Error overlays |

</div>

**Playback controls** — Play · Pause · Step · Scrub · Speed (0.5x–4x)
**Keyboard first** — `Ctrl+Enter` to run, `Space` to play/pause, `←→` to step, `Ctrl+,` for all shortcuts
**Accessible** — ARIA live regions, focus indicators, `prefers-reduced-motion` support

---

## Design

TracePrism uses a warm earthy dark palette. No purple-blue gradients. No frosted glass. No AI-generated aesthetic.

<div align="center">

`#0e0f12` ████ &nbsp; `#16181e` ████ &nbsp; `#282a34` ████ &nbsp; `#ede8df` ████ &nbsp; `#ffd7a8` ████ &nbsp; `#5eead4` ████ &nbsp; `#c07a72` ████

**Dark pane** · **Dark pane** · **Elements** · **Text** · **Peach canvas** · **Teal accent** · **Coral accent**

</div>

The canvas turns **peach** during execution so you always know whether you're editing or watching. Variable types get distinct colors — orange for `int`, green for `str`, purple for `dict` — readable on both dark and peach backgrounds.

---

## Architecture

```
┌─────────────── Frontend (Vercel CDN) ───────────────┐
│                                                      │
│   index.html ──► style.css ──► app.js                │
│                                controls.js           │
│                                visualizer.js         │
│                                     │                │
└─────────────────────────────────────┼────────────────┘
                                      │ POST /api/trace
                                      ▼
┌─────────────── Backend (Serverless) ────────────────┐
│                                                      │
│   api/index.py ──► backend/app.py (Flask)            │
│                        │                             │
│                   TracerRegistry                     │
│                        │                             │
│                   PythonTracer                       │
│                   (sys.settrace)                     │
│                        │                             │
│                   DeltaProcessor                     │
│                   (keyframe compression)             │
│                                                      │
└──────────────────────────────────────────────────────┘
```

The **TracerRegistry** pattern means adding a new language is 3 lines of code:

```python
# backend/app.py
TracerRegistry.register('python', PythonTracer)
TracerRegistry.register('javascript', JavaScriptTracer)  # ← that's it
```

---

## Tech Stack

<div align="center">

**Frontend** &nbsp;·&nbsp; Vanilla HTML / CSS / JS &nbsp;·&nbsp; CodeMirror 5
**Backend** &nbsp;·&nbsp; Python 3.12 &nbsp;·&nbsp; Flask &nbsp;·&nbsp; flask-limiter
**Infra** &nbsp;·&nbsp; Vercel Serverless &nbsp;·&nbsp; Fluid Compute &nbsp;·&nbsp; runs-on.dev

</div>

No React. No Tailwind. No build step. No `node_modules` black hole. Just files that work.

---

## Security

TracePrism runs arbitrary Python code from strangers on the internet. Here's how it stays safe:

| Layer | Protection |
|---|---|
| 🏗️ **Isolation** | Vercel microVM per invocation — each request runs in its own sandbox |
| 📏 **Input limits** | 1MB payload · 50KB code · 5s timeout · 50K steps |
| 🚦 **Rate limiting** | 100 req/min per IP via flask-limiter |
| 🔒 **CORS** | Allowlist-only via `CORS_ORIGINS` env var |
| 🤫 **Error handling** | Generic messages for unexpected errors — no stack traces, no file paths |
| 🧊 **Instance isolation** | Fresh tracer per request — no shared state between users |
| 🚫 **Debug mode** | `debug=False` in production — no Werkzeug console |

---

## Run Locally

```bash
git clone https://github.com/Umaima-Manzoor/TracePrism.git
cd TracePrism
pip install -r requirements.txt

# Terminal 1 — backend
cd backend && python app.py

# Terminal 2 — frontend
cd public && python -m http.server 3000
```

Open **http://localhost:3000** and start tracing.

---

## Project Structure

```
TracePrism/
├── api/index.py                 # Vercel entry point
├── backend/
│   ├── app.py                   # Flask routes + security middleware
│   ├── tracers/
│   │   ├── base.py              # BaseTracer ABC (contract for all languages)
│   │   └── registry.py          # Language → tracer mapping
│   └── python/
│       ├── tracer.py            # PythonTracer (sys.settrace engine)
│       └── processor.py         # DeltaProcessor (keyframe compression)
├── public/
│   ├── index.html               # App shell + ARIA landmarks
│   ├── style.css                # ~1400 lines, warm earthy theme
│   ├── app.js                   # Editor init + stale indicator
│   ├── controls.js              # Playback + keyboard shortcuts
│   └── visualizer.js            # Canvas rendering engine
├── assets/
│   └── demo.gif                 # Demo recording
├── requirements.txt
└── vercel.json
```

---

## What's Next

- [ ] Recursion tree visualization (branching call diagrams)
- [ ] JavaScript and C++ tracer support
- [ ] User accounts + saved traces (Oracle Cloud + PostgreSQL)
- [ ] Breakpoints (click gutter to pause at specific lines)
- [ ] Shareable trace URLs

---

<div align="center">

**Built by [Umaima Manzoor](https://github.com/Umaima-Manzoor)** for CS transfer applications.

*If this helped you understand your code, star the repo — it helps more than you think.* ⭐

</div>