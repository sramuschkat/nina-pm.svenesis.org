"""Transitmitten BJD_TDB → UTC am Standort (transit.md §1/§4, AP-41): Referenz für `bjdTdbToJdUtc` der Engine.

Je Planet aus `transits.yaml` die Epochen nahe sieben Daten über mehr als ein Jahr (Abstand ≥ 2 Monate, der
Rømer-Term wechselt das Vorzeichen). Umkehrung mit astropy: gesucht ist die UTC-Zeit `t` am Standort Starfront
mit `t.tdb + light_travel_time(kind='barycentric') = Tc_bjd` (Newton, drei Schritte, Rest < 1 µs). Dazu die
Lichtlaufzeit, TDB − UTC, die geometrische Sonnenhöhe und die scheinbare Zielhöhe (Saemundsson wie die Engine)
zur Transitmitte – für die Beobachtbarkeit.
"""
from __future__ import annotations

import datetime as dt

from astropy import units as u
from astropy.coordinates import AltAz, SkyCoord, get_body
from astropy.time import Time

from common import apparent, load_yaml, location, write

DATES = ["2026-01-10", "2026-03-25", "2026-06-08", "2026-08-22", "2026-09-18", "2026-11-05", "2027-01-20"]
SITE = "starfront"


def jd_of(date: str) -> float:
    d = dt.date.fromisoformat(date)
    return d.toordinal() - dt.date(2000, 1, 1).toordinal() + 2451544.5 + 0.5


def invert(tc_bjd: float, coord: SkyCoord, loc) -> Time:
    t = Time(tc_bjd, format="jd", scale="utc", location=loc)
    for _ in range(3):
        bjd = t.tdb + t.light_travel_time(coord, kind="barycentric", location=loc)
        t = t - (bjd - Time(tc_bjd, format="jd", scale="tdb"))
    return t


def main() -> None:
    site = next(s for s in load_yaml("sites.yaml") if s["id"] == SITE)
    loc = location(site)
    cases = []
    for p in load_yaml("transits.yaml"):
        coord = SkyCoord(ra=p["ra"] * u.deg, dec=p["dec"] * u.deg, frame="icrs")
        for date in DATES:
            n = round((jd_of(date) - p["t0"]) / p["period"])
            tc_bjd = p["t0"] + n * p["period"]
            t = invert(tc_bjd, coord, loc)
            ltt = float(t.light_travel_time(coord, kind="barycentric", location=loc).to_value(u.s))
            tdb_utc = (t.tdb.jd1 - t.utc.jd1 + t.tdb.jd2 - t.utc.jd2) * 86400.0
            frame = AltAz(obstime=t, location=loc, pressure=0 * u.hPa)
            sun_alt = float(get_body("sun", t, loc).transform_to(frame).alt.deg)
            target_alt = float(apparent(coord.transform_to(frame).alt.deg))
            cases.append(
                {
                    "id": f"{p['id']}@{date}",
                    "planet": p["id"],
                    "raDeg": p["ra"],
                    "decDeg": p["dec"],
                    "n": n,
                    "tcBjdTdb": round(tc_bjd, 9),
                    "tcUnixUtc": round(float(t.unix), 3),
                    "lttS": round(ltt, 4),
                    "tdbMinusUtcS": round(tdb_utc, 4),
                    "sunAltDeg": round(sun_alt, 4),
                    "targetAltDeg": round(target_alt, 4),
                }
            )
    write("transits.json", {"site": SITE, "lat": site["lat"], "lon": site["lon"], "cases": cases})


if __name__ == "__main__":
    main()
