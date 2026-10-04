/**
 * Markdown-Anzeige (SV-05, rules/ui.md): `react-markdown` **ohne** rohes HTML (`skipHtml`, kein
 * `rehype-raw`); externe Links mit `rel="noopener noreferrer"`. `dangerouslySetInnerHTML` ist verboten.
 */
import ReactMarkdown from 'react-markdown';
import styles from './Markdown.module.css';

export function Markdown({ children }: { children: string }) {
  return (
    <div className={styles.md}>
      <ReactMarkdown
        skipHtml
        components={{
          // Codeblöcke rollen waagerecht in sich (Sequenz-Bäume): per Tastatur erreichbar (axe scrollable-region-focusable).
          pre: ({ children: c }) => <pre tabIndex={0}>{c}</pre>,
          a: ({ href, children: c }) => {
            const external = typeof href === 'string' && /^https?:\/\//.test(href);
            return (
              <a
                href={href}
                {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {c}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
