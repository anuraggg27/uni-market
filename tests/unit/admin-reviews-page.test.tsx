// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../../apps/web/src/api', () => ({
  api: apiMock,
  jsonBody: (value: unknown) => ({ body: JSON.stringify(value) }),
}));

import { AdminReviews } from '../../apps/web/src/pages/AdminPages';

const reviews = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    transactionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    reviewerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    revieweeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    rating: 5,
    text: 'Great quality and a smooth exchange.',
    tags: ['Friendly', 'Accurate'],
    hiddenAt: null,
    hiddenReason: null,
    deletedAt: null,
    createdAt: '2026-09-06T10:20:00.000Z',
    direction: 'BUYER_TO_SELLER',
    listing: { id: 'listing-1', title: 'Trek FX 3 Hybrid Bike', coverImageUrl: 'https://images.example/bike.webp' },
    reviewer: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', displayName: 'Aarav Mehta', avatarId: 'avatar-02' },
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    transactionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    reviewerId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    revieweeId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    rating: 3,
    text: 'Item condition differed from the description.',
    tags: [],
    hiddenAt: '2026-09-06T11:00:00.000Z',
    hiddenReason: 'Personal information',
    deletedAt: null,
    createdAt: '2026-09-05T08:14:00.000Z',
    direction: 'SELLER_TO_BUYER',
    listing: { id: 'listing-2', title: 'Calculator', coverImageUrl: 'https://images.example/calculator.webp' },
    reviewer: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', displayName: 'Sneha Kapoor', avatarId: 'avatar-03' },
  },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/admin/reviews']}>
      <QueryClientProvider client={client}>
        <AdminReviews />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('AdminReviews', () => {
  beforeEach(() => {
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/admin/reviews') return Promise.resolve(reviews);
      if (path === '/api/admin/reviews/' + reviews[0].id + '/hide') return Promise.resolve({ ...reviews[0], hiddenAt: new Date().toISOString() });
      return Promise.reject(new Error('Unexpected API call: ' + path));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    apiMock.mockReset();
  });

  it('renders real metrics, visual ratings, reviewer context and visibility states', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Reviews', level: 2 })).toBeVisible();
    const summary = (await screen.findByText('Total reviews')).closest('section')!;
    expect(within(summary).getByText('Total reviews')).toBeVisible();
    expect(within(summary).getByText('Buyer \u2192 Seller')).toBeVisible();
    expect(within(summary).getByText('Seller \u2192 Buyer')).toBeVisible();
    expect(within(summary).getByText('Hidden')).toBeVisible();
    expect(screen.getByRole('img', { name: '5 out of 5 stars' })).toBeVisible();
    const table = screen.getByRole('table', { name: 'Reviews' });
    expect(within(table).getByRole('img', { name: 'Trek FX 3 Hybrid Bike' })).toHaveAttribute('src', 'https://images.example/bike.webp');
    expect(within(table).getByRole('img', { name: "Aarav Mehta's avatar" })).toHaveAttribute('data-avatar-id', 'avatar-02');
    expect(within(table).getByText('Aarav Mehta')).toBeVisible();
    expect(within(table).getByText('Sneha Kapoor')).toBeVisible();
    expect(within(table).getByText('Buyer \u2192 Seller')).toBeVisible();
    expect(within(table).getByText('Seller \u2192 Buyer')).toBeVisible();
    expect(screen.getByText('VISIBLE')).toBeVisible();
    expect(screen.getByText('HIDDEN')).toBeVisible();
    expect(screen.queryByText(/under review/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /export reviews/i })).not.toBeInTheDocument();
  });

  it('filters and sorts the returned reviews without fake backend states', async () => {
    renderPage();
    await screen.findByText('Reviews (2)');
    fireEvent.change(screen.getByLabelText('Rating'), { target: { value: '3' } });
    expect(await screen.findByText('Reviews (1)')).toBeVisible();
    expect(within(screen.getByRole('table', { name: 'Reviews' })).getByText('Sneha Kapoor')).toBeVisible();
    expect(within(screen.getByRole('table', { name: 'Reviews' })).queryByText('Aarav Mehta')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.change(screen.getByLabelText('Review type'), { target: { value: 'SELLER_TO_BUYER' } });
    expect(await screen.findByText('Reviews (1)')).toBeVisible();
    expect(within(screen.getByRole('table', { name: 'Reviews' })).getByText('Sneha Kapoor')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'VISIBLE' } });
    expect(await screen.findByText('Reviews (1)')).toBeVisible();
    expect(within(screen.getByRole('table', { name: 'Reviews' })).getByText('Aarav Mehta')).toBeVisible();
  });

  it('preserves the existing hide-review reason flow', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Contains personal information');
    renderPage();
    const table = await screen.findByRole('table', { name: 'Reviews' });
    fireEvent.click(within(table).getByRole('button', { name: 'Hide review' }));
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        '/api/admin/reviews/' + reviews[0].id + '/hide',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reason: 'Contains personal information' }),
        }),
      );
    });
  });
});
