"""Katalog-Epochen → BJD_TDB (transit.md §1, AP-40): Referenzwerte für `normalizeEpoch` der Engine.

Je Epoche (1999–2030, über die Schaltsekunden 2006/2009/2012/2015/2017 hinweg) und Ziel:
- `taiMinusUtcS`: TAI − UTC zum Datum der Epoche (astropy, Tabelle aus erfa);
- `tdbMinusUtcS`: TDB − UTC zur Epoche (astropy, TDB−TT nach erfa `dtdb` am Geozentrum);
- `sunDelayS`: BJD − HJD = Lichtlaufzeit baryzentrisch minus heliozentrisch (`light_travel_time`, de432s),
  also `(r⃗_Sonne,bary · n̂)/c`. Der topozentrische Anteil fällt in der Differenz heraus (Geozentrum).
- `bjdTdbFromBjdUtc` und `bjdTdbFromHjdUtc`: das Ergebnis des Imports für dieselbe Zahl als BJD_UTC bzw. HJD_UTC.
"""
from __future__ import annotations

from astropy import units as u
from astropy.coordinates import EarthLocation, SkyCoord
from astropy.time import Time

from common import write

GEOCENTRE = EarthLocation.from_geocentric(0 * u.m, 0 * u.m, 0 * u.m)

# Epochen als JD (UTC-Zahl): Katalogepochen real ab 1999 (HD 209458 b 2003, TrES-1 b 2004), TESS ab 2018.
EPOCHS = [
    2451200.25,  # 1999-01-22 (32 s)
    2452826.8795,  # 2003-07-06 (HD 209458 b)
    2453186.8061,  # 2004-06-30 (TrES-1 b)
    2454000.5,  # 2006-09-21 (33 s)
    2455000.5,  # 2009-06-18 (34 s)
    2456108.4,  # 2012-06-29, vor der Schaltsekunde (34 s; der Schalttag selbst ist in astropy gedehnt)
    2456109.6,  # 2012-07-01, danach (35 s)
    2457300.5,  # 2015-10-05 (36 s)
    2458000.5,  # 2017-09-04 (37 s)
    2459500.5,  # 2021-10-09
    2461300.5,  # 2026-09-17
    2462500.5,  # 2029-12-31
]

# Ziele über die ganze Sphäre (ICRS, Grad) – u. a. nahe der Ekliptik (größter Sonnenversatz) und an den Polen.
TARGETS = [
    {"id": "hat-p-17", "raDeg": 324.5360, "decDeg": 30.4885},
    {"id": "hd-209458", "raDeg": 330.7950, "decDeg": 18.8843},
    {"id": "wasp-19", "raDeg": 148.4167, "decDeg": -45.6590},
    {"id": "ecliptic-0", "raDeg": 0.0, "decDeg": 0.0},
    {"id": "ecliptic-90", "raDeg": 90.0, "decDeg": 23.4393},
    {"id": "ecliptic-180", "raDeg": 180.0, "decDeg": 0.0},
    {"id": "ecliptic-270", "raDeg": 270.0, "decDeg": -23.4393},
    {"id": "north", "raDeg": 45.0, "decDeg": 85.0},
    {"id": "south", "raDeg": 225.0, "decDeg": -80.0},
]


def main() -> None:
    cases = []
    for jd in EPOCHS:
        t = Time(jd, format="jd", scale="utc", location=GEOCENTRE)
        tai_utc = (t.tai.jd1 - t.utc.jd1 + t.tai.jd2 - t.utc.jd2) * 86400.0
        tdb_utc = (t.tdb.jd1 - t.utc.jd1 + t.tdb.jd2 - t.utc.jd2) * 86400.0
        t_tdb = t.tdb
        for target in TARGETS:
            coord = SkyCoord(ra=target["raDeg"] * u.deg, dec=target["decDeg"] * u.deg, frame="icrs")
            bary = t_tdb.light_travel_time(coord, kind="barycentric", location=GEOCENTRE)
            helio = t_tdb.light_travel_time(coord, kind="heliocentric", location=GEOCENTRE)
            sun_delay = float((bary - helio).to_value(u.s))
            cases.append(
                {
                    "id": f"{target['id']}@{jd}",
                    "jd": jd,
                    "raDeg": target["raDeg"],
                    "decDeg": target["decDeg"],
                    "taiMinusUtcS": round(tai_utc, 6),
                    "tdbMinusUtcS": round(tdb_utc, 6),
                    "sunDelayS": round(sun_delay, 6),
                    "bjdTdbFromBjdUtc": round(jd + tdb_utc / 86400.0, 9),
                    "bjdTdbFromHjdUtc": round(jd + (tdb_utc + sun_delay) / 86400.0, 9),
                }
            )
    write("exo_epochs.json", {"cases": cases})


if __name__ == "__main__":
    main()
