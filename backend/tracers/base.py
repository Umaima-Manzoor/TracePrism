from abc import ABC, abstractmethod     

class BaseTracer(ABC):
    """
    Abstract base class for all language tracers.

    SECURITY NOTE (S1): Python's exec() cannot be fully sandboxed at the
    application level. Class hierarchy introspection (e.g. ().__class__.__bases__[0].__subclasses__()) can reach os.system.
    TracePrism relies on Vercel's serverless microVM isolation to
    contain any sandbox escape to a single ephemeral request.
    """

    @abstractmethod
    def trace(self, source_code: str) -> dict:
        """
        Execute source_code under tracing and return snapshots.

        Every language tracer MUST return this exact shape so the
        frontend and DeltaProcessor work without modification:

        {
            'snapshots': [
                {
                    'step': int,
                    'line': int,
                    'event': str,          # 'line', 'call', 'return', 'exception'
                    'func_name': str,
                    'locals': dict,        # variable name → JSON-serializable value
                    'stack': [             # call stack, outermost first
                        {
                            'func_name': str,
                            'call_label': str,
                            'line': int,
                        }
                    ],
                    'return_value': any,   # JSON-serializable, or None
                    'step_output': str,    # stdout captured during this step
                    'exception': {         # only present on exception events
                        'type': str,
                        'message': str,
                    } | None,
                }
            ],
            'total_steps': int,
            'error': {                     # None if execution succeeded
                'error_type': str,
                'message': str,
                'line': int | None,
            } | None,
            'output': str,                 # full captured stdout
        }
        """
        pass