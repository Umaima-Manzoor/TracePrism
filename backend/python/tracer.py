import sys              # for sys.settrace
import copy             # for deepcopy
import io               # for capturing print() output

class Tracer:

    BLOCKED_MODULES = { 'os', 'subprocess', 'socket', 'shutil', 'sys', 'pathlib', 'ctypes', 'pickle', 'marshal', 'code', 'codeop', 'importlib', 'multiprocessing', 'threading', 'signal' }

    BLOCKED_BUILTINS = { 'exec', 'eval', 'compile', 'open', 'input', 'breakpoint', 'globals', 'locals', 'vars', 'dir' }

    def __init__(self):
        self.snapshots = []
        self._step_counter = 0
        self._call_stack = []
        self._stdout_buffer = None       # reference to active stdout buffer
        self._last_stdout_length = 0     # tracks how much output was captured before this step

    def _trace_callback(self, frame, event, arg):
        code_filename = frame.f_code.co_filename

        if code_filename != '<traceprism>':
            return self._trace_callback

        func_name = frame.f_code.co_name

        if event == 'call':
            self._call_stack.append(func_name)
        elif event == 'return':
            if self._call_stack:
                self._call_stack.pop()
            else:
                import logging
                logging.warning("Return even with empty call stack.")

        safe_locals = self._sanitize_locals(frame.f_locals)

        snapshot = {
            'step': self._step_counter,
            'line': frame.f_lineno,
            'event': event,
            'func_name': func_name,
            'locals': copy.deepcopy(safe_locals),
            'stack': self._get_stack_frames(frame),
            'return_value': None,
        }

        # capture any new stdout produced since the previous snapshot
        if self._stdout_buffer is not None:
            current_length = self._stdout_buffer.tell()     # returns current position
            if current_length > self._last_stdout_length:      # reads new chars only
                self._stdout_buffer.seek(self._last_stdout_length)
                new_output = self._stdout_buffer.read()
                self._stdout_buffer.seek(current_length)  # restore pointer to end
                snapshot['step_output'] = new_output
                self._last_stdout_length = current_length
            else:
                snapshot['step_output'] = ''
        else:
            snapshot['step_output'] = ''

        if event == 'return':
            snapshot['return_value'] = self._make_serializable(arg)

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


    def _make_serializable(self, value):
        if value is None:
            return None
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value
        if isinstance(value, str):
            return value
        if isinstance(value, list):
            return [self._make_serializable(item) for item in value]
        if isinstance(value, tuple):
            return {
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
            if var_name.startswith('__') and var_name.endswith('__'):
                continue
            if type(var_value).__name__ == 'module':
                continue
            if callable(var_value):               # skip ALL callables (functions, builtins, lambdas)
                continue
            sanitized[var_name] = self._make_serializable(var_value)
        return sanitized


    def trace(self, source_code):
        self.snapshots = []
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

        exec_globals = {
            '__builtins__': safe_builtins,
            '__name__': '__main__',
        }

        error_info = None
        captured_output = io.StringIO()
        old_stdout = sys.stdout
        self._stdout_buffer = captured_output     # share buffer with trace callback
        self._last_stdout_length = 0              # reset counter

        try:
            sys.stdout = captured_output      # redirect all print() to our buffer
            sys.settrace(self._trace_callback)
            exec(compiled_code, exec_globals)
        except RuntimeError as e:
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
            sys.stdout = old_stdout           # restore real stdout no matter what
            self._stdout_buffer = None

        output_text = captured_output.getvalue().strip()

                # filter out meaningless intermediate snapshots (empty module-level steps)
        filtered_snapshots = []
        for snap in self.snapshots:
            has_vars = len(snap['locals']) > 0
            has_step_output = len(snap.get('step_output', '')) > 0
            has_depth = len(snap['stack']) > 1
            is_call_or_return = snap['event'] in ('call', 'return')
            has_exception = 'exception' in snap
            if has_vars or has_step_output or has_depth or is_call_or_return or has_exception:
                filtered_snapshots.append(snap)

        # trim trailing empty steps (module-level returns with no state change)
        while filtered_snapshots:
            last = filtered_snapshots[-1]
            is_trailing_empty = (
                last['event'] == 'return'
                and len(last['stack']) <= 1
                and not last.get('step_output')
                and 'exception' not in last
            )
            # keep the last meaningful step even if it's a return
            if is_trailing_empty and len(filtered_snapshots) > 1:
                prev = filtered_snapshots[-2]
                if prev['locals'] == last['locals']:
                    filtered_snapshots.pop()
                    continue
            break

        # re-number steps after all filtering
        for i, snap in enumerate(filtered_snapshots):
            snap['step'] = i

        return {
            'snapshots': filtered_snapshots,
            'total_steps': len(filtered_snapshots),
            'error': error_info,
            'output': output_text,
        }

    def _get_stack_frames(self, frame):
        stack = []
        curr = frame

        while curr is not None:
            if curr.f_code.co_filename == '<traceprism>':
                func_name = curr.f_code.co_name

                if func_name == '<module>':
                    call_label = 'main'
                else:
                    arg_count = curr.f_code.co_argcount + curr.f_code.co_kwonlyargcount
                    arg_names = curr.f_code.co_varnames[:arg_count]

                    args_formatted = []
                    for name in arg_names:
                        if name in curr.f_locals:
                            val = self._make_serializable(curr.f_locals[name])
                            args_formatted.append(f"{name}={val}")

                    args_str = ", ".join(args_formatted)
                    call_label = f"{func_name}({args_str})"

                stack.append({
                    'func_name': 'main' if func_name == '<module>' else func_name,
                    'call_label': call_label,
                    'line': curr.f_lineno
                })

            curr = curr.f_back

        return list(reversed(stack))