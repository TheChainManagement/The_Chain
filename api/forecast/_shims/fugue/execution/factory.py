"""The two functions statsforecast.core imports.

`try_get_context_execution_engine` returning None is what routes every pandas
DataFrame through `_is_native` → the native engine (the only path this
function uses). `make_execution_engine` is only reached with a non-pandas
distributed input, which this deployment never provides.
"""


def try_get_context_execution_engine():
    return None


def make_execution_engine(*_args, **_kwargs):
    raise RuntimeError(
        "fugue execution engines are not available in this deployment "
        "(single-series pandas input only)"
    )
