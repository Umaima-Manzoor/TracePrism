class DeltaProcessor:
    def __init__(self, keyframe_interval=100):
        self.keyframe_interval = keyframe_interval

    def process(self, snapshots):       # all snapshots in a list
        if not snapshots:
            return []

        compressed = []     # keyframes + deltas
        prev_locals = {}

        for i, snap in enumerate(snapshots):        
            is_keyframe = (i % self.keyframe_interval == 0)     # i for checking for interval

            entry = {
                'step': snap['step'],
                'line': snap['line'],
                'event': snap['event'],
                'func_name': snap['func_name'],
                'stack': snap['stack'],
                'return_value': snap.get('return_value'),
                'step_output': snap.get('step_output', ''),       # per-step output chunk
                'exception': snap.get('exception'),               # preserve exception info
                'is_keyframe': is_keyframe,
            }

            if is_keyframe:
                entry['locals'] = snap['locals']             

            else:
                entry['locals_delta'] = self._compute_delta(prev_locals, snap['locals'])

            compressed.append(entry)
            prev_locals = snap['locals']

        return compressed

    def _compute_delta(self, prev_locals, curr_locals):
        delta = {}
        for key, value in curr_locals.items():
            if key not in prev_locals or prev_locals[key] != value:
                delta[key] = value

        return delta