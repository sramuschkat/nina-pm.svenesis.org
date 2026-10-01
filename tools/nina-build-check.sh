#!/usr/bin/env bash
# Prüft gebaute Plugin-Projekte (TK 10.5, ADR-S2c) – lokal (macOS, Linux) und im CI (plugin.yml, cross-build):
#   1. Keine DLL unter apps/nina-plugin/ oder spikes/ im Git.
#   2. Jedes Projekt mit NINA.Plugin löst alle Pakete NINA.* in genau der Version $(NinaVersion) auf
#      (apps/nina-plugin/Directory.Build.props) – sonst übersetzt der Code gegen eine andere NINA als die installierte.
#      Ausgenommen NINA.Accord.*: NINAs Abspaltung von Accord.NET mit eigener Versionsnummer.
#   3. Die Ausgabe dieser Projekte (bin/<Konfiguration>/) enthält nur DLLs eigener Projekte und der mit --allow
#      genannten eigenen Abhängigkeiten (z. B. Jint, Polly). NINA-Assemblies und was NINA mitbringt, gehören nicht hinein.
#      Testprojekte (*.Tests) sind davon ausgenommen – sie laufen mit NINA-Assemblies und werden nie ausgeliefert.
#
# Aufruf (nach dem Build): tools/nina-build-check.sh [--config Release] [--allow Jint,Polly] <ordner>
set -euo pipefail

config=Release
allow=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) config="$2"; shift 2 ;;
    --allow) allow="$2"; shift 2 ;;
    *) root="$1"; shift ;;
  esac
done
: "${root:?Ordner mit Plugin-Projekten angeben}"

fail=0
err() { echo "✗ $*" >&2; fail=1; }

# 1. Keine DLL im Git
committed=$(git ls-files -- '*.dll' | grep -E '^(apps/nina-plugin|spikes)/' || true)
[[ -z "$committed" ]] || err "DLL im Git: $committed"

projects=$(find "$root" -name '*.csproj' -not -path '*/bin/*' -not -path '*/obj/*' | sort)
own=""
for p in $projects; do own+="$(dotnet msbuild "$p" -getProperty:AssemblyName).dll "; done
for a in ${allow//,/ }; do own+="$a.dll "; done

for p in $projects; do
  grep -q 'Include="NINA.Plugin"' "$p" || continue
  name=$(basename "$p" .csproj)
  want=$(dotnet msbuild "$p" -getProperty:NinaVersion)
  [[ -n "$want" ]] || { err "$name: NinaVersion nicht gesetzt"; continue; }
  before=$fail; fail=0

  # 2. NINA-Pakete in genau einer Version
  versions=$(dotnet list "$p" package --include-transitive --format json |
    jq -r '.projects[].frameworks[]? | (.topLevelPackages // []) + (.transitivePackages // []) | .[] |
           select((.id | startswith("NINA.")) and (.id | startswith("NINA.Accord.") | not)) |
           "\(.id) \(.resolvedVersion)"' | sort -u)
  [[ -n "$versions" ]] || err "$name: keine NINA-Pakete aufgelöst (vorher bauen)"
  while read -r id version; do
    [[ -z "$id" || "$version" == "$want" ]] || err "$name: $id $version statt $want"
  done <<< "$versions"

  # 3. Ausgabe nur mit eigenen DLLs – nicht bei Testprojekten (*.Tests): der Test-Host braucht NINA zur Laufzeit,
  #    ausgeliefert werden sie nie.
  if [[ "$name" == *.Tests ]]; then
    [[ $fail -eq 1 ]] || echo "✓ $name: NINA $want, $(echo "$versions" | wc -l | tr -d ' ') Pakete (Testprojekt, Ausgabe nicht geprüft)"
    [[ $before -eq 0 ]] || fail=1
    continue
  fi
  out="$(dirname "$p")/bin/$config"
  [[ -d "$out" ]] || { err "$name: $out fehlt (vorher mit -c $config bauen)"; continue; }
  while IFS= read -r dll; do
    [[ " $own " == *" $(basename "$dll") "* ]] || err "$name: fremde DLL in der Ausgabe: ${dll#"$out"/}"
  done < <(find "$out" -name '*.dll')
  [[ $fail -eq 1 ]] || echo "✓ $name: NINA $want, $(echo "$versions" | wc -l | tr -d ' ') Pakete, Ausgabe sauber"
  [[ $before -eq 0 ]] || fail=1
done

exit $fail
