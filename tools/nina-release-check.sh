#!/usr/bin/env bash
# Release-Prüfung des Plugins (AP-16h): Tag plugin-v<Version> = <Version> aus NinaPm.Nina.csproj (daraus entstehen
# Assembly- und Manifest-Version, die NINA im Plugin-Manager anzeigt). Ohne Übereinstimmung kein Release.
# Aufruf: tools/nina-release-check.sh <tag> [csproj]   (plugin.yml, Auftrag release)
set -euo pipefail
tag="${1:?Tag angeben, z. B. plugin-v0.2.0}"
csproj="${2:-apps/nina-plugin/NinaPm.Nina/NinaPm.Nina.csproj}"
version=$(sed -n 's:.*<Version>\(.*\)</Version>.*:\1:p' "$csproj" | head -1)
[[ -n "$version" ]] || { echo "✗ keine <Version> in $csproj" >&2; exit 1; }
[[ "$tag" =~ ^plugin-v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "✗ Tag $tag hat nicht die Form plugin-vX.Y.Z" >&2; exit 1; }
[[ "${tag#plugin-v}" == "$version" ]] || { echo "✗ Tag $tag passt nicht zur Plugin-Version $version ($csproj)" >&2; exit 1; }
echo "✓ $tag = Plugin-Version $version"
