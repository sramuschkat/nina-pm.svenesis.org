/**
 * Berechtigungsmatrix als Code (TK 5.5, Quelle FK 6.14). Server (Middleware + Use-Cases) und
 * Frontend (`useCan`, nur Ein-/Ausblenden) nutzen dieselbe Funktion.
 *
 * Aufruf ohne `res` beantwortet die Frage auf Aktionsebene (Middleware vor dem Handler): Regeln, die
 * vom Objekt abhängen („nur eigene“, Freigabestatus, Ziel-Rolle), gelten dann als erfüllbar. Der
 * Use-Case prüft mit dem geladenen Objekt erneut – erst dieser zweite Aufruf ist die Entscheidung.
 */
import type { AuthContext } from './auth';
import type { ApprovalStatus, PermissionAction } from './generated/enums';

export type Action = PermissionAction;
export { permissionActions as ACTIONS } from './generated/enums';

export interface ResourceMeta {
  /** Mandant des Objekts; weicht er vom Sitzungsmandanten ab, ist jede Aktion verboten. */
  readonly tenantId?: string;
  /** Ersteller bzw. Antragsteller (`app_user.id`). */
  readonly createdBy?: string | null;
  readonly approvalStatus?: ApprovalStatus;
  /** Status eines Änderungsantrags (`changeRequestStatuses`). */
  readonly status?: string;
  /** Ziel einer Mitglieder-Aktion. */
  readonly targetMemberId?: string;
  readonly targetRole?: 'admin' | 'user';
  readonly targetIsOwner?: boolean;
  /** Offene Transit-Festlegungen des Users (transit.lock). */
  readonly openLocks?: number;
  /** Relevante Mandanteneinstellungen. */
  readonly settings?: { readonly exoUserMaxOpenLocks?: number; readonly userCorrections?: boolean };
  /** FA-FRG-10: der Owner ist der einzige Admin und gibt eigene Objekte selbst frei. */
  readonly soleAdmin?: boolean;
}

export const DEFAULT_EXO_USER_MAX_OPEN_LOCKS = 3;

const EDITABLE: readonly ApprovalStatus[] = ['draft', 'returned'];

/** Aktionen, die jedes aktive Mitglied auf Aktionsebene darf (FK 6.14: ✔ bzw. L für User). */
const MEMBER_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'equipment.read',
  'catalog.read',
  'project.create',
  'queue.read',
  'simulation.run',
  'nina.instance.read',
  'session.read',
  'notification.read',
  // Mitgliederverzeichnis: Name und Discord-Bild aller Mitglieder (30.09.2026, Datenschutz ergänzt).
  'member.directory',
  'me.preferences',
  'me.favorites',
]);

/** Aktionen nur für Admins (mit 2FA; ohne 2FA ist die wirksame Rolle 'user', SV-03). */
const ADMIN_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'equipment.write',
  'project.status',
  'rig.settings.write',
  'nina.instance.manage',
  'session.review',
  'sessionlog.write',
  'tenant.settings',
  'tenant.export',
  'tenant.import',
  'session.report.resend',
  // Kommentar weich löschen (FA-PRJ-17, 04.10.2026): Admins und Owner; Super User über ihre Mitgliedschaft.
  'project.note.delete',
]);

export function can(
  ctx: AuthContext | null | undefined,
  action: Action,
  res?: ResourceMeta,
): boolean {
  if (action === 'public') return true;
  if (!ctx) return false;

  // System-Kontext: nur system.* und nur für aktive Super User mit 2FA (TK 5.4, FA-SU-02, E3).
  if (action === 'system.manage' || action === 'system.tenant.owner') {
    return ctx.ctx === 'system' && ctx.isSuperUser && ctx.mfa;
  }
  if (ctx.ctx !== 'tenant' || !ctx.tenantId || !ctx.memberId || !ctx.role) return false;
  if (res?.tenantId !== undefined && res.tenantId !== ctx.tenantId) return false;
  // Jede Aktion mit Ziel = Owner ist für alle Mandanten-Rollen verboten (nur system.tenant.owner).
  if (res?.targetIsOwner) return false;

  const admin = ctx.role === 'admin' && ctx.mfa;
  const owner = admin && ctx.isOwner;
  const own = res === undefined || res.createdBy === ctx.memberId;
  const status = res?.approvalStatus;

  if (MEMBER_ACTIONS.has(action)) return true;
  if (ADMIN_ACTIONS.has(action)) return admin;

  switch (action) {
    // Kommentieren und reagieren darf, wer das Projekt sehen darf (FA-PRJ-17, 04.10.2026); Bearbeiten nur
    // der Verfasser in der ersten Stunde – das prüft das Repository mit dem Kommentar.
    case 'project.read':
    case 'project.history.read':
    case 'project.note.write':
      // Entwürfe anderer User sind für User nicht sichtbar (FA-BER-02).
      return admin || own || status === undefined || !EDITABLE.includes(status);
    case 'project.update':
    case 'project.delete':
      return admin || (own && (status === undefined || EDITABLE.includes(status)));
    case 'project.submit':
      return admin || (own && (status === undefined || EDITABLE.includes(status)));
    case 'project.withdraw':
      return admin || (own && (status === undefined || status === 'submitted'));
    case 'project.rank':
      // Rangfolge nur der eigenen eingereichten Objekte – auch für Admins (FK 6.14).
      return own;
    case 'queue.vote':
      // Eine Stimme je Objekt, nicht für eigene (FA-FRG-14).
      return res === undefined || res.createdBy !== ctx.memberId;
    case 'queue.decide':
      // Nicht die eigenen Objekte, außer der Owner ist der einzige Admin (FA-FRG-10).
      return (
        admin && (res === undefined || res.createdBy !== ctx.memberId || res.soleAdmin === true)
      );
    case 'session.correct':
      return admin || (own && (res === undefined || res.settings?.userCorrections === true));
    case 'transit.result.import':
    case 'changeRequest.create':
      return admin || (own && (status === undefined || status === 'approved'));
    case 'changeRequest.update':
      return admin || (own && (res?.status === undefined || res.status === 'open'));
    case 'transit.lock': {
      if (admin) return true;
      if (res === undefined) return true;
      const max = res.settings?.exoUserMaxOpenLocks ?? DEFAULT_EXO_USER_MAX_OPEN_LOCKS;
      return own && status === 'approved' && (res.openLocks ?? 0) < max;
    }
    case 'member.manage':
      return admin && (res === undefined || res.targetRole === 'user');
    case 'member.admin.manage':
    case 'tenant.owner.transfer':
      // Nur der Owner, nie an sich selbst (E2).
      return owner && res?.targetMemberId !== ctx.memberId;
    case 'member.leave':
      // Jedes Mitglied; dass der Owner nicht austreten kann, ist eine Invariante mit eigenem Code
      // (`409 member.owner_cannot_leave`, Brief AP-04b) und keine Berechtigungsfrage.
      return true;
    case 'job.read':
      // Eigene Jobs; Admins alle Jobs des Mandanten.
      return admin || res === undefined || res.createdBy === ctx.memberId;
    default:
      return false;
  }
}
