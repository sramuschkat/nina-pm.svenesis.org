"""Ziele je Standort (TK 9.1): Höhe/Azimut geometrisch und scheinbar (Saemundsson aus der geometrischen
Höhe wie die Engine, AST-D30 – bis 28.09.2026 astropys eigene Refraktion mit 1010 hPa/10 °C, entgegen der
Beschreibung in `common.py`) je 15 min, dazu der erste obere Meridiandurchgang in der Nacht (Mittag bis
Mittag). Nächte 2026 sowie 1995 und 2045 (Präzession/Nutation über Jahrzehnte).

Der Meridiandurchgang wird wie in der Engine **ohne Aberration** gerechnet (Präzession/Nutation
IAU 1976/1980 über `erfa.pnm80`, GAST nach IAU 1994): am Pol macht die Aberration (≈ 20″) sonst über
eine Minute im Durchgang aus – ein Modellunterschied, kein Implementierungsfehler (AST-D30)."""
from __future__ import annotations

import erfa
import numpy as np
from astropy import units as u
from astropy.coordinates import AltAz, SkyCoord

from common import apparent, bisect, load_yaml, location, night_bounds, to_time, write

# Zwei Nächte 2026 und zwei außerhalb (1995, 2045) – Präzession/Nutation über Jahrzehnte (Prüfung 28.09.2026).
NIGHTS = ["2026-03-15", "2026-09-17", "1995-01-15", "2045-07-15"]


def hour_angle(coord, loc, t):
    """Stundenwinkel aus dem scheinbaren Ort ohne Aberration (Präzession + Nutation IAU 1976/1980)."""
    icrs = coord.icrs
    v = np.array(
        [
            np.cos(icrs.dec.rad) * np.cos(icrs.ra.rad),
            np.cos(icrs.dec.rad) * np.sin(icrs.ra.rad),
            np.sin(icrs.dec.rad),
        ]
    )
    pnm = erfa.pnm80(t.tt.jd1, t.tt.jd2)
    w = pnm @ v if pnm.ndim == 2 else np.einsum("nij,j->ni", pnm, v).T
    ra = np.degrees(np.arctan2(w[1], w[0]))
    last = t.sidereal_time("apparent", longitude=loc.lon, model="IAU1994").deg
    return (last - ra + 180.0) % 360.0 - 180.0


def main():
    sites = load_yaml("sites.yaml")
    targets = load_yaml("targets.yaml")
    rows = []
    for site in sites:
        loc = location(site)
        for night in NIGHTS:
            start, end = night_bounds(site, night)
            grid = np.arange(start, end, 900.0)
            t = to_time(grid)
            for target in targets:
                c = SkyCoord(ra=target["ra"] * u.deg, dec=target["dec"] * u.deg, frame="icrs")
                geo = c.transform_to(AltAz(obstime=t, location=loc, pressure=0 * u.hPa))
                # scheinbar über Saemundsson aus der geometrischen Höhe wie die Engine (AST-D30) – vorher
                # astropys eigene Refraktion (1010 hPa, 10 °C), entgegen der Beschreibung in `common.py`
                app_alt = apparent(geo.alt.deg)
                # erster oberer Meridiandurchgang: HA von − nach + im 5-min-Raster, dann Bisektion
                fine = np.arange(start, end, 300.0)
                ha = hour_angle(c, loc, to_time(fine))
                transit = None
                for i in range(len(fine) - 1):
                    if ha[i] < 0 <= ha[i + 1] and ha[i + 1] - ha[i] < 180:
                        transit = round(
                            bisect(lambda x: float(hour_angle(c, loc, to_time(x))), float(fine[i]), float(fine[i + 1])), 2
                        )
                        break
                rows.append(
                    {
                        "site": site["id"],
                        "night": night,
                        "target": target["id"],
                        "raJ2000Deg": target["ra"],
                        "decJ2000Deg": target["dec"],
                        "noonStartUtc": start,
                        "noonEndUtc": end,
                        "meridianTransitUtc": transit,
                        "samples": [
                            {
                                "t": float(grid[k]),
                                "altGeoDeg": round(float(geo.alt.deg[k]), 6),
                                "azDeg": round(float(geo.az.deg[k]), 6),
                                "altAppDeg": round(float(app_alt[k]), 6),
                            }
                            for k in range(len(grid))
                        ],
                    }
                )
            print(site["id"], night, flush=True)
    write("targets.json", {"targets": rows})


if __name__ == "__main__":
    main()
