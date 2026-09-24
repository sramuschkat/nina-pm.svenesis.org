"""Alle Referenz-Fixtures erzeugen (TK 9.1): `python gen_all.py` bzw. `uv run gen_all.py`."""
import gen_season
import gen_sun_moon
import gen_targets

if __name__ == "__main__":
    gen_sun_moon.main()
    gen_targets.main()
    gen_season.main()
