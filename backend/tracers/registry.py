class TracerRegistry:
    """
    Maps language names to tracer classes.

    To add a new language:
        1. Create backend/<lang>/tracer.py with a class inheriting BaseTracer
        2. In app.py: TracerRegistry.register('<lang>', YourTracerClass)
        3. Done: the API accepts language: "<lang>" automatically
    """

    _tracers: dict = {}

    @classmethod        # only one registry - no need to intantiate it
    def register(cls, language: str, tracer_class):     # for adding a language
        cls._tracers[language.lower()] = tracer_class   # adding class instead of instance so all requests get a new instance instead of same

    @classmethod
    def get_tracer(cls, language: str):
        tracer_class = cls._tracers.get(language.lower())
        if tracer_class is None:
            return None
        return tracer_class()

    @classmethod
    def supported_languages(cls) -> list:       # for health check and error message in case of unsupported language request
        return list(cls._tracers.keys())