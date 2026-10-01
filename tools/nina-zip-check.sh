#!/usr/bin/env bash
# Prüft den Inhalt des Plugin-Ordners vor dem ZIP (TK 10.5, AP-16a): eigene Assemblies und die mitgelieferten
# Abhängigkeiten Jint, Microsoft.Data.Sqlite (mit nativem e_sqlite3.dll im Wurzelordner) und Polly sind da;
# keine NINA-Assembly und kein Newtonsoft.Json – beides bringt NINA mit (zwei Versionen im Prozess = Ladefehler).
# Aufruf: tools/nina-zip-check.sh <ordner>   (plugin.yml, Auftrag build)
set -euo pipefail
dir="${1:?Ordner angeben}"
fail=0
err() { echo "✗ $*" >&2; fail=1; }

for need in NinaPm.Nina.dll NinaPm.Nina.Ui.dll NinaPm.Core.dll Jint.dll Microsoft.Data.Sqlite.dll Polly.dll e_sqlite3.dll; do
  [[ -f "$dir/$need" ]] || err "fehlt: $need"
done
while IFS= read -r f; do
  base=$(basename "$f")
  case "$base" in
    NINA.*.dll|Newtonsoft.Json.dll|System.ComponentModel.Composition.dll|Microsoft.Xaml.Behaviors.dll) err "gehört nicht hinein: ${f#"$dir"/}" ;;
  esac
done < <(find "$dir" -name '*.dll')
[[ -d "$dir/runtimes" ]] && err "runtimes/ im Plugin-Ordner – natives SQLite muss flach neben der Assembly liegen"
[[ $fail -eq 0 ]] && echo "✓ $dir: $(find "$dir" -name '*.dll' | wc -l | tr -d ' ') DLLs, Abhängigkeiten vollständig, nichts von NINA"
exit $fail
