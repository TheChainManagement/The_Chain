// @vitest-environment jsdom
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CredentialReveal } from '@/app/(app)/settings/team/TeamManager';

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
