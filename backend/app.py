import hashlib  # for hash in cache
import os
from collections import OrderedDict         # remembers insertion order in cache and removes the oldest entry when cache is full

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_limiter import Limiter

# Robust import resolution for both local execution and Vercel serverless
try:
    from backend.tracers.registry import TracerRegistry
    from backend.python.tracer import PythonTracer
    from backend.python.processor import DeltaProcessor
except ImportError:
    from tracers.registry import TracerRegistry
    from python.tracer import PythonTracer
    from python.processor import DeltaProcessor

app = Flask(__name__)
app.config['JSON_SORT_KEYS'] = False      # Flask < 2.3
app.json.sort_keys = False                # Flask >= 2.3

# S2: Reject payloads larger than 1MB before they reach the tracer
app.config['MAX_CONTENT_LENGTH'] = 1 * 1024 * 1024

# S4: Restrict CORS to known origins (env var for flexibility)
ALLOWED_ORIGINS = os.environ.get(
    'CORS_ORIGINS','https://traceprism.vercel.app, http://localhost:3000,http://localhost:5000'
    ).split(',')
CORS(app, resources={r"/*": {"origins": ALLOWED_ORIGINS}})

# S3: Register tracers once at startup; instances are created per-request
TracerRegistry.register('python', PythonTracer)

MAX_CODE_LENGTH = 50_000       # S2: 50KB source code cap
CACHE_MAX_SIZE = 256           # S5: max cached traces


def get_client_ip():
    # S7: On Vercel, the edge proxy overwrites X-Forwarded-For securely.
    # In local dev this is spoofable, but local dev has no real attack surface.
    if request.headers.getlist("X-Forwarded-For"):
        return request.headers.getlist("X-Forwarded-For")[0].split(',')[0].strip()
    return request.remote_addr or "127.0.0.1"


limiter = Limiter(
    key_func=get_client_ip,
    app=app,
    default_limits=["100 per minute"],
    storage_uri="memory://"    # Vercel serverless: resets per invocation; real protection = 5s timeout + 50k step limit
)

processor = DeltaProcessor(keyframe_interval=100)
CACHE = OrderedDict()          # S5: bounded LRU cache (replaces unbounded dict)


def health_check():
    return jsonify({
        'status': 'healthy',
        'service': 'traceprism-backend',
        'supported_languages': TracerRegistry.supported_languages(),
    }), 200


def trace_code():
    # S9: Validate Content-Type
    if request.content_type and 'application/json' not in request.content_type:
        return jsonify({
            'error': True,
            'message': 'Content-Type must be application/json.',
        }), 415

    data = request.get_json(silent=True) or {}

    if not data or 'code' not in data:
        return jsonify({
            'error': True,
            'message': 'Missing "code" in request body.',
        }), 400

    source_code = data.get('code', '')
    language = data.get('language', 'python')

    # S10: Language router - look up tracer from registry
    tracer = TracerRegistry.get_tracer(language)
    if tracer is None:
        return jsonify({
            'error': True,
            'message': f'Language "{language}" is not supported. Supported: {", ".join(TracerRegistry.supported_languages())}',
        }), 400

    # S2: Source code size cap
    if len(source_code) > MAX_CODE_LENGTH:
        return jsonify({
            'error': True,
            'error_type': 'InputTooLarge',
            'message': f'Source code exceeds maximum length of {MAX_CODE_LENGTH} characters.',
        }), 400

    if not source_code.strip():
        return jsonify({
            'snapshots': [],
            'total_steps': 0,
            'error': None,
            'output': '',
        }), 200

    code_hash = hashlib.sha256(source_code.encode('utf-8')).hexdigest()

    # S5: Cache lookup with LRU promotion
    if code_hash in CACHE:
        CACHE.move_to_end(code_hash)
        cached = CACHE[code_hash].copy()
        cached['cached'] = True
        return jsonify(cached), 200

    raw_result = tracer.trace(source_code)

    if raw_result.get('error') and len(raw_result.get('snapshots', [])) == 0:
        return jsonify(raw_result), 200

    compressed_snapshots = processor.process(raw_result['snapshots'])

    response_payload = {
        'snapshots': compressed_snapshots,
        'total_steps': raw_result['total_steps'],
        'error': raw_result.get('error'),
        'cached': False,
        'output': raw_result.get('output', ''),
    }

    # S5: Bounded cache — evict oldest entry when full
    CACHE[code_hash] = {
        'snapshots': compressed_snapshots,
        'total_steps': raw_result['total_steps'],
        'error': raw_result.get('error'),
        'output': raw_result.get('output', ''),
    }
    if len(CACHE) > CACHE_MAX_SIZE:
        CACHE.popitem(last=False)       # removes the first item

    return jsonify(response_payload), 200


# universal route handler
@app.route('/', defaults={'path': ''}, methods=['GET', 'POST', 'OPTIONS'])
@app.route('/<path:path>', methods=['GET', 'POST', 'OPTIONS'])
def universal_handler(path):
    if request.method == 'OPTIONS':
        return '', 204
    if request.method == 'POST':
        return trace_code()
    return health_check()


@app.errorhandler(429)
def ratelimit_handler(e):
    return jsonify({
        'error': True,
        'error_type': 'RateLimitError',
        'message': 'Too many requests. Please wait a moment before running another trace.',
    }), 429


@app.errorhandler(413)
def payload_too_large_handler(e):
    return jsonify({
        'error': True,
        'error_type': 'InputTooLarge',
        'message': 'Request payload exceeds 1MB limit.',
    }), 413


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5000'))
    app.run(host='0.0.0.0', port=port, debug=False)   # S8: never debug in production