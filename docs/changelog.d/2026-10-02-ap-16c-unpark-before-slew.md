### AP-16c – Nach Safety-Pause vor dem Slew entparken

- NINA prüft Schleifenbedingungen nach jeder Anweisung und überspringt *Unpark Scope* im Sicherungscontainer, sobald *Loop While Unsafe* falsch wird; im P-25-Lauf startete der Zielcontainer mit geparkter Montierung („Telescope is parked“, Zentrieren alle 15 s erneut). NINA-PM entparkt jetzt vor jedem Slew selbst, wenn die verbundene Montierung geparkt ist (Warnung `mount_unparked`, neuer Wert in `pluginWarningCodes`). `execution.md` §4.6 ergänzt.
