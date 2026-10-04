/**
 * Reiter *Kommentare* im Projekt-Editor (FA-PRJ-17, Ausbau der Notizen 04.10.2026): Stränge neueste zuerst,
 * Antworten darunter eingerückt und älteste zuerst (eine Ebene; der Server hängt Antworten auf Antworten an
 * denselben Strang). Markdown ohne rohes HTML, Emoji über die Auswahl im Eingabefeld, Reaktionen aus der festen
 * Auswahl `commentReactions`. Rechte nur zum Ein-/Ausblenden (`useCan`): kommentieren und reagieren wie lesen,
 * bearbeiten nur der Verfasser in der ersten Stunde, löschen nur Admin/Owner (weich, mit Bestätigung).
 */
import { COMMENT_EDIT_WINDOW_MS, commentReactions } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { projectsApi, type CommentReaction, type NoteView } from '../../api/client';
import { useCan, useOptionalAuth } from '../../auth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmojiPicker } from '../../components/EmojiPicker';
import { actionIcons, ICON_SIZE, uiIcons } from '../../components/icons';
import { Markdown } from '../../components/Markdown';
import { ProblemMessage, problemI18nKey } from '../../components/ProblemMessage';
import { Person } from '../../lib/member';
import { problemCode } from '../equipment/shared';
import styles from './projects.module.css';

/**
 * Feste Emoji-Auswahl im Eingabefeld (keine Bibliothek): Reaktionen zuerst, dann Gefühl, Himmel und Wetter.
 * Emoji sind Inhalt der Kommentare, keine Symbole der Oberfläche (rules/ui.md).
 */
export const COMMENT_EMOJIS: readonly string[] = [
  ...commentReactions,
  '👎',
  '👏',
  '🙌',
  '😂',
  '😊',
  '😉',
  '🤔',
  '😢',
  '😅',
  '🔥',
  '✨',
  '⭐',
  '🌙',
  '🌌',
  '🪐',
  '☄️',
  '☁️',
  '🌧️',
  '💨',
  '✅',
  '❌',
  '⚠️',
  '❓',
];

export interface CommentThread {
  readonly top: NoteView;
  readonly replies: readonly NoteView[];
}

/** Stränge aus der flachen Liste: oberste Ebene neueste zuerst, Antworten älteste zuerst. */
export function commentThreads(items: readonly NoteView[]): CommentThread[] {
  const byTime = (a: NoteView, b: NoteView) => Date.parse(a.createdAt) - Date.parse(b.createdAt);
  const ids = new Set(items.map((n) => n.id));
  // Antworten ohne sichtbaren Strang (sollte nicht vorkommen) erscheinen als eigener Kommentar.
  const isTop = (n: NoteView) => n.parentId === null || !ids.has(n.parentId);
  return items
    .filter(isTop)
    .sort((a, b) => byTime(b, a))
    .map((top) => ({
      top,
      replies: items.filter((n) => !isTop(n) && n.parentId === top.id).sort(byTime),
    }));
}

/** Bearbeiten erlaubt: eigener, nicht gelöschter Kommentar in der ersten Stunde (Server prüft erneut). */
export function canEditComment(note: NoteView, memberId: string | undefined, nowMs: number) {
  return (
    memberId !== undefined &&
    note.userId === memberId &&
    note.deletedAt === null &&
    nowMs - Date.parse(note.createdAt) < COMMENT_EDIT_WINDOW_MS
  );
}

