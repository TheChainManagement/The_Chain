"""fugue.api shim — imported as a module object; attributes only used on the
distributed path, which raises before any are touched."""


def __getattr__(name):  # noqa: N807 — module-level PEP 562 hook
    raise RuntimeError(
        f"fugue.api.{name} is not available in this deployment "
        "(distributed execution disabled)"
    )
