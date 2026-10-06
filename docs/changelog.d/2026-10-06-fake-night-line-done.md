### Fake-Plugin-Nacht: erschöpfte Testzeile ist kein Fehler (2026-10-06)

Anforderungen: TK 17, AP-14c

- Macht die Fake-Nacht mit ihren Aufnahmen die geprüfte Zeile fertig, ändert sich das ETag der Ziele zu Recht (die Zeile wird nicht mehr ausgeliefert, FA-PRJ-12). Der Schritt „ETag unverändert nach Aufnahmen (NT-19)“ wird dann wie der Zähler übersprungen, mit dem Hinweis, das Soll im Testprojekt zu erhöhen – statt `pnpm deploy:prod` rot zu melden (Deploys #277/#278 am 06.10.2026).
