# Why these shims exist

statsforecast 2.x hard-imports `fugue` (its distributed-compute layer) at
module load, and fugue drags `triad` → `pyarrow` into the install — ~128 MB
that pushed the Vercel Python function's dependency bundle to 587 MB, past the
500 MB Lambda ephemeral-storage cap. That broke EVERY production deploy from
Wave 2a until this fix (the build fails before the app even uploads).

This function only ever calls statsforecast with a single-series pandas
DataFrame, which routes through `_is_native` → the native engine; the fugue
call sites are never reached. So:

- `pyproject.toml` excludes `fugue`/`triad`/`adagio`/`pyarrow` from dependency
  resolution via uv `override-dependencies` (impossible markers), and
- `index.py` puts this directory on `sys.path` **only when the real fugue is
  absent**, so these stubs satisfy the import surface.

Every stub that could be reached by a genuinely distributed call raises
loudly — nothing degrades silently. If statsforecast changes its fugue import
surface on upgrade, imports fail at build/first-invoke, not subtly at runtime.

Covered surface (statsforecast 2.0.3):
- `fugue.execution.factory.try_get_context_execution_engine` → None (routes native)
- `fugue.execution.factory.make_execution_engine` → raises
- `fugue` top level: `AnyDataFrame`, `DataFrame`, `ExecutionEngine`,
  `FugueWorkflow` (type stand-ins), `transform` (raises)
- `fugue.api` (attribute access raises), `fugue.collections.yielded.Yielded`,
  `fugue.constants.FUGUE_CONF_WORKFLOW_EXCEPTION_INJECT`
- `triad.Schema` (stand-in), `triad.conditional_dispatcher` (real dispatcher
  semantics: candidates register, default only called on the distributed path)
