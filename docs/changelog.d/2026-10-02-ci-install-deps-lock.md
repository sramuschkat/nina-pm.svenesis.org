### CI – zweiter Versuch von `playwright install-deps` scheitert nicht mehr an der apt-Sperre

- Hing der Ubuntu-Spiegel, beendete `timeout` nur pnpm; der per sudo gestartete apt-get hielt die Sperre, und der zweite Versuch scheiterte sofort (`Could not get lock /var/lib/apt/lists/lock`, CI #454 auf `main`). Vor dem neuen Versuch jetzt apt-get beenden, bis 60 s auf die Sperren warten und einen unterbrochenen dpkg-Lauf abschließen.
