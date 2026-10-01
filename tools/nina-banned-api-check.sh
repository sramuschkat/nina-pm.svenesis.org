#!/usr/bin/env bash
# Prüft die Zeitregel des Plugins (NT-05, TK 10.1, AP-16a): DateTime.Now in NinaPm.Core und NinaPm.Nina muss den
# Build mit RS0030 (BannedApiAnalyzers, apps/nina-plugin/BannedSymbols.txt) brechen – als Fehler, nicht als Warnung.
# Legt dafür kurz eine Datei mit DateTime.Now an, baut und entfernt sie wieder (auch bei Abbruch).
# Aufruf: tools/nina-banned-api-check.sh   (lokal und in plugin.yml, cross-build)
set -euo pipefail
cd "$(dirname "$0")/../apps/nina-plugin"

fail=0
for project in NinaPm.Core NinaPm.Nina; do
  probe="$project/__BannedApiProbe.cs"
  trap 'rm -f "$probe"' EXIT
  cat > "$probe" <<'CS'
namespace NinaPm.BannedApiProbe;
internal static class Probe
{
    internal static System.DateTime Now() => System.DateTime.Now;
}
CS
  out=$(dotnet build "$project" -c Release 2>&1 || true)
  rm -f "$probe"
  if grep -q "error RS0030" <<< "$out"; then
    echo "✓ $project: DateTime.Now bricht den Build (RS0030)"
  else
    echo "✗ $project: DateTime.Now hat den Build nicht gebrochen" >&2
    grep -E "RS0030|error|Fehler" <<< "$out" | head -5 >&2 || true
    fail=1
  fi
done
# Zurück auf einen sauberen Build ohne Probedatei.
dotnet build NinaPm.Nina -c Release >/dev/null
exit $fail
