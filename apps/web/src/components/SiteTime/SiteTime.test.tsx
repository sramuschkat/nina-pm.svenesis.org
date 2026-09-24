// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../../test/setup';
import { SiteTime } from './index';

describe('SiteTime (NT-03)', () => {
  it('Nachtereignis in Standortzeit mit Kürzel, nie Browserzeit: 02:08Z → „21:08 CDT“', () => {
    render(<SiteTime atUtc="2026-09-18T02:08:00Z" siteTimeZone="America/Chicago" />);
    expect(screen.getByText('21:08 CDT')).toHaveAttribute('dateTime', '2026-09-18T02:08:00Z');
  });

  it('Frist ohne Standortbezug in Mandantenzeit, Standortzeit im Tooltip', () => {
    render(
      <SiteTime
        atUtc="2026-09-18T02:08:00Z"
        siteTimeZone="America/Chicago"
        mode="deadline"
        tenantTimeZone="Europe/Berlin"
        withDate
      />,
    );
    const el = screen.getByText('18.09.2026 04:08 MESZ');
    expect(el).toHaveAttribute('title', 'Mandantenzeit (Europe/Berlin); Standortzeit 21:08 CDT');
  });
});
