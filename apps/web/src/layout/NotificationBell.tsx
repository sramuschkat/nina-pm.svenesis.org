/**
 * Glocke in der App-Leiste (FA-FRG-11, FK 14.3, TK 7.2): Zähler ungelesener Benachrichtigungen, Liste im
 * Popover, „Alle als gelesen markieren“. Lädt etwa minütlich nach; Discord-Zustellung folgt mit AP-60.
 */
import * as Popover from '@radix-ui/react-popover';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { ApiError } from '../auth';
import { ICON_SIZE, uiIcons } from '../components/icons';
import { NotificationList } from '../components/NotificationList';
import styles from './layout.module.css';

export const NOTIFICATIONS_QUERY_KEY = ['notifications'] as const;
const REFRESH_MS = 60_000;

export function NotificationBell({ tenantTimeZone }: { tenantTimeZone: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: () => api.notifications(),
    refetchInterval: REFRESH_MS,
  });
  const markRead = useMutation({
    mutationFn: (body: { ids: string[] } | { all: true }) => api.markNotificationsRead(body),
    onSettled: () => client.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
  });
  const unread = query.data?.unreadCount ?? 0;
  const Bell = uiIcons.notifications;
  const label =
    unread > 0 ? t('notifications.bellUnread', { count: unread }) : t('appBar.notifications');
  return (
    <Popover.Root onOpenChange={(open) => void (open && query.refetch())}>
      <Popover.Trigger className={styles.iconButton} aria-label={label} title={label}>
        <Bell size={ICON_SIZE.button} aria-hidden />
        {unread > 0 ? (
          <span className={styles.badge} aria-hidden data-testid="notification-count">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={styles.notificationPanel}
          align="end"
          sideOffset={6}
          aria-label={t('appBar.notifications')}
        >
          <div className={styles.notificationHead}>
            <h2>{t('appBar.notifications')}</h2>
            {unread > 0 ? (
              <button
                type="button"
                className={styles.linkButton}
                disabled={markRead.isPending}
                onClick={() => markRead.mutate({ all: true })}
              >
                {t('notifications.markAllRead')}
              </button>
            ) : null}
          </div>
          <div className={styles.notificationBody}>
            <NotificationList
              state={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
              items={query.data?.items ?? []}
              tenantTimeZone={tenantTimeZone}
              errorCode={query.error instanceof ApiError ? query.error.problem.code : undefined}
              onRetry={() => void query.refetch()}
              onMarkRead={(id) => markRead.mutate({ ids: [id] })}
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
