// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CredentialReveal, MemberCard } from '@/app/(app)/settings/team/TeamManager';

describe('one-time credential reveal', () => {
  it('renders the generated credential and copies only the temporary password', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const view = render(
      <CredentialReveal
        state={{
          ok: true,
          message: 'Created.',
          credential: {
            email: 'new-person@example.test',
            password: 'OneTime!234',
            expiresAt: '2026-07-18T12:00:00.000Z',
          },
        }}
      />,
    );

    expect(
      view.getByRole('complementary', { name: 'One-time temporary credential' }),
    ).toBeVisible();
    expect(view.getByText('Shown once')).toBeVisible();
    expect(view.getByText('OneTime!234')).toBeVisible();
    await user.click(view.getByRole('button', { name: 'Copy password' }));
    expect(writeText).toHaveBeenCalledWith('OneTime!234');
    expect(view.getByRole('button', { name: 'Copied' })).toBeVisible();
  });

  it('renders nothing when an existing account keeps its password', () => {
    const { container } = render(
      <CredentialReveal state={{ ok: true, message: 'Use the existing password.' }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('owner-controlled requisition authority', () => {
  const member = {
    userId: 'member-1',
    email: 'planner@example.test',
    role: 'planner' as const,
    createdAt: '2026-07-20T12:00:00.000Z',
    isCurrentUser: false,
    allLocations: true,
    locationIds: [],
    requesterMode: 'always_require_approval' as const,
    requesterLimit: null,
    approverLimit: null,
  };

  it('lets an owner choose an explicit requester mode and reveals its amount field', async () => {
    render(<MemberCard row={member} actorRole="owner" locations={[]} />);
    const mode = screen.getByLabelText('Request authority for planner@example.test');
    expect(mode).toHaveValue('always_require_approval');
    await userEvent.selectOptions(mode, 'auto_approve_to_limit');
    expect(screen.getByLabelText('Automatic request limit for planner@example.test')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save authority' })).toBeVisible();
  });

  it('does not expose authority controls to a manager', () => {
    render(<MemberCard row={member} actorRole="manager" locations={[]} />);
    expect(screen.queryByText('Requisition authority')).not.toBeInTheDocument();
  });

  it('shows an approver ceiling only for an eligible owner or manager target', () => {
    render(
      <MemberCard
        row={{ ...member, role: 'manager', approverLimit: 50_000 }}
        actorRole="owner"
        locations={[]}
      />,
    );
    expect(screen.getByLabelText('Approval ceiling for planner@example.test')).toHaveValue(50000);
  });
});
