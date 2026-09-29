### Probe-Plugin lädt in NINA: Plugin-ID über das `Guid`-Attribut (2026-09-28)

Bezug: AP-S2b (Spike), ADR-S2b · VM-Test Sven 28.09.2026

- **Fehler:** NINA 3.2 hat `NinaPm.Probe.dll` nicht geladen. Das Plugin fehlte in der Liste, und im Log stand nur auf Trace-Stufe eine `KeyNotFoundException: GuidAttribute`.
- **Ursache:** NINAs `PluginBase` liest die Plugin-ID aus dem `GuidAttribute` der Assembly; der Eintrag `AssemblyMetadata("Identifier")` wird dafür nicht gelesen. Ohne `Guid` bricht das Manifest ab, und auch die Fehlerbehandlung scheitert daran.
- **Behebung:** In `spikes/nina-probe/NinaProbe.csproj` sind `GuidAttribute` und `Description` (`AssemblyDescription`) ergänzt. Der Befund steht in ADR-S2b als Vorgabe für AP-16a.
- **Anleitung:** Neustart-Hinweis und Menüpfad für den Meridian-Flip (*Optionen → Bildaufnahme → Meridian Flip*, Trigger in *Globale Trigger*) in `spikes/nina-probe/README.md` korrigiert. Im ADR-S2b ist der Versionsabgleich `NINA.Sequencer.dll` = 3.2.0.9001 (Sven, VM) eingetragen.
