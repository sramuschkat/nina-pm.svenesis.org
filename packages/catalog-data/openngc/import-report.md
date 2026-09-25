# Importbericht Objektkatalog (OpenNGC v20260501, abgerufen 2026-09-25)

Erzeugt von `pnpm catalog:build` nach `docs/specs/catalog/dso-import.md` – nicht von Hand ändern.

| Größe | Wert |
|---|---|
| Zeilen `NGC.csv` | 13969 |
| Zeilen `addendum.csv` (`n_addendum`) | 64 |
| Quellzeilen zusammen | 13969 + 64 = 14033 |
| davon `Dup` (Alias statt Zeile) | 652 |
| davon `NonEx` (Liste `nonexistent`) | 10 |
| zusammengeführt (dasselbe Himmelsobjekt) | 4 |
| Sharpless-Regionen aus dem Auszug (ohne OpenNGC-Zeile) | 265 |
| **Zeilen in `dso_object`** | **13632** |

## Zusammengeführt

- IC 4703 → NGC 6611 (Auszug: M16 = IC 4703)
- NGC 6839 → NGC 6838 (Auszug: M71 = NGC 6839)
- C 14 → NGC 869 (Auszug: NGC 869 = C 14)
- NGC 4562 → NGC 4565 (Auszug: NGC 4565 = NGC 4562)

## Nicht existent (OpenNGC `NonEx`)

IC 67, IC 68, IC 1064, IC 1326, IC 1642, IC 2688, IC 2915, IC 3398, IC 5112, NGC 412

## Importwarnungen (118)

