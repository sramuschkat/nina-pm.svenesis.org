/**
 * NINA › Hilfe: Sequencer – ausführliche Hilfe zu den NINA-PM-Bausteinen im Advanced Sequencer von NINA:
 * Grundregeln, empfohlene Sequenzen, je Baustein Zweck, Platzierung, Einstellungen, Ablauf und Hinweise,
 * Flats am Nachtende, Vorlagenprüfung, Optionsseite. Inhalt je Sprache aus `@nina-pm/i18n` (`sequencerHelp`),
 * Fließtexte über `Markdown` (ohne HTML). Für jedes Mitglied sichtbar.
 */
import {
  sequencerHelp,
  type Language,
  type SequencerHelpItem,
  type SequencerHelpSection,
  type SequencerHelpSetting,
} from '@nina-pm/i18n';
import { useTranslation } from 'react-i18next';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { Markdown } from '../../components/Markdown';
import { PageHeader } from '../../components/PageHeader';
import { NinaTabs } from './NinaLayout';
import styles from './help.module.css';

const lang = (l: string): Language => (l === 'en' ? 'en' : 'de');

function Section({ section, level = 2 }: { section: SequencerHelpSection; level?: 2 | 3 }) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <section id={section.id} className={styles.section} aria-labelledby={`${section.id}-h`}>
      <H id={`${section.id}-h`}>{section.title}</H>
      <Markdown>{section.body}</Markdown>
    </section>
  );
}

function Item({ item }: { item: SequencerHelpItem }) {
  const { t } = useTranslation();
  const columns: DataColumn<SequencerHelpSetting>[] = [
    { id: 'name', header: t('nina.help.col.setting'), cell: (s) => s.name },
    { id: 'values', header: t('nina.help.col.values'), cell: (s) => s.values, priority: 2 },
    {
      id: 'meaning',
      header: t('nina.help.col.meaning'),
      cell: (s) => <Markdown>{s.meaning}</Markdown>,
    },
  ];
  return (
    <article id={item.id} className={styles.item} aria-labelledby={`${item.id}-h`}>
      <header className={styles.itemHead}>
        <h3 id={`${item.id}-h`}>{item.name}</h3>
        <span className={styles.kind}>{t(`nina.help.kind.${item.kind}`)}</span>
      </header>
      <p className={styles.summary}>{item.summary}</p>
      <h4>{t('nina.help.place')}</h4>
      <Markdown>{item.place}</Markdown>
      <h4>{t('nina.help.settings')}</h4>
      {item.settings.length > 0 ? (
        <DataTable
          label={`${t('nina.help.settings')}: ${item.name}`}
          columns={columns}
          rows={[...item.settings]}
          rowKey={(s) => s.name}
          rowLabel={(s) => s.name}
        />
      ) : (
        <p className={styles.muted}>{t('nina.help.noSettings')}</p>
      )}
      <h4>{t('nina.help.behavior')}</h4>
      <Markdown>{item.behavior}</Markdown>
      {item.tips ? (
        <>
          <h4>{t('nina.help.tips')}</h4>
          <Markdown>{item.tips}</Markdown>
        </>
      ) : null}
    </article>
  );
}

export function SequencerHelpPage() {
  const { t, i18n } = useTranslation();
  const help = sequencerHelp[lang(i18n.language)];
  const checkColumns: DataColumn<{ code: string; text: string }>[] = [
    {
      id: 'code',
      header: t('nina.help.col.code'),
      cell: (r) => <code>{r.code}</code>,
      nowrap: true,
      priority: 2,
    },
    { id: 'text', header: t('nina.help.col.text'), cell: (r) => r.text },
  ];
  const toc: { id: string; label: string; children?: { id: string; label: string }[] }[] = [
    { id: help.basics.id, label: help.basics.title },
    ...help.concepts.map((c) => ({ id: c.id, label: c.title })),
    {
      id: 'templates',
      label: t('nina.help.templates'),
      children: help.templates.map((s) => ({ id: s.id, label: s.title })),
    },
    {
      id: 'items',
      label: t('nina.help.items'),
      children: help.items.map((i) => ({ id: i.id, label: i.name })),
    },
    { id: help.flats.id, label: help.flats.title },
    { id: 'checks', label: t('nina.help.checks') },
    { id: help.options.id, label: help.options.title },
  ];
  return (
    <div className={styles.page}>
      <PageHeader title={t('nina.help.title')} nav={<NinaTabs />} />
      <div className={styles.layout}>
        <nav className={styles.toc} aria-label={t('nina.help.toc')}>
          <p className={styles.tocTitle}>{t('nina.help.toc')}</p>
          <ol>
            {toc.map((e) => (
              <li key={e.id}>
                <a href={`#${e.id}`}>{e.label}</a>
                {e.children ? (
                  <ol>
                    {e.children.map((c) => (
                      <li key={c.id}>
                        <a href={`#${c.id}`}>{c.label}</a>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            ))}
          </ol>
        </nav>
        <div className={styles.content}>
          <div className={styles.intro}>
            <Markdown>{help.intro}</Markdown>
          </div>
          <Section section={help.basics} />
          {help.concepts.map((c) => (
            <Section key={c.id} section={c} />
          ))}
          <section id="templates" className={styles.section} aria-labelledby="templates-h">
            <h2 id="templates-h">{t('nina.help.templates')}</h2>
            {help.templates.map((s) => (
              <Section key={s.id} section={s} level={3} />
            ))}
          </section>
          <section id="items" className={styles.section} aria-labelledby="items-h">
            <h2 id="items-h">{t('nina.help.items')}</h2>
            {help.items.map((i) => (
              <Item key={i.id} item={i} />
            ))}
          </section>
          <Section section={help.flats} />
          <section id="checks" className={styles.section} aria-labelledby="checks-h">
            <h2 id="checks-h">{t('nina.help.checks')}</h2>
            <p>{help.checks.intro}</p>
            <DataTable
              label={t('nina.help.checks')}
              columns={checkColumns}
              rows={[...help.checks.rows]}
              rowKey={(r) => r.code}
              rowLabel={(r) => r.code}
            />
          </section>
          <Section section={help.options} />
        </div>
      </div>
    </div>
  );
}
