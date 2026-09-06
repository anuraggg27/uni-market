// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../../apps/web/src/api', () => ({
  api: apiMock,
  jsonBody: (value: unknown) => ({ body: JSON.stringify(value) }),
}));

vi.mock('../../apps/web/src/auth', () => ({
  useAuth: () => ({
    user: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      displayName: 'Support Admin',
      avatarId: 'avatar-02',
      roles: ['SUPPORT_AGENT'],
    },
  }),
}));

import { AdminSupport } from '../../apps/web/src/pages/AdminPages';

const today = new Date().toISOString();
const tickets = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    category: 'ACCOUNT',
    subject: 'Unable to verify college email',
    description: 'Verification is not completing.',
    status: 'OPEN',
    assignedTo: null,
    referenceType: null,
    referenceId: null,
    escalatedReportId: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: '2026-09-05T08:00:00.000Z',
    updatedAt: '2026-09-06T08:00:00.000Z',
    requester: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', displayName: 'Shubhang Sharma', avatarId: 'avatar-01' },
    assignee: null,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    category: 'TRANSACTION',
    subject: 'Payment confirmation not received',
    description: 'The exchange confirmation is missing.',
    status: 'WAITING_FOR_USER',
    assignedTo: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    referenceType: 'TRANSACTION',
    referenceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    escalatedReportId: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: '2026-09-04T08:00:00.000Z',
    updatedAt: '2026-09-06T09:00:00.000Z',
    requester: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', displayName: 'Sneha Kapoor', avatarId: 'avatar-03' },
    assignee: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', displayName: 'Support Admin', avatarId: 'avatar-02' },
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    userId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    category: 'SAFETY',
    subject: 'Safety concern resolved',
    description: 'This issue has been resolved.',
    status: 'RESOLVED',
    assignedTo: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    referenceType: null,
    referenceId: null,
    escalatedReportId: null,
    resolvedAt: today,
    closedAt: null,
    createdAt: '2026-09-03T08:00:00.000Z',
    updatedAt: today,
    requester: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', displayName: 'Aarav Mehta', avatarId: 'avatar-04' },
    assignee: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', displayName: 'Rohan Verma', avatarId: 'avatar-05' },
  },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/admin/support']}>
      <QueryClientProvider client={client}><AdminSupport /></QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('AdminSupport', () => {
  beforeEach(() => apiMock.mockResolvedValue(tickets));

  afterEach(() => {
    cleanup();
    apiMock.mockReset();
  });

  it('renders metrics and real support queue fields without fake controls', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Support', level: 2 })).toBeVisible();
    expect(await screen.findByRole('region', { name: 'Support summary' })).toHaveTextContent('Resolved today');
    const table = screen.getByRole('table', { name: 'Support queue' });
    expect(within(table).getByText('Unable to verify college email')).toBeVisible();
    expect(within(table).getByText('Account')).toBeVisible();
    expect(within(table).getByText('Shubhang Sharma')).toBeVisible();
    expect(within(table).getByText('Rohan Verma')).toBeVisible();
    expect(within(table).getByText('Shubhang Sharma').closest('.admin-support-identity')?.querySelector('[data-avatar-id="avatar-01"]')).toBeVisible();
    expect(within(table).getByText('You')).toBeVisible();
    expect(within(table).getByRole('link', { name: /open thread/i })).toHaveAttribute('href', '/admin/support/22222222-2222-4222-8222-222222222222');
    expect(screen.queryByRole('button', { name: /export tickets/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/live queue/i)).not.toBeInTheDocument();
  });

  it('filters by status, assignment, and keyword', async () => {
    renderPage();
    await screen.findByText('Support queue (3)');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'WAITING_FOR_USER' } });
    expect(await screen.findByText('Support queue (1)')).toBeVisible();
    expect(screen.getByText('Payment confirmation not received')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.change(screen.getByLabelText('Assigned to'), { target: { value: 'UNASSIGNED' } });
    expect(await screen.findByText('Support queue (1)')).toBeVisible();
    expect(screen.getByText('Unable to verify college email')).toBeVisible();
  });

  it('shows a filter-aware empty state', async () => {
    renderPage();
    await screen.findByText('Support queue (3)');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'does-not-exist' } });
    expect(await screen.findByRole('heading', { name: 'No tickets match your filters' })).toBeVisible();
  });
});
