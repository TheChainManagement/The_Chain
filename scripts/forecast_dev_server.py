"""
Local runner for the Vercel Python forecast function (Block 8).

Vercel-only `/api` Python functions don't run under `next dev`, so local dev +
live verification serve the SAME handler module here instead:

    python3 -m venv .venv-forecast
    .venv-forecast/bin/pip install -r requirements.txt
    .venv-forecast/bin/python scripts/forecast_dev_server.py   # :8787

Then set FORECAST_API_URL=http://127.0.0.1:8787 in .env.local. The handler is
imported from api/forecast/index.py unchanged — what runs here is what deploys.
"""

import importlib.util
import os
import sys
from http.server import HTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HANDLER_PATH = os.path.join(ROOT, "api", "forecast", "index.py")

spec = importlib.util.spec_from_file_location("forecast_function", HANDLER_PATH)
module = importlib.util.module_from_spec(spec)
sys.modules["forecast_function"] = module
spec.loader.exec_module(module)


class DevHandler(module.handler):
    # The Vercel runtime mounts the function at /api/forecast; mirror that path
    # so FORECAST_API_URL works identically against dev and deployed.
    def do_POST(self):  # noqa: N802 (http.server convention)
        if self.path.rstrip("/") != "/api/forecast":
            self.send_response(404)
            self.end_headers()
            return
        super().do_POST()


def main():
    port = int(os.environ.get("PORT", "8787"))
    server = HTTPServer(("127.0.0.1", port), DevHandler)
    print(f"forecast dev server listening on http://127.0.0.1:{port}/api/forecast")
    server.serve_forever()


if __name__ == "__main__":
    main()
