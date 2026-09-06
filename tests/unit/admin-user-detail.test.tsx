// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../../apps/web/src/api', () => ({
  api: apiMock,
  jsonBody: (value: unknown) => ({ body: JSON.stringify(value) }),
}));

vi.mock('../../apps/web/src/auth', () => ({
  useAuth: () => ({ user: { id: 'admin', roles: ['SUPER_ADMIN'] } }),
}));

import { AdminUserDetail } from '../../apps/web/src/pages/AdminPages';

const user = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  displayName: 'Zoya Mehta',
  email: 'zoya@example.edu',
  avatarId: 'avatar-01',
  institution: 'Uni Market University',
  campus: 'North Campus',
  phoneE164: '+91******321',
  phoneVerifiedAt: '2026-09-01T08:00:00.000Z',
  studentEmailVerifiedAt: '2026-08-30T08:00:00.000Z',
  onboardingComplete: true,
  suspendedAt: null,
  deletedAt: null,
  closedAt: null,
  fraudInvestigation: false,
  completedSales: 3,
  lastActiveAt: '2026-09-06T09:00:00.000Z',
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
  roles: [
    { role: 'USER', createdAt: '2026-08-01T08:00:00.000Z' },
    { role: 'SUPER_ADMIN', createdAt: '2026-09-01T08:00:00.000Z' },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[`/admin/users/${user.id}`]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path='/admin/users/:userId' element={<AdminUserDetail />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('AdminUserDetail', () => {
  beforeEach(() => {
    apiMock.mockImplementation((path: string) => {
      if (path === `/api/admin/users/${user.id}`) return Promise.resolve(user);
      if (path === '/api/admin/audit-logs') {
        return Promise.resolve([{
          id: 'audit-1',
          action: 'USER_ROLES_UPDATE',
          targetType: 'USER',
          targetId: user.id,
          internalReason: 'Approved staff access',
          createdAt: '2026-09-01T08:00:00.000Z',
        }]);
      }
      if (path === `/api/admin/users/${user.id}/roles`) return Promise.resolve({ roles: ['USER'] });
      if (path === `/api/admin/users/${user.id}/warn`) return Promise.resolve(undefined);
      return Promise.reject(new Error('Unexpected API call: ' + path));
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders only real account data in the structured detail workspace', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'User profile' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'User overview' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Account signals' })).toBeVisible();
    expect(screen.getByText('Zoya Mehta')).toBeVisible();
    expect(screen.getAllByText('North Campus · Uni Market University').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /view in marketplace/i })).toHaveAttribute(
      'href',
      `/seller/${user.id}`,
    );
    expect(screen.getByRole('heading', { name: 'Staff access' })).toBeVisible();
    expect(await screen.findByText('Approved staff access')).toBeVisible();
    expect(screen.queryByText(/trust score/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/total reports/i)).not.toBeInTheDocument();
  });

  it('preserves the staff role update mutation and reason', async () => {
    renderPage();
    const card = await screen.findByRole('region', { name: 'Staff access' });
    fireEvent.click(within(card).getByRole('checkbox', { name: /super admin/i }));
    fireEvent.change(within(card).getByPlaceholderText(/reason for this access change/i), {
      target: { value: 'Return account to standard user access' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Update staff access' }));
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        `/api/admin/users/${user.id}/roles`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            roles: [],
            reason: 'Return account to standard user access',
          }),
        }),
      );
    });
  });

  it('preserves the warning action and audit reason', async () => {
    renderPage();
    const card = await screen.findByRole('region', { name: 'Moderation actions' });
    fireEvent.change(within(card).getByPlaceholderText(/describe the reason/i), {
      target: { value: 'Please follow the marketplace conduct policy' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Record action' }));
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        `/api/admin/users/${user.id}/warn`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reason: 'Please follow the marketplace conduct policy' }),
        }),
      );
    });
  });
});

