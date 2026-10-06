import sys              # for sys.settrace
import copy             # for deepcopy
import json             # for json.dumps & json.loads for converting dict to string and vice versa


class Tracer:

    BLOCKED_MODULES = { 'os', 'subprocess', 'socket', 'shutil', 'sys', 'pathlib', 'ctypes', 'pickle', 'marshal', 'code', 'codeop', 'importlib', 'multiprocessing', 'threading', 'signal' }

    BLOCKED_BUILTINS = { 'exec', 'eval', 'compile', 'open', 'input', 'breakpoint', 'globals', 'locals', 'vars', 'dir' }

    def __init__(self):
        self.snapshots = []
        self._step_counter = 0
        self._call_stack = []       # for keeping track of global stack of function calls

    def _trace_callback(self, frame, event, arg):
        code_filename = frame.f_code.co_filename    # name of the file currently being executed

        if code_filename != '<traceprism>':     # ignore all the code that is not user's code
            return self._trace_callback         # call for the next event even inside the function - otherwise the function will not be traced at all

        func_name = frame.f_code.co_name        # name of currently executing function

        if event == 'call':
            self._call_stack.append(func_name)
        elif event == 'return':
            if self._call_stack:            # check if the call stack is not empty before popping
                self._call_stack.pop()
            else:
                import logging
                logging.warning("Return even with empty call stack. This might indicate an issue with the tracing logic.")

        safe_locals = self._sanitize_locals(frame.f_locals)     # cleans raw local variables dict

        snapshot = {
            'step': self._step_counter,
            'line': frame.f_lineno,
            'event': event,
            'func_name': func_name,
            'locals': copy.deepcopy(safe_locals),
            'stack': list(self._call_stack),        # shallow copy since strings are immutable
            'return_value': None,
        }

        if event == 'return':
            snapshot['return_value'] = self._make_serializable(arg)     # actual return value

        if event == 'exception' and arg is not None:
            exc_type, exc_value, exc_tb = arg
            snapshot['exception'] = {
                'type': exc_type.__name__,
                'message': str(exc_value),
            }

        self.snapshots.append(snapshot)
        self._step_counter += 1

        if self._step_counter > 50000:
            raise RuntimeError("TracePrism: Execution exceeded 50,000 steps. \nPossible infinite loop detected.")

        return self._trace_callback

    
    def _make_serializable(self, value):        # single python value to json
        if value is None:
            return None
        if isinstance(value, bool):             # needs to come before int since it is its subclass
            return value
        if isinstance(value, (int, float)):
            return value
        if isinstance(value, str):
            return value
        if isinstance(value, list):
            return [self._make_serializable(item) for item in value]
        if isinstance(value, tuple):
            return {                        # don't exist in JSON so we created an object telling the frontend its actual type
                '__type__': 'tuple',
                'value': [self._make_serializable(item) for item in value]
            }
        if isinstance(value, dict):
            return { str(k): self._make_serializable(v) for k, v in value.items()}
        if isinstance(value, set):
            return {
                '__type__': 'set',
                'value': [self._make_serializable(item) for item in value]
            }
        return str(value)


    def _sanitize_locals(self, raw_locals):
        sanitized = {}
        for var_name, var_value in raw_locals.items():
            if var_name.startswith('__') and var_name.endswith('__'):       #ignore Python internals
                continue
            if type(var_value).__name__ == 'module':
                continue
            if callable(var_value) and not hasattr(var_value, '__code__'):      # ignore built-in funcs like print, len, range - __code__ have the bytecode but the others are implemented in C 9during execution)
                continue
            sanitized[var_name] = self._make_serializable(var_value)
        return sanitized


    def trace(self, source_code):       # main func called by Flask API
        self.snapshots = []         # reusing object instead of creating a new one
        self._step_counter = 0
        self._call_stack = []

        try:
            compiled_code = compile(source_code, '<traceprism>', 'exec')
        except SyntaxError as e:
            return {
                'error': True,
                'error_type': 'SyntaxError',
                'message': str(e),
                'line': e.lineno,
            }

        safe_builtins = {
            k: v for k, v in __builtins__.items()
            if k not in self.BLOCKED_BUILTINS
        } if isinstance(__builtins__, dict) else {
            k: getattr(__builtins__, k) for k in dir(__builtins__)
            if k not in self.BLOCKED_BUILTINS
        }

        original_import = safe_builtins.get('__import__')


        def safe_import(name, *args, **kwargs):
            top_level = name.split('.')[0]
            if top_level in self.BLOCKED_MODULES:
                raise ImportError(
                    f"TracePrism: '{name}' is not allowed."
                )
            return original_import(name, *args, **kwargs)

        safe_builtins['__import__'] = safe_import

        exec_globals = {                        # namespace for the user
            '__builtins__': safe_builtins,
            '__name__': '__main__',
        }

        error_info = None

        try:
            sys.settrace(self._trace_callback)
            exec(compiled_code, exec_globals, {})       # starting with 0 local vars
        except RuntimeError as e:           # safety limit of 50,000 steps
            error_info = {
                'error': True,
                'error_type': 'RuntimeError',
                'message': str(e),
            }
        except Exception as e:
            error_info = {
                'error': True,
                'error_type': type(e).__name__,
                'message': str(e),
            }
        finally:
            sys.settrace(None)

        return {
            'snapshots': self.snapshots,
            'total_steps': len(self.snapshots),
            'error': error_info,
        }