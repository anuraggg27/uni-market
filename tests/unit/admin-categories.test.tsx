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

import { AdminCategories } from '../../apps/web/src/pages/AdminPages';

const categories = [
  { id: 'category-1', name: 'Books & notes', slug: 'books-notes', active: true, sortOrder: 4 },
  { id: 'category-2', name: 'Room essentials', slug: 'room-essentials', active: false, sortOrder: 8 },
];

const terms = [
  { id: 'term-1', term: 'fake id', severity: 'FLAG', active: true },
  { id: 'term-2', term: 'gift card', severity: 'BLOCK', active: false },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/admin/categories']}>
      <QueryClientProvider client={client}><AdminCategories /></QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('AdminCategories', () => {
  beforeEach(() => {
    apiMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (!options?.method && path === '/api/admin/categories') return Promise.resolve(categories);
      if (!options?.method && path === '/api/admin/prohibited-terms') return Promise.resolve(terms);
      return Promise.resolve({});
    });
  });

  afterEach(() => {
    cleanup();
    apiMock.mockReset();
  });

  it('renders real category metrics, ordering, and enforcement states', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Categories' })).toBeVisible();
    const summary = await screen.findByRole('region', { name: 'Category summary' });
    expect(within(summary).getByText('Total categories')).toBeVisible();
    expect(within(summary).getByText('Active categories')).toBeVisible();
    expect(within(summary).getByText('Disabled categories')).toBeVisible();

    const categoryTable = screen.getByRole('table', { name: 'Categories' });
    expect(within(categoryTable).getByText('Books & notes')).toBeVisible();
    expect(within(categoryTable).getByText('books-notes')).toBeVisible();
    expect(within(categoryTable).getByText('4')).toBeVisible();

    const termTable = screen.getByRole('table', { name: 'Prohibited terms' });
    expect(within(termTable).getByText('fake id')).toBeVisible();
    expect(within(termTable).getByText('FLAG')).toBeVisible();
    expect(within(termTable).getByText('BLOCK')).toBeVisible();
    expect(screen.queryByRole('button', { name: /save order/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit/i })).not.toBeInTheDocument();
  });

  it('preserves category create and enable-disable API behavior', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Categories' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Electronics' } });
    fireEvent.change(screen.getByRole('textbox', { name: /slug/i }), { target: { value: 'electronics' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /sort order/i }), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/admin/categories', {
      method: 'POST',
      body: JSON.stringify({ name: 'Electronics', slug: 'electronics', sortOrder: 12 }),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Disable Books & notes' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/admin/categories/category-1', {
      method: 'PATCH',
      body: JSON.stringify({ active: false }),
    }));
  });

  it('preserves prohibited-term create and enable-disable API behavior', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Prohibited terms' });
    fireEvent.change(screen.getByLabelText('Term or phrase'), { target: { value: 'answer key' } });
    fireEvent.change(screen.getByLabelText('Enforcement'), { target: { value: 'BLOCK' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add term' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/admin/prohibited-terms', {
      method: 'POST',
      body: JSON.stringify({ term: 'answer key', severity: 'BLOCK' }),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Enable gift card' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/admin/prohibited-terms/term-2', {
      method: 'PATCH',
      body: JSON.stringify({ active: true }),
    }));
  });
});
