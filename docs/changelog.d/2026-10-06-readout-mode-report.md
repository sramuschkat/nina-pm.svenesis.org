### Auslesemodus-Abgleich mit NINA (FA-KAM-07) (2026-10-06)

Anforderungen: FA-KAM-07

- Der Server speichert die Auslesemodi, die das Plugin bei jedem Heartbeat meldet (`cameraReadoutModes`, nach Index sortiert), bei der Kamera des Rigs (`camera.nina_reported`). Die Kameraseite zeigt damit den schon vorhandenen Hinweis „NINA meldet abweichende Auslesemodi“ mit fehlenden bzw. überzähligen Namen. Vorher schrieb kein Code die Spalte, der Hinweis erschien nie (Rig-Einrichtung 06.10.2026).
- Reine Anzeige: `settings_version` und `updated_at` der Kamera bleiben; geschrieben wird nur bei geänderter Liste oder höchstens stündlich; eine leere Meldung (Kamera getrennt) überschreibt nichts. Quittieren (`nina_report_dismissed_hash`) folgt bei Bedarf.
