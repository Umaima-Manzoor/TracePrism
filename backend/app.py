import os
import hashlib
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# Robust import resolution for both local execution and Vercel serverless
try:
    from backend.python.tracer import Tracer
    from backend.python.processor import DeltaProcessor
except ImportError:
    from python.tracer import Tracer
    from python.processor import DeltaProcessor

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["100 per minute"],
    storage_uri="memory://"
)

tracer = Tracer()
processor = DeltaProcessor(keyframe_interval=100)
CACHE = {}


@app.route('/health', methods=['GET'])
@limiter.exempt
def health_check():
    return jsonify({
        'status': 'healthy',
        'service': 'traceprism-backend'
    }), 200


@app.route('/api/trace', methods=['POST'])
@limiter.limit("30 per minute")
def trace_code():
    data = request.get_json()

    if not data or 'code' not in data:
        return jsonify({
            'error': True,
            'message': 'Missing "code" in request body.'
        }), 400

    source_code = data.get('code', '')
    language = data.get('language', 'python')

    if language != 'python':
        return jsonify({
            'error': True,
            'message': f'Language "{language}" is not supported yet. Only "python" is supported.'
        }), 400

    if not source_code.strip():
        return jsonify({
            'snapshots': [],
            'total_steps': 0,
            'error': None,
            'output': ''
        }), 200

    code_hash = hashlib.sha256(source_code.encode('utf-8')).hexdigest()

    if code_hash in CACHE:
        return jsonify(CACHE[code_hash]), 200

    raw_result = tracer.trace(source_code)

    if raw_result.get('error') and raw_result.get('error_type') == 'SyntaxError':
        return jsonify(raw_result), 200

    compressed_snapshots = processor.process(raw_result['snapshots'])

    response_payload = {
        'snapshots': compressed_snapshots,
        'total_steps': raw_result['total_steps'],
        'error': raw_result.get('error'),
        'cached': False,
        'output': raw_result.get('output', ''),
    }

    CACHE[code_hash] = {
        'snapshots': compressed_snapshots,
        'total_steps': raw_result['total_steps'],
        'error': raw_result.get('error'),
        'cached': True,
        'output': raw_result.get('output', ''),
    }

    return jsonify(response_payload), 200

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)