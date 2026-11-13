// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider, RequireAuth } from '../../apps/web/src/auth';
import { postLoginDestination } from '../../apps/web/src/auth-routing';

vi.mock('../../apps/web/src/api', () => ({ api: vi.fn().mockResolvedValue(null) }));
afterEach(cleanup);
function LoginTarget() {
  const location = useLocation();
  return <div>{location.state?.from}</div>;
}
it('sends a signed-out conversation visitor to login and preserves the conversation after authentication', async () => {
  const requested = '/chats/87b566ec-1b85-4de3-b4c8-79002d589466';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[requested]}><AuthProvider><Routes>
    <Route path="/chats/:id" element={<RequireAuth><div>Private chat</div></RequireAuth>} />
    <Route path="/login" element={<LoginTarget />} />
  </Routes></AuthProvider></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText(requested)).toBeVisible();
  expect(screen.queryByText('Private chat')).not.toBeInTheDocument();
  expect(postLoginDestination({ onboardingComplete: true, roles: ['USER'] }, requested)).toBe(requested);
  client.clear();
});