export function CommentsTab({
  projectId,
  resource,
}: {
  projectId: string;
  resource: Parameters<typeof useCan>[1];
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const canWrite = useCan('project.note.write', resource);
  const canDelete = useCan('project.note.delete', resource);
  const memberId = useOptionalAuth()?.me?.member?.id;
  const key = ['project-notes', projectId];
  const notes = useQuery({
    queryKey: key,
    queryFn: async () => (await projectsApi.notes(projectId)).items,
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: key });
    // Sprechblase mit Zahl in Liste und Warteschlange.
    await client.invalidateQueries({ queryKey: ['projects'] });
  };
  const add = useMutation({
    mutationFn: (v: { bodyMd: string; parentId: string | null }) =>
      projectsApi.addNote(projectId, v.bodyMd, v.parentId),
    onSuccess: refresh,
  });
  const edit = useMutation({
    mutationFn: (v: { noteId: string; bodyMd: string }) =>
      projectsApi.editNote(projectId, v.noteId, v.bodyMd),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (noteId: string) => projectsApi.deleteNote(projectId, noteId),
    onSuccess: refresh,
  });
  const react = useMutation({
    mutationFn: (v: { noteId: string; emoji: CommentReaction; active: boolean }) =>
      projectsApi.reactNote(projectId, v.noteId, v.emoji, v.active),
    onSuccess: (updated) =>
      client.setQueryData<NoteView[]>(key, (old) =>
        old?.map((n) => (n.id === updated.id ? updated : n)),
      ),
  });
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<NoteView | null>(null);

  const item = (n: NoteView, threadId: string) => (
    <CommentItem
      note={n}
      editing={editing === n.id}
      canWrite={canWrite}
      canEdit={canWrite && canEditComment(n, memberId, Date.now())}
      canDelete={canDelete && n.deletedAt === null}
      saving={edit.isPending}
      onReply={() => {
        setReplyTo(threadId);
        setEditing(null);
      }}
      onEdit={() => {
        setEditing(n.id);
        setReplyTo(null);
      }}
      onCancelEdit={() => setEditing(null)}
      onSave={(bodyMd) =>
        edit.mutate({ noteId: n.id, bodyMd }, { onSuccess: () => setEditing(null) })
      }
      onDelete={() => setDeleting(n)}
      onReact={(emoji, active) => react.mutate({ noteId: n.id, emoji, active })}
    />
  );

  return (
    <div className={styles.stack}>
      {canWrite ? (
        <CommentForm
          label={t('comments.new')}
          submitLabel={t('comments.add')}
          pending={add.isPending && add.variables.parentId === null}
          onSubmit={(bodyMd, done) => add.mutate({ bodyMd, parentId: null }, { onSuccess: done })}
        />
      ) : null}
      {add.error ? <ProblemMessage code={problemCode(add.error)} /> : null}
      {edit.error ? <ProblemMessage code={problemCode(edit.error)} /> : null}
      {react.error ? <ProblemMessage code={problemCode(react.error)} /> : null}
      {notes.isError ? (
        <ProblemMessage code={problemCode(notes.error)} onRetry={() => void notes.refetch()} />
      ) : notes.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : notes.data.length === 0 ? (
        <p className={styles.muted}>{t('comments.empty')}</p>
      ) : (
        <ul className={styles.notes}>
          {commentThreads(notes.data).map(({ top, replies }) => (
            <li key={top.id}>
              {item(top, top.id)}
              {replies.length > 0 ? (
                <ul
                  className={styles.replies}
                  aria-label={t('comments.replies', { name: top.authorName })}
                >
                  {replies.map((r) => (
                    <li key={r.id}>{item(r, top.id)}</li>
                  ))}
                </ul>
              ) : null}
              {replyTo === top.id && canWrite ? (
                <div className={styles.replies}>
                  <CommentForm
                    label={t('comments.replyTo', { name: top.authorName })}
                    submitLabel={t('comments.sendReply')}
                    pending={add.isPending}
                    autoFocus
                    onCancel={() => setReplyTo(null)}
                    onSubmit={(bodyMd, done) =>
                      add.mutate(
                        { bodyMd, parentId: top.id },
                        {
                          onSuccess: () => {
                            done();
                            setReplyTo(null);
                          },
                        },
                      )
                    }
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t('comments.deleteTitle')}
        consequence={t('comments.deleteConsequence')}
        confirmLabel={t('comments.delete')}
        variant="danger"
        state={remove.isPending ? 'loading' : remove.isError ? 'error' : 'ready'}
        {...(remove.error ? { errorKey: problemI18nKey(problemCode(remove.error)) } : {})}
        onCancel={() => {
          setDeleting(null);
          remove.reset();
        }}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
        }}
      />
    </div>
  );
}

function CommentItem({
  note: n,
  editing,
  canWrite,
  canEdit,
  canDelete,
  saving,
  onReply,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onReact,
}: {
  note: NoteView;
  editing: boolean;
  canWrite: boolean;
  canEdit: boolean;
  canDelete: boolean;
  saving: boolean;
  onReply: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (bodyMd: string) => void;
  onDelete: () => void;
  onReact: (emoji: CommentReaction, active: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const when = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      Date.parse(iso),
    );
  const deleted = n.deletedAt !== null;
  const mine = n.reactions.filter((r) => r.mine).map((r) => r.emoji);
  const Reply = actionIcons.reply;
  const Edit = actionIcons.edit;
  const Delete = actionIcons.delete;
  return (
    <article className={styles.comment} aria-label={n.authorName}>
      <span className={styles.noteMeta}>
        <Person id={n.userId} name={n.authorName} /> ·{' '}
        <time dateTime={n.createdAt}>{when(n.createdAt)}</time>
        {n.editedAt && !deleted ? (
          <>
            {' · '}
            <span title={when(n.editedAt)}>{t('comments.edited')}</span>
          </>
        ) : null}
      </span>
      {deleted ? (
        <p className={styles.muted}>
          <em>{t('comments.deleted')}</em>
        </p>
      ) : editing ? (
        <CommentForm
          label={t('comments.editLabel')}
          submitLabel={t('comments.save')}
          initial={n.bodyMd}
          pending={saving}
          autoFocus
          onCancel={onCancelEdit}
          onSubmit={(bodyMd) => onSave(bodyMd)}
        />
      ) : (
        <Markdown>{n.bodyMd}</Markdown>
      )}
      {!deleted && !editing ? (
        <div className={styles.commentActions}>
          {n.reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              className={styles.reaction}
              aria-pressed={r.mine}
              aria-label={t('comments.reaction', { emoji: r.emoji, count: r.count })}
              title={t('comments.reaction', { emoji: r.emoji, count: r.count })}
              disabled={!canWrite}
              onClick={() => onReact(r.emoji, !r.mine)}
            >
              <span aria-hidden>{r.emoji}</span> <span aria-hidden>{r.count}</span>
            </button>
          ))}
          {canWrite ? (
            <EmojiPicker
              emojis={commentReactions}
              selected={mine}
              label={t('comments.react')}
              icon={uiIcons.react}
              onPick={(emoji) =>
                onReact(emoji as CommentReaction, !mine.includes(emoji as CommentReaction))
              }
            />
          ) : null}
          {canWrite ? (
            <button type="button" className={styles.commentAction} onClick={onReply}>
              <Reply size={ICON_SIZE.table} aria-hidden /> {t('comments.reply')}
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className={styles.commentAction}
              onClick={onEdit}
              title={t('comments.editHint')}
            >
              <Edit size={ICON_SIZE.table} aria-hidden /> {t('comments.edit')}
            </button>
          ) : null}
          {canDelete ? (
            <button type="button" className={styles.commentDanger} onClick={onDelete}>
              <Delete size={ICON_SIZE.table} aria-hidden /> {t('comments.delete')}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/**
 * Eingabe für Kommentar, Antwort und Bearbeitung. Kein eigenes `<form>`: der Reiter liegt im Formular des
 * oberen Bereichs (keine verschachtelten Formulare). Das Emoji landet an der Cursorposition.
 */
function CommentForm({
  label,
  submitLabel,
  initial = '',
  pending,
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  initial?: string;
  pending: boolean;
  autoFocus?: boolean;
  /** `done` leert das Feld nach erfolgreichem Speichern. */
  onSubmit: (bodyMd: string, done: () => void) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [body, setBody] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);
  const insert = (emoji: string) => {
    const el = area.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + emoji + body.slice(end));
    // Cursor hinter das Emoji, sobald React den neuen Wert gesetzt hat.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };
  const submit = () => {
    if (body.trim() && !pending) onSubmit(body.trim(), () => setBody(''));
  };
  return (
    <div className={styles.stack}>
      <label htmlFor={id} className={styles.muted}>
        {label}
      </label>
      <textarea
        id={id}
        ref={area}
        className={styles.input}
        rows={3}
        maxLength={20000}
        value={body}
        // Antwort und Bearbeitung öffnen auf Klick des Users – Fokus direkt ins Feld.
        autoFocus={autoFocus}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className={styles.commentActions}>
        <EmojiPicker
          emojis={COMMENT_EMOJIS}
          label={t('comments.emoji')}
          icon={uiIcons.emoji}
          onPick={insert}
        />
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={!body.trim() || pending}
          onClick={submit}
        >
          {submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className={styles.button} onClick={onCancel}>
            {t('common.cancel')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
