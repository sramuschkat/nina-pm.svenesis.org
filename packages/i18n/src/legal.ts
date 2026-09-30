/**
 * Datenschutz und Quellen (FA-WEB-04, TK 11.3) als Markdown je Sprache – Anzeige über `react-markdown`
 * ohne HTML. Rechtliche Durchsicht H-17 freigegeben (Sven, 25.09.2026); danach ergänzt: Absatz
 * „Öffentliche Vorschaubilder“ (SEC-28, AP-17) und der Satz zur Sichtbarkeit von Anzeigename und
 * Discord-Profilbild im Mandanten (Entscheidung Sven 30.09.2026, Mitgliederverzeichnis).
 */
import type { Language } from './index';

export const privacyMarkdown: Readonly<Record<Language, string>> = {
  de: `## Verantwortlicher

Sven Ramuschkat, Kontaktdaten im [Impressum der Website](https://www.svenesis.org/contact/contact_de.html). NINA-PM ist eine eigenständige Anwendung unter \`nina-pm.svenesis.org\`.

## Anmeldung über Discord (Drittland USA)

Die Anmeldung erfolgt ausschließlich über Discord (Discord Inc., USA). NINA-PM erhält dabei deine Discord-User-ID, den Benutzernamen, den Anzeigenamen, das Avatar-Kennzeichen und die Angabe, ob die Zwei-Faktor-Authentifizierung aktiv ist. Das Zugriffstoken von Discord wird nicht gespeichert. Andere Mitglieder deines Mandanten sehen deinen Anzeigenamen und dein Discord-Profilbild. Rechtsgrundlage ist die Nutzung der Anwendung, zu der du dich anmeldest (Art. 6 Abs. 1 lit. b DSGVO).

## Hosting (AWS)

Die Anwendung läuft bei Amazon Web Services in der Region Frankfurt (eu-central-1). Gespeichert werden Mitgliedschaften, Rollen, Projekte, Aufnahme- und Sitzungsdaten deines Mandanten.

## Cookies

NINA-PM setzt nur technisch notwendige Cookies: \`__Host-npm_sid\` (Anmeldesitzung, höchstens 30 Tage, nach 14 Tagen ohne Nutzung ungültig), \`__Host-npm_oauth\` (10 Minuten während der Anmeldung) und \`__Host-npm_invite\` (15 Minuten beim Annehmen einer Einladung). Es gibt keine Analyse- oder Werbeskripte und deshalb kein Cookie-Banner. Im Browser speichert NINA-PM zusätzlich Sprache, Erscheinungsbild und Dichte (\`localStorage\`).

## Serverseitige Abrufe

Für Wetter, Kataloge und Ephemeriden ruft der Server Daten ab bei Open-Meteo, CDS (Universität Straßburg), ExoClock, dem NASA Exoplanet Archive und ExoFOP. Dabei werden keine personenbezogenen Daten übermittelt, nur Koordinaten der Standorte deines Mandanten.

## Himmelsbilder im Browser

Himmelsausschnitte der Sternkarte lädt dein Browser direkt bei CDS (\`alasky.cds.unistra.fr\`); dabei wird deine IP-Adresse an CDS übertragen. Discord-Avatare lädt dein Browser von \`cdn.discordapp.com\`.

## Öffentliche Vorschaubilder

Vorschaubilder von Himmelsausschnitten (\`/catalog/thumbs/…\`) sind ohne Anmeldung abrufbar. Sie enthalten keine personenbezogenen Daten und keinen Bezug zu einem Mandanten; der Dateiname ergibt sich aus Koordinaten, Bildfeld, Rotation und Himmelsdurchmusterung. Wer genau diese Werte kennt, kann daran erkennen, dass irgendjemand diesen Ausschnitt geplant hat – dieses geringe Restrisiko ist bewusst hingenommen.

## Speicherdauer und Rechte

Anmeldesitzungen enden spätestens nach 30 Tagen; ein Anmeldeprotokoll gibt es nicht. Mitgliedsdaten bleiben, bis du den Mandanten verlässt oder entfernt wirst. Du hast die Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch sowie ein Beschwerderecht bei einer Aufsichtsbehörde.
`,
  en: `## Controller

Sven Ramuschkat, contact details in the [website imprint](https://www.svenesis.org/contact/contact_en.html). NINA-PM is a separate application at \`nina-pm.svenesis.org\`.

## Sign-in with Discord (third country USA)

You sign in exclusively with Discord (Discord Inc., USA). NINA-PM receives your Discord user ID, user name, display name, avatar hash and whether two-factor authentication is active. The Discord access token is not stored. Other members of your tenant see your display name and your Discord profile picture. The legal basis is the use of the application you sign in to (Art. 6(1)(b) GDPR).

## Hosting (AWS)

The application runs on Amazon Web Services in the Frankfurt region (eu-central-1). It stores memberships, roles, projects, capture and session data of your tenant.

## Cookies

NINA-PM only sets technically necessary cookies: \`__Host-npm_sid\` (sign-in session, at most 30 days, invalid after 14 days without use), \`__Host-npm_oauth\` (10 minutes during sign-in) and \`__Host-npm_invite\` (15 minutes while accepting an invitation). There are no analytics or advertising scripts and therefore no cookie banner. In the browser, NINA-PM also stores language, appearance and density (\`localStorage\`).

## Server-side requests

For weather, catalogues and ephemerides the server fetches data from Open-Meteo, CDS (University of Strasbourg), ExoClock, the NASA Exoplanet Archive and ExoFOP. No personal data is sent, only the coordinates of your tenant's sites.

## Sky images in the browser

Sky cut-outs of the sky map are loaded by your browser directly from CDS (\`alasky.cds.unistra.fr\`), which transmits your IP address to CDS. Discord avatars are loaded from \`cdn.discordapp.com\`.

## Public preview images

Preview images of sky cut-outs (\`/catalog/thumbs/…\`) can be retrieved without signing in. They contain no personal data and no reference to a tenant; the file name is derived from coordinates, field of view, rotation and sky survey. Anyone who knows exactly these values can tell that someone planned this cut-out – this small residual risk is accepted deliberately.

## Retention and rights

Sign-in sessions end after 30 days at the latest; there is no sign-in log. Membership data remains until you leave the tenant or are removed. You have the rights of access, rectification, erasure, restriction, data portability and objection, and the right to lodge a complaint with a supervisory authority.
`,
};

