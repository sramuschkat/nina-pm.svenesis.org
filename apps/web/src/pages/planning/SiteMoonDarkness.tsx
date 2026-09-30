/**
 * „Mond und Dunkelheit“ eines Standorts (Objektbrowser, Exoplaneten): Nacht-Grenzen aus der Tabelle des Servers
 * (NT-02). Standardmäßig eingeklappt (Wunsch Sven 30.09.2026) – die Kopfzeile nennt Phase und Dunkelheit.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { equipmentApi, type SiteView } from '../../api/client';
import { MoonDarkness, moonDarkness } from '../../components/moon-darkness';

export function SiteMoonDarkness({
  site,
  night,
  current,
}: {
  site: SiteView;
  night: string;
  current: string | null;
}) {
  const table = useQuery({
    queryKey: ['site-nights', site.id, 'from', night],
    queryFn: () => equipmentApi.nights(site.id, 2, night),
    staleTime: 60 * 60 * 1000,
  });
  const data = useMemo(() => {
    if (!table.data) return null;
    return moonDarkness({
      site: { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg },
      night,
      timeZoneTransitions: table.data.timeZoneTransitions.map((z) => ({
        atUtc: Date.parse(z.atUtc) / 1000,
        utcOffsetMinutes: z.utcOffsetMinutes,
      })),
      timeZone: site.timeZone,
    });
  }, [table.data, site, night]);
  if (!data) return null;
  return (
    <MoonDarkness
      data={data}
      night={night}
      timeZone={site.timeZone}
      southern={site.latitudeDeg < 0}
      nowUtc={night === current ? Math.floor(Date.now() / 1000) : undefined}
      defaultOpen={false}
    />
  );
}
