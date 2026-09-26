// @vitest-environment jsdom
/** `PageHeader` (components.md §2.14, AP-26d): Titel als h1, Metazeile, Aktionen, Brotkrumen, Reiter; axe. */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { PageHeader } from './index';

describe('PageHeader', () => {
  it('Titel, Metazeile, Aktionen und Reiter; ohne Brotkrumen keine Navigation dafür; axe', async () => {
    render(
      <MemoryRouter>
        <PageHeader
          title="Projekte"
          meta={<span>8 Projekte</span>}
          actions={<button type="button">Neues Projekt</button>}
          nav={
            <nav aria-label="Bereich">
              <a href="/projekte">Projektliste</a>
            </nav>
          }
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Projekte' })).toBeInTheDocument();
    expect(screen.getByText('8 Projekte')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neues Projekt' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Bereich' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Brotkrumen' })).not.toBeInTheDocument();
    await expectNoSeriousA11y();
  });

  it('Brotkrumen auf Detailseiten: Links bis auf den letzten Eintrag', () => {
    render(
      <MemoryRouter>
        <PageHeader
          title="M 31 Andromeda"
          titleHint="M 31 Andromeda"
          crumbs={[{ label: 'Projekte', to: '/projekte' }, { label: 'Aktiv' }]}
        />
      </MemoryRouter>,
    );
    const crumbs = screen.getByRole('navigation', { name: 'Brotkrumen' });
    expect(within(crumbs).getByRole('link', { name: 'Projekte' })).toHaveAttribute(
      'href',
      '/projekte',
    );
    expect(within(crumbs).queryByRole('link', { name: 'Aktiv' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('title', 'M 31 Andromeda');
  });
});
