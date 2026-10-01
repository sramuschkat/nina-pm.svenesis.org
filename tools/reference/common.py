"""Gemeinsame Einstellungen des Referenzgenerators (TK 9.1).

- Ephemeride de432s **aus der Datei** `kernels/de432s.bsp` (Prüfsumme in `kernels/SHA256SUMS`), kein Netzzugriff.
- UT1 ≈ UTC wie die Engine: keine IERS-Downloads, `iers_degraded_accuracy = 'ignore'`.
- Refraktion: geometrische Höhen aus astropy (`pressure = 0`), scheinbar über **dieselbe**
  Saemundsson-Formel wie die Engine (AST-D30) – ein Implementierungstest, kein Modellvergleich.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from zoneinfo import ZoneInfo

import astropy
import numpy as np
import yaml
from astropy import units as u
from astropy.coordinates import EarthLocation, solar_system_ephemeris
from astropy.time import Time
from astropy.utils import iers

HERE = Path(__file__).resolve().parent
KERNEL = HERE / "kernels" / "de432s.bsp"


def _check_kernel() -> None:
    expected = (HERE / "kernels" / "SHA256SUMS").read_text(encoding="utf-8").split()[0]
    actual = hashlib.sha256(KERNEL.read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f"de432s.bsp: Prüfsumme {actual} statt {expected}")


iers.conf.auto_download = False
iers.conf.iers_degraded_accuracy = "ignore"
_check_kernel()
solar_system_ephemeris.set(str(KERNEL))

OUT = HERE.parent.parent / "packages" / "engine" / "test" / "fixtures"


def load_yaml(name: str):
    return yaml.safe_load((HERE / name).read_text(encoding="utf-8"))


def location(site) -> EarthLocation:
    return EarthLocation.from_geodetic(lon=site["lon"] * u.deg, lat=site["lat"] * u.deg, height=0 * u.m)


def unix(t: Time) -> float:
    return float(t.unix)


def to_time(unix_sec) -> Time:
    return Time(unix_sec, format="unix", scale="utc")


def saemundsson_arcmin(h: np.ndarray | float):
    """R(h) = 1,02′ / tan(h + 10,3/(h + 5,11)); unterhalb −1° konstant R(−1°) (moon.md)."""
    hh = np.maximum(np.asarray(h, dtype=float), -1.0)
    return 1.02 / np.tan(np.radians(hh + 10.3 / (hh + 5.11)))


def apparent(h):
    return np.asarray(h, dtype=float) + saemundsson_arcmin(h) / 60.0


def night_bounds(site, night: str):
    """Lokaler Mittag bis lokaler Mittag (night.md §1) über zoneinfo."""
    zone = ZoneInfo(site["tz"])
    d = dt.date.fromisoformat(night)
    start = dt.datetime(d.year, d.month, d.day, 12, tzinfo=zone)
    nxt = d + dt.timedelta(days=1)
    end = dt.datetime(nxt.year, nxt.month, nxt.day, 12, tzinfo=zone)
    return start.timestamp(), end.timestamp()


def transitions(site, year_from: int = 2025, year_to: int = 2027):
    """Übergangstabelle `[{atUtc, utcOffsetMinutes}]` aus zoneinfo – stündlich abgetastet, dann auf die
    Sekunde eingegrenzt. Erster Eintrag = Offset zum Tabellenbeginn."""
    zone = ZoneInfo(site["tz"])
    t0 = dt.datetime(year_from, 1, 1, tzinfo=dt.timezone.utc).timestamp()
    t1 = dt.datetime(year_to + 1, 1, 1, tzinfo=dt.timezone.utc).timestamp()

    def off(ts):
        return int(dt.datetime.fromtimestamp(ts, tz=zone).utcoffset().total_seconds() // 60)

    out = [{"atUtc": int(t0), "utcOffsetMinutes": off(t0)}]
    ts = t0
    while ts < t1:
        nxt = ts + 3600
        if off(nxt) != off(ts):
            lo, hi = ts, nxt
            while hi - lo > 1:
                mid = (lo + hi) // 2
                if off(mid) == off(ts):
                    lo = mid
                else:
                    hi = mid
            out.append({"atUtc": int(hi), "utcOffsetMinutes": off(hi)})
        ts = nxt
    return out


def bisect(f, a: float, b: float, tol: float = 0.05) -> float:
    fa = f(a) > 0
    while b - a > tol:
        m = (a + b) / 2
        if (f(m) > 0) == fa:
            a = m
        else:
            b = m
    return (a + b) / 2


def crossings(ts: np.ndarray, values: np.ndarray, f, level: float):
    """Alle Vorzeichenwechsel von values − level im Raster, verfeinert über die Skalarfunktion f."""
    out = []
    s = values - level > 0
    for i in np.nonzero(s[1:] != s[:-1])[0]:
        t = bisect(lambda x: f(x) - level, float(ts[i]), float(ts[i + 1]))
        out.append({"t": round(t, 2), "direction": "up" if s[i + 1] else "down"})
    return out


def write(name: str, payload) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {
            "generator": f"tools/reference/{name.replace('.json', '')}",
            "astropy": astropy.__version__,
            "numpy": np.__version__,
            "ephemeris": "de432s (jplephem, tools/reference/kernels/de432s.bsp)",
            "ut1": "UT1 = UTC (iers_degraded_accuracy = ignore), wie die Engine",
            "refraction": "geometrisch (pressure = 0); scheinbar über Saemundsson wie die Engine (AST-D30)",
            "leapSecondsExpire": str(iers.LeapSeconds.auto_open().expires),
        },
        **payload,
    }
    (OUT / name).write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def angular_sep(ra1, dec1, ra2, dec2):
    r = math.radians
    x1, y1, z1 = math.cos(r(dec1)) * math.cos(r(ra1)), math.cos(r(dec1)) * math.sin(r(ra1)), math.sin(r(dec1))
    x2, y2, z2 = math.cos(r(dec2)) * math.cos(r(ra2)), math.cos(r(dec2)) * math.sin(r(ra2)), math.sin(r(dec2))
    cx, cy, cz = y1 * z2 - z1 * y2, z1 * x2 - x1 * z2, x1 * y2 - y1 * x2
    return math.degrees(math.atan2(math.sqrt(cx * cx + cy * cy + cz * cz), x1 * x2 + y1 * y2 + z1 * z2))


def parallel_map(fn, items):
    """`fn` über `items` in eigenen Prozessen, Ergebnisse in der Reihenfolge von `items` – die Fixtures bleiben
    byte-gleich zum seriellen Lauf. Jede Nacht wird unabhängig gerechnet; der CI-Runner hat 4 vCPU.
    `REFERENCE_WORKERS=1` rechnet seriell (Fehlersuche). `fn` muss auf Modulebene stehen (pickle)."""
    items = list(items)
    workers = int(os.environ.get("REFERENCE_WORKERS", "0")) or os.cpu_count() or 1
    if workers <= 1 or len(items) <= 1:
        return [fn(x) for x in items]
    with ProcessPoolExecutor(max_workers=min(workers, len(items))) as pool:
        return list(pool.map(fn, items, chunksize=max(1, len(items) // (workers * 8))))