- Auszug IC 3322 A: keine OpenNGC-Zeile
- Dup IC 3543: OpenNGC-Ziel NGC 4565C widerspricht dem kuratierten Auszug (NGC 4565) – Auszug gilt
- Dup IC 3546: OpenNGC-Ziel NGC 4565B widerspricht dem kuratierten Auszug (NGC 4565) – Auszug gilt
- Dup M 102: OpenNGC-Ziel NGC 5457 widerspricht dem kuratierten Auszug (NGC 5866) – Auszug gilt
- Bezeichnung IC 4414 an IC 1008 NED01 entfällt – gehört zu IC 1008
- Bezeichnung IC 4414 an IC 1008 NED02 entfällt – gehört zu IC 1008
- Bezeichnung IC 5265 an NGC 7418 entfällt – gehört zu IC 1459
- Bezeichnung IC 4518 an IC 4518A entfällt – gehört zu IC 4518
- Bezeichnung IC 4518 an IC 4518B entfällt – gehört zu IC 4518
- Bezeichnung IC 4687 an IC 4686 entfällt – gehört zu IC 4687
- Bezeichnung IC 4687 an IC 4689 entfällt – gehört zu IC 4687
- Bezeichnung IC 1546 an NGC 85B entfällt – gehört zu NGC 85
- Bezeichnung IC 1559 an NGC 169A entfällt – gehört zu NGC 169
- Bezeichnung NGC 190 an NGC 190 NED01 entfällt – gehört zu NGC 190
- Bezeichnung NGC 190 an NGC 190 NED02 entfällt – gehört zu NGC 190
- Bezeichnung IC 1563 an NGC 191A entfällt – gehört zu NGC 191
- Bezeichnung NGC 232 an NGC 235A entfällt – gehört zu NGC 232
- Bezeichnung NGC 454 an NGC 454 NED01 entfällt – gehört zu NGC 454
- Bezeichnung NGC 454 an NGC 454 NED02 entfällt – gehört zu NGC 454
- Bezeichnung NGC 554 an NGC 554A entfällt – gehört zu NGC 554
- Bezeichnung NGC 704 an NGC 704B entfällt – gehört zu NGC 704
- Bezeichnung NGC 745 an NGC 745 NED01 entfällt – gehört zu NGC 745
- Bezeichnung NGC 764 an NGC 755 entfällt – gehört zu NGC 764
- Bezeichnung NGC 838 an NGC 835 entfällt – gehört zu NGC 838
- Bezeichnung NGC 838 an NGC 839 entfällt – gehört zu NGC 838
- Bezeichnung C 14 an NGC 884 entfällt – gehört zu NGC 869
- Bezeichnung NGC 877 an NGC 876 entfällt – gehört zu NGC 877
- Bezeichnung NGC 1380 an NGC 1382 entfällt – gehört zu NGC 1380
- Bezeichnung NGC 1487 an NGC 1487 NED01 entfällt – gehört zu NGC 1487
- Bezeichnung NGC 1524 an NGC 1516A entfällt – gehört zu NGC 1516
- Bezeichnung NGC 1525 an NGC 1516B entfällt – gehört zu NGC 1516
- Bezeichnung IC 381 an NGC 1530A entfällt – gehört zu NGC 1530
- Bezeichnung C 49 an NGC 2238 entfällt – gehört zu NGC 2237
- Bezeichnung NGC 2388 an NGC 2389 entfällt – gehört zu NGC 2388
- Bezeichnung NGC 2402 an NGC 2402 NED02 entfällt – gehört zu NGC 2402
- Bezeichnung IC 2411 an NGC 2667B entfällt – gehört zu NGC 2667
- Bezeichnung IC 2449 an NGC 2783B entfällt – gehört zu NGC 2783
- Bezeichnung IC 2458 an NGC 2820A entfällt – gehört zu NGC 2820
- Bezeichnung NGC 2957 an NGC 2957A entfällt – gehört zu NGC 2957
- Bezeichnung NGC 2959 an NGC 2961 entfällt – gehört zu NGC 2959
- Bezeichnung IC 573 an NGC 3058 NED02 entfällt – gehört zu NGC 3058
- Bezeichnung IC 617 an NGC 3280B entfällt – gehört zu NGC 3280
- Bezeichnung NGC 3690 an NGC 3690A entfällt – gehört zu NGC 3690
- Bezeichnung NGC 3690 an NGC 3690B entfällt – gehört zu NGC 3690
- Bezeichnung IC 2887 an NGC 3705A entfällt – gehört zu NGC 3705
- Bezeichnung NGC 3917 an NGC 3931 entfällt – gehört zu NGC 3917
- Bezeichnung NGC 3991 an NGC 3991 NED01 entfällt – gehört zu NGC 3991
- Bezeichnung NGC 3991 an NGC 3991 NED02 entfällt – gehört zu NGC 3991
- Bezeichnung IC 2982 an NGC 4004B entfällt – gehört zu NGC 4004
- Bezeichnung NGC 4125 an NGC 4081 entfällt – gehört zu NGC 4125
- Bezeichnung NGC 4303 an NGC 4301 entfällt – gehört zu NGC 4303
- Bezeichnung IC 3211 an NGC 4307A entfällt – gehört zu NGC 4307
- Bezeichnung IC 3274 an NGC 4360B entfällt – gehört zu NGC 4360
- Bezeichnung IC 790 an NGC 4410C entfällt – gehört zu NGC 4410
- Bezeichnung NGC 4505 an NGC 4496A entfällt – gehört zu NGC 4496
- Bezeichnung IC 3550 an NGC 4559C entfällt – gehört zu NGC 4559
- Bezeichnung IC 3592 an NGC 4559A entfällt – gehört zu NGC 4559
- Bezeichnung IC 3593 an NGC 4559B entfällt – gehört zu NGC 4559
- Bezeichnung IC 3543 an NGC 4565C entfällt – gehört zu NGC 4565
- Bezeichnung IC 3546 an NGC 4565B entfällt – gehört zu NGC 4565
- Bezeichnung NGC 4656 an NGC 4657 entfällt – gehört zu NGC 4656
- Bezeichnung NGC 4650 an NGC 4661 entfällt – gehört zu NGC 4650
- Bezeichnung IC 819 an NGC 4676B entfällt – gehört zu NGC 4676A
- Bezeichnung NGC 4676 an NGC 4676B entfällt – gehört zu NGC 4676
- Bezeichnung NGC 4759 an NGC 4776 entfällt – gehört zu NGC 4759
- Bezeichnung NGC 4759 an NGC 4778 entfällt – gehört zu NGC 4759
- Bezeichnung IC 4016 an NGC 4893A entfällt – gehört zu NGC 4893
- Bezeichnung NGC 4898 an NGC 4898A entfällt – gehört zu NGC 4898
- Bezeichnung NGC 4898 an NGC 4898B entfällt – gehört zu NGC 4898
- Bezeichnung IC 4173 an NGC 4933A entfällt – gehört zu NGC 4933
- Bezeichnung IC 4176 an NGC 4933B entfällt – gehört zu NGC 4933
- Bezeichnung IC 4210 an NGC 5004B entfällt – gehört zu NGC 5004
- Bezeichnung NGC 5100 an NGC 5106 entfällt – gehört zu NGC 5100
- Bezeichnung NGC 5331 an NGC 5331 NED01 entfällt – gehört zu NGC 5331
- Bezeichnung NGC 5331 an NGC 5331 NED02 entfällt – gehört zu NGC 5331
- Bezeichnung NGC 5457 an NGC 5450 entfällt – gehört zu NGC 5457
- Bezeichnung NGC 5457 an NGC 5461 entfällt – gehört zu NGC 5457
- Bezeichnung IC 4383 an NGC 5504B entfällt – gehört zu NGC 5504
- Bezeichnung IC 1016 an NGC 5619B entfällt – gehört zu NGC 5619
- Bezeichnung IC 4424 an NGC 5619B entfällt – gehört zu NGC 5619
- Bezeichnung NGC 5734 an NGC 5743 entfällt – gehört zu NGC 5734
- Bezeichnung IC 1179 an NGC 6050B entfällt – gehört zu NGC 6050
- Bezeichnung NGC 6076 an NGC 6076 NED01 entfällt – gehört zu NGC 6076
- Bezeichnung NGC 6076 an NGC 6076 NED02 entfällt – gehört zu NGC 6076
- Bezeichnung NGC 6175 an NGC 6175 NED01 entfällt – gehört zu NGC 6175
- Bezeichnung NGC 6286 an NGC 6285 entfällt – gehört zu NGC 6286
- Bezeichnung NGC 6471 an NGC 6471 NED01 entfällt – gehört zu NGC 6471
- Bezeichnung NGC 6471 an NGC 6471 NED02 entfällt – gehört zu NGC 6471
- Bezeichnung NGC 6493 an NGC 6491 entfällt – gehört zu NGC 6493
- Bezeichnung NGC 6621 an NGC 6622 entfällt – gehört zu NGC 6621
- Bezeichnung NGC 6670 an NGC 6670A entfällt – gehört zu NGC 6670
- Bezeichnung NGC 6670 an NGC 6670B entfällt – gehört zu NGC 6670
- Bezeichnung NGC 6670 an NGC 6670 NED03 entfällt – gehört zu NGC 6670
- Bezeichnung NGC 6861 an NGC 6851 entfällt – gehört zu NGC 6861
- Bezeichnung IC 4945 an NGC 6876A entfällt – gehört zu NGC 6876
- Bezeichnung IC 5120 an NGC 7096A entfällt – gehört zu NGC 7096
- Bezeichnung NGC 7204 an NGC 7204A entfällt – gehört zu NGC 7204
- Bezeichnung NGC 7204 an NGC 7204B entfällt – gehört zu NGC 7204
- Bezeichnung IC 5195 an NGC 7242 NED02 entfällt – gehört zu NGC 7242
- Bezeichnung IC 1459 an NGC 7368 entfällt – gehört zu IC 1459
- Bezeichnung IC 1459 an NGC 7418 entfällt – gehört zu IC 1459
- Bezeichnung IC 1452 an NGC 7374B entfällt – gehört zu NGC 7374
- Bezeichnung NGC 7592 an NGC 7592A entfällt – gehört zu NGC 7592
- Bezeichnung NGC 7592 an NGC 7592B entfällt – gehört zu NGC 7592
- Bezeichnung NGC 7592 an NGC 7592C entfällt – gehört zu NGC 7592
- Bezeichnung NGC 7771 an NGC 7769 entfällt – gehört zu NGC 7771
- Bezeichnung NGC 7771 an NGC 7770 entfällt – gehört zu NGC 7771
- Katalogkürzel BD nicht in dsoCatalogPrefixes – nur in names, nicht in catalogs
- Katalogkürzel H nicht in dsoCatalogPrefixes – nur in names, nicht in catalogs
- Katalogkürzel HCG nicht in dsoCatalogPrefixes – nur in names, nicht in catalogs
- Katalogkürzel HD nicht in dsoCatalogPrefixes – nur in names, nicht in catalogs
- Katalogkürzel HIP nicht in dsoCatalogPrefixes – nur in names, nicht in catalogs
- Katalogkürzel MWSC nicht in dsoCatalogPrefixes – nur in names, nicht in catalogs
- Katalogkürzel SAO nicht in dsoCatalogPrefixes – nur in names, nicht in catalogs
- Katalogkürzel TYC nicht in dsoCatalogPrefixes – nur in names, nicht in catalogs
- Katalogkürzel Toby nicht in dsoCatalogPrefixes – nur in names, nicht in catalogs
- Katalogkürzel UGCA nicht in dsoCatalogPrefixes – nur in names, nicht in catalogs
- Katalogkürzel WDS nicht in dsoCatalogPrefixes – nur in names, nicht in catalogs
