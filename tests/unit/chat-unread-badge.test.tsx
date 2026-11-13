// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiMock, auth, handlers, connection } = vi.hoisted(() => {
  const handlers = new Map<string, () => void>();
  return { apiMock: vi.fn(), auth: { user: { id: 'seller-1' } as { id: string } | null }, handlers,
    connection: { connected: true, on: vi.fn((event, handler) => handlers.set(event, handler)), off: vi.fn(),
      connect: vi.fn(), disconnect: vi.fn() } };
});
vi.mock('../../apps/web/src/api', () => ({ api: apiMock }));
vi.mock('../../apps/web/src/auth', () => ({ useAuth: () => auth }));
vi.mock('socket.io-client', () => ({ io: () => connection }));
import { ChatUnreadBadge } from '../../apps/web/src/components/ChatUnreadBadge';
import { NotificationUpdates } from '../../apps/web/src/components/NotificationUpdates';

function view(client: QueryClient) {
  return <QueryClientProvider client={client}><MemoryRouter><NotificationUpdates /><ChatUnreadBadge /><ChatUnreadBadge /></MemoryRouter></QueryClientProvider>;
}
beforeEach(() => { auth.user = { id: 'seller-1' }; handlers.clear(); apiMock.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); connection.connected = true; });

describe('unread conversation navigation badges', () => {
  it('shares a count request across navigation locations and refreshes on incoming messages and reads', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    apiMock.mockResolvedValue({ count: 3 });
    render(view(client));
    expect(await screen.findAllByLabelText('3 unread conversations')).toHaveLength(2);
    expect(apiMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(handlers.has('chats:updated')).toBe(true));
    apiMock.mockResolvedValue({ count: 4 });
    act(() => handlers.get('notifications:updated')!());
    expect(await screen.findAllByLabelText('4 unread conversations')).toHaveLength(2);
    apiMock.mockResolvedValue({ count: 0 });
    act(() => handlers.get('chats:updated')!());
    await waitFor(() => expect(screen.queryByLabelText(/unread conversations/)).not.toBeInTheDocument());
    client.clear();
  });

  it('does not show a previous account count after a user switch or sign-out', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    apiMock.mockResolvedValue({ count: 8 });
    const result = render(view(client));
    await screen.findAllByLabelText('8 unread conversations');
    auth.user = { id: 'seller-2' };
    apiMock.mockResolvedValue({ count: 1 });
    result.rerender(view(client));
    expect(screen.queryByLabelText('8 unread conversations')).not.toBeInTheDocument();
    expect(client.getQueryData(['unread-conversations', 'seller-1'])).toBeUndefined();
    await screen.findAllByLabelText('1 unread conversations');
    auth.user = null;
    result.rerender(view(client));
    expect(screen.queryByLabelText(/unread conversations/)).not.toBeInTheDocument();
    expect(client.getQueryData(['unread-conversations', 'seller-1'])).toBeUndefined();
    client.clear();
  });

  it('recovers missed updates on reconnect, visibility and the existing disconnected fallback', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    apiMock.mockResolvedValue({ count: 2 });
    render(view(client));
    await screen.findAllByLabelText('2 unread conversations');
    await waitFor(() => expect(handlers.has('connect')).toBe(true));
    apiMock.mockResolvedValue({ count: 3 });
    act(() => handlers.get('connect')!());
    await screen.findAllByLabelText('3 unread conversations');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    apiMock.mockResolvedValue({ count: 4 });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await screen.findAllByLabelText('4 unread conversations');
    const calls = apiMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(15_001); });
    expect(apiMock).toHaveBeenCalledTimes(calls);
    connection.connected = false;
    apiMock.mockResolvedValue({ count: 5 });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_001); });
    expect(await screen.findAllByLabelText('5 unread conversations')).toHaveLength(2);
    client.clear();
  });

  it('aborts an old account request during an account switch', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let oldSignal: AbortSignal | undefined;
    apiMock.mockImplementationOnce((_path: string, options: { signal: AbortSignal }) => {
      oldSignal = options.signal;
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Aborted'))));
    }).mockResolvedValue({ count: 1 });
    const result = render(view(client));
    await waitFor(() => expect(oldSignal).toBeDefined());
    auth.user = { id: 'seller-2' };
    result.rerender(view(client));
    await screen.findAllByLabelText('1 unread conversations');
    expect(oldSignal!.aborted).toBe(true);
    expect(client.getQueryData(['unread-conversations', 'seller-1'])).toBeUndefined();
    client.clear();
  });
});
