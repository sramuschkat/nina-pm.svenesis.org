"""Sonne und Mond je Standort und Nacht (TK 9.1): Dämmerung −6/−12/−18°, Sonnenauf-/-untergang
(−0,8333° geometrisch), Himmelsflats −8/−2° (NT-40), Mondauf-/-untergang (scheinbare Mitte = 0°),
Mond RA/Dec topozentrisch, scheinbare Höhe und Beleuchtung (geozentrisch) je 30 min.
Enthält beide Referenznächte der Nachtfenster-Rundung: Starfront 2026-09-15 und 2026-09-17 (WS-28)."""
from __future__ import annotations

import math

import numpy as np
from astropy import units as u
from astropy.coordinates import AltAz, TETE, get_body

from common import apparent, bisect, crossings, load_yaml, location, night_bounds, to_time, transitions, write

LEVELS = {"sun": -0.8333, "civil": -6.0, "nautical": -12.0, "astronomical": -18.0, "flats8": -8.0, "flats2": -2.0}
MONTHLY = [f"2026-{m:02d}-15" for m in range(1, 13)]
EXTRA = {
    "starfront": ["2026-09-15", "2026-09-17", "2026-09-18", "2026-09-19"],
    "hannover": ["2026-06-21", "2026-07-29"],
    # Rand der Polarnacht und weiße Nächte (Astronomie-Prüfung 28.09.2026)
    "tromso": ["2026-01-17", "2026-05-10", "2026-11-25"],
    "longyearbyen": ["2026-02-15", "2026-04-15", "2026-11-12"],
    "casey": ["2026-06-21", "2026-12-21"],
}


def sun_alt(loc, t):
    return get_body("sun", t, loc).transform_to(AltAz(obstime=t, location=loc, pressure=0 * u.hPa)).alt.deg


def moon_geo_alt(loc, t):
    return get_body("moon", t, loc).transform_to(AltAz(obstime=t, location=loc, pressure=0 * u.hPa)).alt.deg


def moon_app_alt(loc, t):
    return apparent(moon_geo_alt(loc, t))


def night_entry(site, night):
    loc = location(site)
    start, end = night_bounds(site, night)
    grid = np.arange(start, end + 1, 60.0)
    t = to_time(grid)
    # Anker wie die Engine (night.md §2, Astronomie-Prüfung 28.09.2026): Antitransit = tiefster Sonnenstand
    # zwischen den Mittagen, Transits davor und danach; Durchgänge nur in diesen Intervallen – in hohen Breiten
    # liegen sie sonst außerhalb von Mittag bis Mittag und fehlten in der Referenz.
    wide = np.arange(start - 13 * 3600, end + 13 * 3600 + 1, 60.0)
    sun_w = sun_alt(loc, to_time(wide))
    inside = (wide >= start) & (wide <= end)
    k_anti = int(np.argmin(np.where(inside, sun_w, np.inf)))
    before = (wide >= wide[k_anti] - 13 * 3600) & (wide <= wide[k_anti])
    after = (wide >= wide[k_anti]) & (wide <= wide[k_anti] + 13 * 3600)
    k_tr0 = int(np.argmax(np.where(before, sun_w, -np.inf)))
    k_tr1 = int(np.argmax(np.where(after, sun_w, -np.inf)))
    hmin, hmax = float(sun_w[k_anti]), float(sun_w[k_tr0])
    f = lambda x: float(sun_alt(loc, to_time(x)))
    events = {}
    for name, level in LEVELS.items():
        down = up = None
        if hmin <= level <= hmax:
            d = [c for c in crossings(wide[k_tr0 : k_anti + 1], sun_w[k_tr0 : k_anti + 1], f, level) if c["direction"] == "down"]
            u_ = [c for c in crossings(wide[k_anti : k_tr1 + 1], sun_w[k_anti : k_tr1 + 1], f, level) if c["direction"] == "up"]
            down = d[-1]["t"] if d else None
            up = u_[0]["t"] if u_ else None
        events[name] = {
            "h0": level,
            "down": down,
            "up": up,
            "grazing": min(abs(hmin - level), abs(hmax - level)) < 0.5,
        }
    moon_app = moon_app_alt(loc, t)
    moon_events = crossings(grid, moon_app, lambda x: float(moon_app_alt(loc, to_time(x))), 0.0)

    samples_unix = np.arange(start, end, 1800.0)
    ts = to_time(samples_unix)
    topo = get_body("moon", ts, loc).transform_to(TETE(obstime=ts, location=loc))
    app_alt = moon_app_alt(loc, ts)
    geo_moon = get_body("moon", ts)
    geo_sun = get_body("sun", ts)
    psi = geo_sun.separation(geo_moon).deg
    dm = geo_moon.distance.to(u.km).value
    ds = geo_sun.distance.to(u.km).value
    moon = []
    for k in range(len(samples_unix)):
        i = math.atan2(ds[k] * math.sin(math.radians(psi[k])), dm[k] - ds[k] * math.cos(math.radians(psi[k])))
        moon.append(
            {
                "t": float(samples_unix[k]),
                "raTopoDeg": round(float(topo.ra.deg[k]), 6),
                "decTopoDeg": round(float(topo.dec.deg[k]), 6),
                "altAppDeg": round(float(app_alt[k]), 6),
                "illumPct": round(100 * (1 + math.cos(i)) / 2, 4),
            }
        )
    return {
        "site": site["id"],
        "night": night,
        "noonStartUtc": start,
        "noonEndUtc": end,
        "sunMinAltDeg": round(hmin, 4),
        "sunMaxAltDeg": round(hmax, 4),
        "sun": events,
        "moonEvents": [{"type": "rise" if c["direction"] == "up" else "set", "t": c["t"]} for c in moon_events],
        "moon": moon,
    }


def main():
    sites = load_yaml("sites.yaml")
    out_sites, nights = [], []
    for site in sites:
        out_sites.append({**site, "timeZoneTransitions": transitions(site)})
        for night in MONTHLY + EXTRA.get(site["id"], []):
            nights.append(night_entry(site, night))
            print(site["id"], night, flush=True)
    write("sun_moon.json", {"sites": out_sites, "nights": nights})


if __name__ == "__main__":
    main()
