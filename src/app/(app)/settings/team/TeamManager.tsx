'use client';

import { type ReactNode, useActionState, useState } from 'react';
import type { PendingProvisionRow, TeamMemberRow } from '@/lib/access/provisioning';
import { canManageRole, MEMBER_ROLES, type MemberRole, ROLE_PROFILES } from '@/lib/access/roles';
import {
  changeMemberRole,
  createTeamAccess,
  removeMember,
  revokePendingAccess,
  rotateTemporaryPassword,
  type TeamActionState,
} from './actions';
import styles from './team.module.css';

function Message({ state }: { state: TeamActionState }) {
  if (!state) return null;
  return (
    <p className={state.ok ? styles.success : styles.error} role={state.ok ? 'status' : 'alert'}>
      {state.ok ? state.message : state.error}
    </p>
  );
}

function Button({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <button className={danger ? styles.dangerButton : styles.button} type="submit">
      {children}
    </button>
  );
}

export function CredentialReveal({ state }: { state: TeamActionState }) {
  const [copied, setCopied] = useState(false);
  if (!state?.ok || !state.credential) return null;
  const credential = state.credential;
  return (
    <aside className={styles.credential} aria-label="One-time temporary credential">
      <span className={styles.signal}>Shown once</span>
      <strong>{credential.email}</strong>
      <code>{credential.password}</code>
      <button
        type="button"
        className={styles.copyButton}
        onClick={async () => {
          await navigator.clipboard.writeText(credential.password);
          setCopied(true);
        }}
      >
        {copied ? 'Copied' : 'Copy password'}
      </button>
      <small>Expires {new Date(credential.expiresAt).toLocaleString()}.</small>
    </aside>
  );
}

export function CreateAccessForm({ actorRole }: { actorRole: MemberRole }) {
  const [state, action, pending] = useActionState(createTeamAccess, null);
  return (
    <div className={styles.createStack}>
      <form action={action} className={styles.createForm}>
        <label>
          Email
          <input
            type="email"
            name="email"
            autoComplete="off"
            placeholder="person@company.com"
            required
          />
        </label>
        <label>
          Role
          <select name="role" defaultValue="viewer">
            {MEMBER_ROLES.filter((role) => canManageRole(actorRole, role, role)).map((role) => (
              <option key={role} value={role}>
                {ROLE_PROFILES[role].label}
              </option>
            ))}
          </select>
        </label>
        <Button>{pending ? 'Creating…' : 'Create access'}</Button>
      </form>
      <Message state={state} />
      <CredentialReveal state={state} />
    </div>
  );
}

export function PendingAccessCard({ row }: { row: PendingProvisionRow }) {
  const [rotateState, rotateAction, rotating] = useActionState(rotateTemporaryPassword, null);
  const [revokeState, revokeAction, revoking] = useActionState(revokePendingAccess, null);
  return (
    <article className={styles.card}>
      <header className={styles.cardHead}>
        <div>
          <strong>{row.email}</strong>
          <span>Pending · {ROLE_PROFILES[row.role].label}</span>
        </div>
        <small>{row.requiresPasswordChange ? 'Temporary password' : 'Existing account'}</small>
      </header>
      <div className={styles.actions}>
        {row.createdAuthUser ? (
          <form action={rotateAction}>
            <input type="hidden" name="provision_id" value={row.id} />
            <Button>{rotating ? 'Rotating…' : 'New temporary password'}</Button>
          </form>
        ) : null}
        <form action={revokeAction}>
          <input type="hidden" name="provision_id" value={row.id} />
          <Button danger>{revoking ? 'Revoking…' : 'Revoke'}</Button>
        </form>
      </div>
      <Message state={rotateState} />
      <CredentialReveal state={rotateState} />
      <Message state={revokeState} />
    </article>
  );
}

export function MemberCard({ row, actorRole }: { row: TeamMemberRow; actorRole: MemberRole }) {
  const [roleState, roleAction, changing] = useActionState(changeMemberRole, null);
  const [removeState, removeAction, removing] = useActionState(removeMember, null);
  const editable = !row.isCurrentUser && canManageRole(actorRole, row.role, row.role);
  const nextRoles = MEMBER_ROLES.filter((role) => canManageRole(actorRole, row.role, role));
  return (
    <article className={styles.card}>
      <header className={styles.cardHead}>
        <div>
          <strong>{row.email}</strong>
          <span>
            {ROLE_PROFILES[row.role].label}
            {row.isCurrentUser ? ' · You' : ''}
          </span>
        </div>
        <small>Active</small>
      </header>
      {editable ? (
        <div className={styles.actions}>
          <form action={roleAction} className={styles.roleForm}>
            <input type="hidden" name="member_id" value={row.userId} />
            <select name="role" defaultValue={row.role} aria-label={`Role for ${row.email}`}>
              {nextRoles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_PROFILES[role].label}
                </option>
              ))}
            </select>
            <Button>{changing ? 'Saving…' : 'Change role'}</Button>
          </form>
          <form action={removeAction}>
            <input type="hidden" name="member_id" value={row.userId} />
            <Button danger>{removing ? 'Removing…' : 'Remove access'}</Button>
          </form>
        </div>
      ) : null}
      <Message state={roleState} />
      <Message state={removeState} />
    </article>
  );
}
