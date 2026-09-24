// @vitest-environment jsdom
import {
  approvalStatuses,
  effortTags,
  projectStatuses,
  sessionStatuses,
  transitObservationStatuses,
} from '@nina-pm/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { StatusBadge, type StatusKind } from './index';

const KINDS: [StatusKind, readonly string[]][] = [
  ['project', projectStatuses],
  ['approval', approvalStatuses],
  ['session', sessionStatuses],
  ['transit', transitObservationStatuses],
  ['effort', effortTags],
];

describe('StatusBadge (§2.8)', () => {
  it('jeder Enum-Wert hat einen i18n-Text (status.<kind>.<value>)', () => {
    for (const [kind, values] of KINDS) {
      for (const value of values) {
        const { unmount } = render(<StatusBadge kind={kind} value={value} />);
        const el = document.querySelector('[data-tone]');
        expect(el?.textContent, `${kind}.${value}`).not.toBe(value);
        unmount();
      }
    }
  });

  it('Text über i18n, z. B. approval.submitted → „Eingereicht“; axe', async () => {
    render(<StatusBadge kind="approval" value="submitted" />);
    expect(screen.getByText('Eingereicht')).toBeInTheDocument();
    await expectNoSeriousA11y();
  });

  it('Grenzfall: unbekannter Wert → neutral mit rohem Wert, kein Absturz', () => {
    render(<StatusBadge kind="project" value="teleported" />);
    const el = screen.getByText('teleported');
    expect(el).toHaveAttribute('data-tone', 'neutral');
  });

  it('Grenzfall: effort mit null → rendert nichts', () => {
    const { container } = render(<StatusBadge kind="effort" value={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
