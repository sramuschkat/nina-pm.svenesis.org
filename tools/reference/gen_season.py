"""Saison je Ziel und Standort (FK 8.1, AP-10): nutzbare Zeit je Nacht über 365 Nächte und daraus
Saisonbeginn/-ende – unabhängig von der Engine mit astropy gerechnet.

Je Nacht wie die Engine (night.md §3, allocation.md §2/§3.1):
- Nachtfenster = bürgerliche Dämmerung (Sonne geometrisch −6°) ∓ 1 h, Beginn auf 5 min ab-, Ende auf
  5 min aufgerundet (UTC), begrenzt auf Mittag bis Mittag; Durchgänge aus einem 60-s-Raster linear verfeinert.
  Polarnacht (Sonne nie über −6°): Mittag bis Mittag; Polartag (nie unter −6°): 18:00 Standortzeit + 12 h.
- Slot (300 s) nutzbar, wenn an **beiden** Grenzen Sonne < Dämmerungsgrenze und scheinbare Zielhöhe ≥
  Mindesthöhe (Saemundsson aus der geometrischen Höhe).
- Nacht ausreichend, wenn der längste zusammenhängende Lauf ≥ Mindestzeit.
- Saisonende = letzte ausreichende Nacht, auf die ≥ 30 nicht ausreichende folgen; außerhalb der Saison
  zusätzlich Saisonbeginn = erste ausreichende Nacht.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
from astropy import units as u
from astropy.coordinates import AltAz, SkyCoord, get_body

from common import apparent, load_yaml, location, night_bounds, to_time, write

LIMITS = {"civil": -6.0, "nautical": -12.0, "astronomical": -18.0}
PAUSE = 30
CASES = [
    {"id": "ngc281-starfront", "site": "starfront", "target": "ngc281", "twilight": "astronomical", "minAltDeg": 30, "minTimeSec": 3600, "from": "2026-09-17"},
    {"id": "m31-hannover", "site": "hannover", "target": "m31", "twilight": "astronomical", "minAltDeg": 30, "minTimeSec": 3600, "from": "2026-09-17"},
    {"id": "m8-starfront", "site": "starfront", "target": "m8", "twilight": "astronomical", "minAltDeg": 30, "minTimeSec": 3600, "from": "2026-11-15"},
    # Hohe Breite: weiße Nächte, Polarnacht, Fenster am Rand der Polarnacht (Astronomie-Prüfung 28.09.2026)
    {"id": "ngc6946-tromso", "site": "tromso", "target": "ngc6946", "twilight": "nautical", "minAltDeg": 30, "minTimeSec": 3600, "from": "2026-09-17"},
]


def sun_alt(loc, unix_sec):
    t = to_time(unix_sec)
    return get_body("sun", t, loc).transform_to(AltAz(obstime=t, location=loc, pressure=0 * u.hPa)).alt.deg


def crossing(grid, values, level, direction):
    s = values - level > 0
    for i in np.nonzero(s[1:] != s[:-1])[0]:
        up = bool(s[i + 1])
        if up == (direction == "up"):
            a, b = values[i] - level, values[i + 1] - level
            return float(grid[i] + (grid[i + 1] - grid[i]) * a / (a - b))
    return None


def night_usable(site, loc, coord, case, night):
    start, end = night_bounds(site, night)
    # Anker wie die Engine (night.md §2): Antitransit = tiefster Sonnenstand im Mittag-bis-Mittag-Intervall,
    # Transits davor und danach; Abwärtsdurchgang dazwischen vor, Aufwärtsdurchgang nach dem Antitransit.
    grid = np.arange(start - 13 * 3600, end + 13 * 3600 + 1, 60.0)
    sun = sun_alt(loc, grid)
    inside = (grid >= start) & (grid <= end)
    k_anti = int(np.argmin(np.where(inside, sun, np.inf)))
    before = (grid >= grid[k_anti] - 13 * 3600) & (grid <= grid[k_anti])
    after = (grid >= grid[k_anti]) & (grid <= grid[k_anti] + 13 * 3600)
    k_tr0 = int(np.argmax(np.where(before, sun, -np.inf)))
    k_tr1 = int(np.argmax(np.where(after, sun, -np.inf)))
    h_min, h_max = float(sun[k_anti]), float(sun[k_tr0])
    dusk = crossing(grid[k_tr0 : k_anti + 1], sun[k_tr0 : k_anti + 1], -6.0, "down")
    dawn = crossing(grid[k_anti : k_tr1 + 1], sun[k_anti : k_tr1 + 1], -6.0, "up")
    if h_min <= -6.0 <= h_max and dusk is not None and dawn is not None:
        # night.md §3: ∓ 1 h, auf 5 min gerundet, begrenzt auf Mittag bis Mittag
        w0 = max(int(start), int(np.floor((dusk - 3600) / 300) * 300))
        w1 = min(int(end), int(np.ceil((dawn + 3600) / 300) * 300))
    elif h_max < -6.0:
        # Polarnacht: ganze Nacht von Mittag bis Mittag
        w0, w1 = int(start), int(end)
    else:
        # Polartag: 18:00 Standortzeit + 12 h
        w0 = int(start) + 6 * 3600
        w1 = w0 + 12 * 3600
    bounds = np.arange(w0, w1 + 1, 300.0)
    t = to_time(bounds)
    sun_b = sun_alt(loc, bounds)
    alt = apparent(coord.transform_to(AltAz(obstime=t, location=loc, pressure=0 * u.hPa)).alt.deg)
    ok_point = (sun_b < LIMITS[case["twilight"]]) & (alt >= case["minAltDeg"])
    ok = ok_point[:-1] & ok_point[1:]
    longest = cur = 0
    for v in ok:
        cur = cur + 1 if v else 0
        longest = max(longest, cur)
    return int(ok.sum()) * 300, longest * 300


def season(nights, min_time):
    ok = [n["longestRunSec"] >= min_time for n in nights]
    if True not in ok:
        return "never", None, None
    start = ok.index(True)
    end = None
    for i in range(start, len(ok)):
        if ok[i] and i + PAUSE < len(ok) and not any(ok[i + 1 : i + PAUSE + 1]):
            end = i
            break
    return (
        "in_season" if start == 0 else "out_of_season",
        None if start == 0 else nights[start]["night"],
        None if end is None else nights[end]["night"],
    )


def main():
    sites = {s["id"]: s for s in load_yaml("sites.yaml")}
    targets = {t["id"]: t for t in load_yaml("targets.yaml")}
    out = []
    for case in CASES:
        site = sites[case["site"]]
        tgt = targets[case["target"]]
        loc = location(site)
        coord = SkyCoord(ra=tgt["ra"] * u.deg, dec=tgt["dec"] * u.deg, frame="icrs")
        first = dt.date.fromisoformat(case["from"])
        nights = []
        for i in range(365):
            night = (first + dt.timedelta(days=i)).isoformat()
            usable, longest = night_usable(site, loc, coord, case, night)
            nights.append({"night": night, "usableSec": usable, "longestRunSec": longest})
        status, start, end = season(nights, case["minTimeSec"])
        out.append({**case, "raJ2000Deg": tgt["ra"], "decJ2000Deg": tgt["dec"], "status": status, "seasonStart": start, "seasonEnd": end, "nights": nights})
        print(case["id"], status, start, end, flush=True)
    write("season.json", {"cases": out})


if __name__ == "__main__":
    main()