export const sourcesMarkdown: Readonly<Record<Language, string>> = {
  de: `## Daten

- **OpenNGC** von Mattia Verga – Objektkatalog, Version v20260501, abgerufen am 25.09.2026 ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)); ergänzt um Namen und Aliase aus dem Beobachtungsplaner von svenesis.org sowie Sharpless-Regionen (Sharpless 1959, VizieR VII/20, Positionen SIMBAD)
- **Open-Meteo** – Wetterdaten ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)); Modelle DWD ICON, DMI HARMONIE AROME, NOAA HRRR/NBM/GFS, CMC GEM, ECMWF IFS; Aerosol: Copernicus CAMS
- **CDS / Aladin (Universität Straßburg)** – Himmelsbilder über HiPS und hips2fits: DSS2 (STScI/Caltech/UK Schmidt), Pan-STARRS DR1 (PS1 Science Consortium), 2MASS (UMass/IPAC), NSNS – Northern Sky Narrowband Survey (simg.de)
- **d3-celestial** von Olaf Frohn – Sterne (XHIP/Hipparcos), Sternbildlinien, -grenzen und -namen der Sternkarte ([BSD 3-Clause](https://opensource.org/license/bsd-3-clause)); Milchstraße nach dem Milky Way Outline Catalog von Jose R. Vieira
- **ExoClock**, **NASA Exoplanet Archive**, **ExoFOP / TESS TOI** – Exoplaneten und Ephemeriden

## Software

- **React**, **React Router**, **TanStack Query**, **Radix UI**, **i18next**, **react-markdown** (MIT)
- **Lucide** – Symbole (ISC)
- **Hono**, **zod**, **Kysely** (MIT)
- Teile der Planungslogik sind aus einem NINA-Plugin unter MIT-Lizenz übernommen; Herkunft und Lizenztext in \`THIRD_PARTY_NOTICES.md\` im Quellcode
- **NINA** – Nighttime Imaging 'N' Astronomy (MPL-2.0), mit der NINA-PM zusammenarbeitet
`,
  en: `## Data

- **OpenNGC** by Mattia Verga – object catalogue, version v20260501, fetched on 25 September 2026 ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)); extended with names and aliases from the svenesis.org observing planner and Sharpless regions (Sharpless 1959, VizieR VII/20, positions SIMBAD)
- **Open-Meteo** – weather data ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)); models DWD ICON, DMI HARMONIE AROME, NOAA HRRR/NBM/GFS, CMC GEM, ECMWF IFS; aerosol: Copernicus CAMS
- **CDS / Aladin (University of Strasbourg)** – sky images via HiPS and hips2fits: DSS2 (STScI/Caltech/UK Schmidt), Pan-STARRS DR1 (PS1 Science Consortium), 2MASS (UMass/IPAC), NSNS – Northern Sky Narrowband Survey (simg.de)
- **d3-celestial** by Olaf Frohn – stars (XHIP/Hipparcos), constellation lines, boundaries and names of the sky map ([BSD 3-Clause](https://opensource.org/license/bsd-3-clause)); Milky Way after the Milky Way Outline Catalog by Jose R. Vieira
- **ExoClock**, **NASA Exoplanet Archive**, **ExoFOP / TESS TOI** – exoplanets and ephemerides

## Software

- **React**, **React Router**, **TanStack Query**, **Radix UI**, **i18next**, **react-markdown** (MIT)
- **Lucide** – icons (ISC)
- **Hono**, **zod**, **Kysely** (MIT)
- Parts of the planning logic are adopted from a NINA plugin under the MIT licence; origin and licence text in \`THIRD_PARTY_NOTICES.md\` in the source code
- **NINA** – Nighttime Imaging 'N' Astronomy (MPL-2.0), which NINA-PM works with
`,
};
