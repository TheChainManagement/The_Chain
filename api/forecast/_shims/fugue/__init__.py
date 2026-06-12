"""
Import-surface shim for `fugue` (see _shims/README.md).

statsforecast hard-imports fugue at module load, but every fugue call site is
gated behind its distributed path — which this single-series function never
takes (pandas input → `_is_native` → the native engine). The real fugue drags
in triad → pyarrow (~128 MB), which alone pushes the Vercel Python bundle past
the 500 MB Lambda ephemeral limit. This shim satisfies the import surface and
fails LOUDLY if any distributed path is ever actually exercised.
"""


class _FuguePlaceholder:
    """Type stand-in: only ever used in isinstance checks / annotations."""


AnyDataFrame = _FuguePlaceholder
DataFrame = _FuguePlaceholder
ExecutionEngine = _FuguePlaceholder
FugueWorkflow = _FuguePlaceholder


def transform(*_args, **_kwargs):
    raise RuntimeError(
        "fugue distributed execution is not available in this deployment "
        "(the forecast function runs single-series, native engine only)"
    )
