"""
Demand-forecast function (Block 8) — Vercel Python Fluid function.

Stateless. POST a single SKU's demand history + a routed method; it runs the model
plus a seasonal-naive baseline, backtests both with rolling-origin cross-validation,
and returns forecast points with 80/95% intervals, the RMSSE/WAPE backtest, and
whether the model beats the baseline. No DB access — the durable batch
(forecastTenantBatchWorkflow) owns reads/writes; this is pure compute.

The method is chosen upstream in TS (src/lib/forecast/routing.ts) from the ADI/CV²
the classification already computed, so the demand-shape math lives in one place.

Request JSON:
  { "series": [{"ds": "2026-01-05", "y": 12}, ...],   # weekly demand, oldest→newest
    "h": 8,                  # horizon (periods)
    "method": "croston_sba", # croston_sba | tsb | auto_ets | auto_arima | seasonal_naive
    "freq": "W",             # pandas offset; weekly by default
    "season_length": 1,      # 52 for weekly annual seasonality once enough history
    "levels": [80, 95] }
Response JSON:
  { "method": "...", "points": [{"ds","yhat","lo80","hi80","lo95","hi95"}],
    "evaluation": {"rmsse","wape","baseline_rmsse","beats_baseline","n_windows"},
    "n_obs": N, "ok": true }
"""

import hmac
import json
import os
from http.server import BaseHTTPRequestHandler

import numpy as np
import pandas as pd
from statsforecast import StatsForecast
from statsforecast.models import (
    AutoARIMA,
    AutoETS,
    CrostonSBA,
    SeasonalNaive,
    TSB,
)
from statsforecast.utils import ConformalIntervals

BASELINE = "baseline"
INTERMITTENT = {"croston_sba", "tsb"}


def build_model(method: str, season_length: int, h: int):
    """The routed model. Intermittent models need ConformalIntervals for bands."""
    if method == "croston_sba":
        return CrostonSBA(prediction_intervals=ConformalIntervals(h=h, n_windows=2)), "CrostonSBA"
    if method == "tsb":
        return (
            TSB(alpha_d=0.1, alpha_p=0.1, prediction_intervals=ConformalIntervals(h=h, n_windows=2)),
            "TSB",
        )
    if method == "auto_ets":
        return AutoETS(season_length=season_length), "AutoETS"
    if method == "auto_arima":
        return AutoARIMA(season_length=season_length), "AutoARIMA"
    if method == "seasonal_naive":
        return SeasonalNaive(season_length=season_length), "SeasonalNaive"
    raise ValueError(f"unknown method: {method}")


def rmsse(y_true, y_pred, train_y):
    """Root mean squared scaled error — MSE scaled by the in-sample naive MSE."""
    y_true, y_pred = np.asarray(y_true, float), np.asarray(y_pred, float)
    denom = np.mean(np.diff(np.asarray(train_y, float)) ** 2)
    if denom <= 0 or np.isnan(denom):
        return float("nan")
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2) / denom))


def wape(y_true, y_pred):
    y_true, y_pred = np.asarray(y_true, float), np.asarray(y_pred, float)
    s = np.sum(np.abs(y_true))
    return float(np.sum(np.abs(y_true - y_pred)) / s) if s > 0 else float("nan")


def forecast(payload: dict) -> dict:
    series = payload.get("series") or []
    h = int(payload.get("h", 8))
    method = payload.get("method", "seasonal_naive")
    freq = payload.get("freq", "W")
    season_length = int(payload.get("season_length", 1))
    levels = payload.get("levels", [80, 95])

    if method == "benchmark":
        raise ValueError("benchmark is handled upstream; do not call the model for cold SKUs")
    if len(series) < 2:
        raise ValueError("need at least 2 observations to forecast")

    df = pd.DataFrame(series)
    df["unique_id"] = "s"
    df["ds"] = pd.to_datetime(df["ds"])
    # Reject non-numeric demand rather than silently coercing to 0 — a 0 is a real
    # no-sales period, but garbage means an upstream data bug we must not bury.
    df["y"] = pd.to_numeric(df["y"], errors="raise")
    df = df.sort_values("ds")[["unique_id", "ds", "y"]]

    model, model_col = build_model(method, season_length, h)
    baseline, baseline_col = SeasonalNaive(season_length=season_length), "SeasonalNaive"

    sf = StatsForecast(models=[model, baseline], freq=freq)
    fc = sf.forecast(df=df, h=h, level=levels)

    points = []
    for _, r in fc.iterrows():
        points.append(
            {
                "ds": pd.Timestamp(r["ds"]).date().isoformat(),
                "yhat": _f(r[model_col]),
                "lo80": _f(r.get(f"{model_col}-lo-80")),
                "hi80": _f(r.get(f"{model_col}-hi-80")),
                "lo95": _f(r.get(f"{model_col}-lo-95")),
                "hi95": _f(r.get(f"{model_col}-hi-95")),
            }
        )

    # Rolling-origin backtest: scale RMSSE by the in-sample naive MSE. A short
    # series can't be cross-validated; that's expected, so the forecast still ships,
    # but we SURFACE the reason in evaluation.error rather than swallow it silently.
    n_windows = 2 if len(df) >= h * 3 else 1
    model_rmsse = baseline_rmsse = model_wape = float("nan")
    backtest_error = None
    try:
        cv = sf.cross_validation(df=df, h=h, n_windows=n_windows, step_size=h)
        train_y = df["y"].to_numpy()
        model_rmsse = rmsse(cv["y"], cv[model_col], train_y)
        baseline_rmsse = rmsse(cv["y"], cv[baseline_col], train_y)
        model_wape = wape(cv["y"], cv[model_col])
    except Exception as e:  # noqa: BLE001 — backtest is best-effort; report, don't fail.
        n_windows = 0
        backtest_error = str(e)

    beats = (
        bool(model_rmsse < baseline_rmsse)
        if not (np.isnan(model_rmsse) or np.isnan(baseline_rmsse))
        else False
    )

    return {
        "ok": True,
        "method": method,
        "n_obs": int(len(df)),
        "points": points,
        "evaluation": {
            "rmsse": _f(model_rmsse),
            "wape": _f(model_wape),
            "baseline_rmsse": _f(baseline_rmsse),
            "beats_baseline": beats,
            "n_windows": n_windows,
            "error": backtest_error,
        },
    }


def _f(v):
    """JSON-safe float (NaN/inf → None)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if np.isfinite(f) else None


def _authorized(headers) -> bool:
    """Shared-secret gate. When FORECAST_API_SECRET is set (it is in deployed
    envs), the batch must send the matching x-forecast-secret header — this is
    an open compute endpoint otherwise. Unset = open (local dev runner)."""
    secret = os.environ.get("FORECAST_API_SECRET", "")
    if not secret:
        return True
    provided = headers.get("x-forecast-secret", "")
    return hmac.compare_digest(secret, provided)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not _authorized(self.headers):
            out = json.dumps({"ok": False, "error": "unauthorized"}).encode("utf-8")
            self.send_response(401)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)
            return
        try:
            length = int(self.headers.get("content-length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
            body = forecast(payload)
            status = 200
        except ValueError as e:
            body, status = {"ok": False, "error": str(e)}, 400
        except Exception as e:  # noqa: BLE001
            body, status = {"ok": False, "error": f"forecast failed: {e}"}, 500

        out = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)
