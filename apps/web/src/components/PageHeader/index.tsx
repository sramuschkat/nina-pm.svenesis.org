/**
 * `PageHeader` – Seitengerüst jeder Arbeitsseite (components.md §2.14, Stilsystem AP-26d): Brotkrumen nur
 * auf Detailseiten, Titel 24 px oben links (immer an derselben Stelle), darunter eine Metazeile, rechts die
 * Aktionen mit der Hauptaktion ganz rechts, darunter die Bereichsreiter (`nav`, z. B. `SectionTabs`).
 * Keine Datenabfrage, keine Rechteprüfung – die Seite übergibt nur, was sichtbar sein darf.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import styles from './PageHeader.module.css';

export interface Crumb {
  readonly label: string;
  readonly to?: string;
}

export interface PageHeaderProps {
  readonly title: ReactNode;
  /** Zeile unter dem Titel: Kennzeichen, Mandant und Datum, Rig … */
  readonly meta?: ReactNode;
  /** Knöpfe rechts; die Hauptaktion zuletzt (steht ganz rechts). */
  readonly actions?: ReactNode;
  /** Nur Detailseiten; der letzte Eintrag ist die Seite selbst und wird nicht wiederholt. */
  readonly crumbs?: readonly Crumb[];
  /** Bereichsreiter unter dem Titel. */
  readonly nav?: ReactNode;
  /** `title`-Attribut des Titels, z. B. der volle Name bei Kürzung. */
  readonly titleHint?: string;
}

export function PageHeader(props: PageHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className={styles.header}>
      {props.crumbs && props.crumbs.length > 0 ? (
        <nav aria-label={t('pageHeader.crumbs')}>
          <ol className={styles.crumbs}>
            {props.crumbs.map((c) => (
              <li key={c.label}>{c.to ? <Link to={c.to}>{c.label}</Link> : c.label}</li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className={styles.row}>
        <div className={styles.titles}>
          <h1 className={styles.title} title={props.titleHint}>
            {props.title}
          </h1>
          {props.meta ? <div className={styles.meta}>{props.meta}</div> : null}
        </div>
        {props.actions ? <div className={styles.actions}>{props.actions}</div> : null}
      </div>
      {props.nav ? <div className={styles.nav}>{props.nav}</div> : null}
    </header>
  );
}
