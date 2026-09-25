import { describe, expect, it } from 'vitest';
import type { AuthContext } from '../src/auth';
import { ACTIONS, can, type Action } from '../src/permissions';

const T = '00000000-0000-4000-8000-00000000000a';
const ctx = (over: Partial<AuthContext> = {}): AuthContext => ({
  identityId: 'i-1',
  sessionId: 's-1',
  ctx: 'tenant',
  tenantId: T,
  memberId: 'm-self',
  role: 'user',
  isOwner: false,
  isSuperUser: false,
  mfa: true,
  mfaRequired: false,
  ...over,
});
const owner = ctx({ role: 'admin', isOwner: true, memberId: 'm-owner' });
const admin = ctx({ role: 'admin', memberId: 'm-admin' });
const user = ctx({ role: 'user', memberId: 'm-user' });
// Ohne 2FA liefert die Sitzungsprüfung role 'user' (SV-03); can() ist zusätzlich defensiv.
const adminNoMfa = ctx({ role: 'admin', mfa: false, memberId: 'm-admin2' });
const superUser = ctx({
  ctx: 'system',
  tenantId: null,
  memberId: null,
  role: null,
  isSuperUser: true,
});

describe('can() – Rechtematrix TK 5.5 / FK 6.14', () => {
  it('kennt genau die 43 Aktionen aus enums.json', () => {
    expect(ACTIONS).toHaveLength(43);
  });

  it('nina.sync gilt nur mit Rig-Token, nie für eine Web-Sitzung (TK 5.6, SV-08)', () => {
    expect(can(owner, 'nina.sync')).toBe(false);
    expect(can(superUser, 'nina.sync')).toBe(false);
  });

  it('jede Mandanten-Aktion ist für den Owner mit 2FA erlaubt (keine fällt durch)', () => {
    for (const action of ACTIONS) {
      if (action.startsWith('system.') || action === 'nina.sync') continue;
      expect(can(owner, action), action).toBe(true);
    }
  });

  it('public ist für alle erlaubt, sonst ohne Sitzung nichts', () => {
    expect(can(null, 'public')).toBe(true);
    for (const action of ACTIONS.filter((a) => a !== 'public'))
      expect(can(null, action)).toBe(false);
  });

  it('Super User im System-Kontext: nur system.*', () => {
    for (const action of ACTIONS) {
      const expected = action.startsWith('system.') || action === 'public';
      expect(can(superUser, action), action).toBe(expected);
    }
    expect(can({ ...superUser, mfa: false }, 'system.manage')).toBe(false);
    expect(can(owner, 'system.manage')).toBe(false);
  });

  it('Kontext select: keine Mandanten-Aktion', () => {
    const select = ctx({ ctx: 'select', tenantId: null, memberId: null, role: null });
    expect(ACTIONS.filter((a) => can(select, a))).toEqual(['public']);
  });

  it('Admin ohne 2FA verhält sich wie User (SV-03)', () => {
    for (const action of ACTIONS) {
      expect(can(adminNoMfa, action), action).toBe(can({ ...user, memberId: 'm-admin2' }, action));
    }
  });

  it.each<[Action, boolean]>([
    ['equipment.read', true],
    ['equipment.write', false],
    ['project.status', false],
    ['queue.decide', false],
    ['tenant.export', false],
    ['member.manage', false],
    ['simulation.run', true],
    ['job.read', true],
  ])('User auf Aktionsebene: %s → %s', (action, expected) => {
    expect(can(user, action)).toBe(expected);
  });

  it('fremder Mandant: jede Aktion auf dessen Objekt verboten', () => {
    const foreign = { tenantId: '00000000-0000-4000-8000-00000000000b' };
    for (const action of ACTIONS.filter((a) => a !== 'public' && !a.startsWith('system.'))) {
      expect(can(owner, action, foreign), action).toBe(false);
    }
  });

  describe('Objektregeln', () => {
    it('project.update: Admin immer; User nur eigene Entwürfe/Zurückgegebene', () => {
      expect(can(admin, 'project.update', { createdBy: 'x', approvalStatus: 'approved' })).toBe(
        true,
      );
      expect(can(user, 'project.update', { createdBy: 'm-user', approvalStatus: 'draft' })).toBe(
        true,
      );
      expect(can(user, 'project.update', { createdBy: 'm-user', approvalStatus: 'returned' })).toBe(
        true,
      );
      expect(
        can(user, 'project.update', { createdBy: 'm-user', approvalStatus: 'submitted' }),
      ).toBe(false);
      expect(can(user, 'project.update', { createdBy: 'other', approvalStatus: 'draft' })).toBe(
        false,
      );
    });

    it('project.read: Entwürfe anderer User sind für User unsichtbar (FA-BER-02)', () => {
      expect(can(user, 'project.read', { createdBy: 'other', approvalStatus: 'draft' })).toBe(
        false,
      );
      expect(can(user, 'project.read', { createdBy: 'other', approvalStatus: 'approved' })).toBe(
        true,
      );
      expect(can(admin, 'project.read', { createdBy: 'other', approvalStatus: 'draft' })).toBe(
        true,
      );
    });

    it('queue.vote nicht für eigene, queue.decide nicht für eigene außer einziger Admin', () => {
      expect(can(user, 'queue.vote', { createdBy: 'm-user' })).toBe(false);
      expect(can(user, 'queue.vote', { createdBy: 'other' })).toBe(true);
      expect(can(admin, 'queue.decide', { createdBy: 'm-admin' })).toBe(false);
      expect(can(owner, 'queue.decide', { createdBy: 'm-owner', soleAdmin: true })).toBe(true);
    });

    it('member.manage: Admin nur für Ziel-Rolle User, nie für den Owner', () => {
      expect(can(admin, 'member.manage', { targetRole: 'user' })).toBe(true);
      expect(can(admin, 'member.manage', { targetRole: 'admin' })).toBe(false);
      expect(can(admin, 'member.manage', { targetRole: 'user', targetIsOwner: true })).toBe(false);
    });

    it('member.admin.manage / tenant.owner.transfer: nur Owner mit 2FA, nie an sich selbst', () => {
      expect(
        can(owner, 'member.admin.manage', { targetMemberId: 'm-admin', targetRole: 'admin' }),
      ).toBe(true);
      expect(can(owner, 'member.admin.manage', { targetMemberId: 'm-owner' })).toBe(false);
      expect(can(admin, 'member.admin.manage', { targetMemberId: 'x' })).toBe(false);
      expect(
        can({ ...owner, mfa: false, role: 'user' }, 'tenant.owner.transfer', {
          targetMemberId: 'x',
        }),
      ).toBe(false);
    });

    it('member.leave: jedes Mitglied (Owner → 409 member.owner_cannot_leave im Repository)', () => {
      expect(can(user, 'member.leave')).toBe(true);
      expect(can(owner, 'member.leave')).toBe(true);
    });

    it('transit.lock: User nur eigene freigegebene, unter der Grenze offener Festlegungen', () => {
      const res = { createdBy: 'm-user', approvalStatus: 'approved' as const };
      expect(can(user, 'transit.lock', { ...res, openLocks: 2 })).toBe(true);
      expect(can(user, 'transit.lock', { ...res, openLocks: 3 })).toBe(false);
      expect(
        can(user, 'transit.lock', { ...res, openLocks: 3, settings: { exoUserMaxOpenLocks: 5 } }),
      ).toBe(true);
      expect(can(user, 'transit.lock', { ...res, approvalStatus: 'submitted' })).toBe(false);
      expect(can(admin, 'transit.lock', { createdBy: 'x', openLocks: 99 })).toBe(true);
    });

    it('session.correct: User nur eigene und nur mit Mandanteneinstellung', () => {
      expect(
        can(user, 'session.correct', { createdBy: 'm-user', settings: { userCorrections: true } }),
      ).toBe(true);
      expect(
        can(user, 'session.correct', { createdBy: 'm-user', settings: { userCorrections: false } }),
      ).toBe(false);
      expect(
        can(user, 'session.correct', { createdBy: 'other', settings: { userCorrections: true } }),
      ).toBe(false);
    });

    it('changeRequest.update: Antragsteller solange offen, Admin immer', () => {
      expect(can(user, 'changeRequest.update', { createdBy: 'm-user', status: 'open' })).toBe(true);
      expect(can(user, 'changeRequest.update', { createdBy: 'm-user', status: 'accepted' })).toBe(
        false,
      );
      expect(can(admin, 'changeRequest.update', { createdBy: 'x', status: 'open' })).toBe(true);
    });

    it('job.read: eigene Jobs, Admins alle', () => {
      expect(can(user, 'job.read', { createdBy: 'm-user' })).toBe(true);
      expect(can(user, 'job.read', { createdBy: null })).toBe(false);
      expect(can(admin, 'job.read', { createdBy: 'x' })).toBe(true);
    });
  });
});
