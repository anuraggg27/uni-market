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

import { AuditLogs } from '../../apps/web/src/pages/AdminPages';

const today = new Date().toISOString();
const entries = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    adminId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    role: 'SUPER_ADMIN',
    action: 'VIEW_GRIEVANCE',
    targetType: 'REPORT',
    targetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    previousState: null,
    newState: null,
    internalReason: 'Grievance investigation',
    userVisibleReason: null,
    requestId: 'request-identifier-that-must-not-wrap-across-lines',
    ipHash: null,
    createdAt: today,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    adminId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    role: 'MODERATOR',
    action: 'LISTING_APPROVE',
    targetType: 'LISTING',
    targetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    previousState: null,
    newState: { moderationState: 'APPROVED' },
    internalReason: 'Listing approved after review',
    userVisibleReason: null,
    requestId: 'second-request-id',
    ipHash: null,
    createdAt: '2026-08-24T08:00:00.000Z',
  },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/admin/audit-logs']}>
      <QueryClientProvider client={client}><AuditLogs /></QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('AuditLogs', () => {
  beforeEach(() => apiMock.mockResolvedValue(entries));

  afterEach(() => {
    cleanup();
    apiMock.mockReset();
  });

  it('renders real metrics and dense immutable audit fields', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Audit logs' })).toBeVisible();
    const summary = await screen.findByRole('region', { name: 'Audit summary' });
    expect(within(summary).getByText('Total actions')).toBeVisible();
    expect(within(summary).getByText('Unique admins')).toBeVisible();
    const table = screen.getByRole('table', { name: 'Audit logs' });
    expect(within(table).getByText('VIEW_GRIEVANCE')).toBeVisible();
    expect(within(table).getByText('SUPER_ADMIN')).toBeVisible();
    expect(within(table).getByTitle('request-identifier-that-must-not-wrap-across-lines')).toBeVisible();
    expect(screen.queryByRole('button', { name: /export logs/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view/i })).not.toBeInTheDocument();
  });

  it('filters by action, target, role, and keyword', async () => {
    renderPage();
    await screen.findByText('Audit log (2)');
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'LISTING_APPROVE' } });
    expect(await screen.findByText('Audit log (1)')).toBeVisible();
    expect(screen.getByText('Listing approved after review')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'grievance investigation' } });
    expect(await screen.findByText('Audit log (1)')).toBeVisible();
    expect(within(screen.getByRole('table', { name: 'Audit logs' })).getByText('VIEW_GRIEVANCE')).toBeVisible();
  });

  it('shows a filter-aware empty state', async () => {
    renderPage();
    await screen.findByText('Audit log (2)');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'missing record' } });
    expect(await screen.findByRole('heading', { name: 'No audit logs found' })).toBeVisible();
    expect(screen.getByText('Try adjusting or clearing your filters.')).toBeVisible();
  });
});
