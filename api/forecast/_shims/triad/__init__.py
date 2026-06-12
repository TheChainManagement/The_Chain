"""
Import-surface shim for `triad` (see _shims/README.md).

statsforecast.core uses `conditional_dispatcher` to build `make_backend`, and
statsforecast.distributed.fugue registers a candidate on it at import. The
dispatcher below reproduces that registration contract; its default (and every
candidate) is only invoked on the distributed path this function never takes.
`Schema` is an annotation stand-in.
"""


class Schema:
    """Annotation stand-in; never instantiated on the native path."""


class _Dispatcher:
    def __init__(self, default):
        self._default = default
        self._candidates = []
        self.__name__ = getattr(default, "__name__", "dispatcher")

    def candidate(self, matcher, *_args, **_kwargs):
        def register(fn):
            self._candidates.append((matcher, fn))
            return fn

        return register

    def __call__(self, *args, **kwargs):
        for matcher, fn in self._candidates:
            try:
                if matcher(*args, **kwargs):
                    return fn(*args, **kwargs)
            except Exception:  # noqa: BLE001 — matcher mismatch means "next"
                continue
        return self._default(*args, **kwargs)


def conditional_dispatcher(func=None, entry_point=None):  # noqa: ARG001
    if func is None:
        return _Dispatcher
    return _Dispatcher(func)
