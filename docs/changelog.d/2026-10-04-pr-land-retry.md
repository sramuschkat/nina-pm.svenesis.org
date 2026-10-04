### `pr:land` und `deploy:prod` robust gegen parallelen Fetch

- **`pnpm pr:land`:** `git pull --ff-only` wiederholt sich bis zu 3× (Pause 2 s, 4 s), wenn ein anderer Prozess gleichzeitig holt („cannot lock ref 'refs/remotes/origin/main'“). Das ist am 04.10. dreimal passiert (#245, #250, #251) und hat jedes Mal den Deploy verhindert. Andere Fehler (nicht verfolgte Datei, nicht vorspulbar) brechen wie bisher sofort ab.
- **`pnpm deploy:prod`:** `git fetch origin main` hat ebenfalls bis zu 3 Versuche.
