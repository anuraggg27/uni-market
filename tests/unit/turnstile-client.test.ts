// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, screen, waitFor } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type WidgetOptions = {
  callback: (token: string) => void;
  'error-callback': (code: string) => boolean;
  'expired-callback': () => void;
  'timeout-callback': () => void;
};

describe('Turnstile challenge recovery', () => {
  let options: WidgetOptions;
  let renderWidget: ReturnType<typeof vi.fn>;
  let resetWidget: ReturnType<typeof vi.fn>;
  let removeWidget: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-site-key');
    renderWidget = vi.fn((_container, config) => { options = config; return 'widget-1'; });
    resetWidget = vi.fn();
    removeWidget = vi.fn();
    window.turnstile = {
      ready: vi.fn(() => { throw new Error('[Cloudflare Turnstile] Remove async/defer from the Turnstile api.js script tag before using turnstile.ready().'); }),
      render: renderWidget, reset: resetWidget, remove: removeWidget,
    };
  });
  afterEach(() => {
    document.body.replaceChildren();
    document.head.querySelectorAll('script[src*="challenges.cloudflare.com"]').forEach((script) => script.remove());
    delete window.turnstile;
    delete window.__uniMarketTurnstileLoaded;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps the popup open through a transient error and resolves only after successful verification', async () => {
    const { solveTurnstile } = await import('../../apps/web/src/turnstile');
    const result = solveTurnstile();
    await screen.findByRole('dialog');
    options['error-callback']('300030');
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Reference: 300030');
    expect(removeWidget).not.toHaveBeenCalled();
    expect(renderWidget.mock.calls[0]![1]).toMatchObject({ retry: 'auto', size: 'compact' });
    options.callback('fresh-token');
    await expect(result).resolves.toBe('fresh-token');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(removeWidget).toHaveBeenCalledOnce();
  });

  it('allows retries after errors and timeouts without cancelling the pending action', async () => {
    const { solveTurnstile } = await import('../../apps/web/src/turnstile');
    const result = solveTurnstile();
    await screen.findByRole('dialog');
    for (const report of [() => options['error-callback']('200500'), options['expired-callback'], options['timeout-callback']]) {
      report();
      expect(screen.getByRole('dialog')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(resetWidget).toHaveBeenLastCalledWith('widget-1');
    }
    expect(resetWidget).toHaveBeenCalledTimes(3);
    options.callback('fresh-token');
    await expect(result).resolves.toBe('fresh-token');
  });

  it('keeps configuration errors visible and cleans up when the visitor cancels', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { solveTurnstile } = await import('../../apps/web/src/turnstile');
    const result = solveTurnstile();
    const rejection = expect(result).rejects.toThrow('Security check cancelled');
    await screen.findByRole('dialog');
    options['error-callback']('110200');
    expect(screen.getByRole('status')).toHaveTextContent('unavailable for this site');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await rejection;
    options.callback('late-token');
    expect(removeWidget).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
  });

  it('allows a fresh script load after a network failure', async () => {
    const turnstile = window.turnstile;
    delete window.turnstile;
    const { solveTurnstile } = await import('../../apps/web/src/turnstile');
    const failed = solveTurnstile();
    const rejection = expect(failed).rejects.toThrow('could not load');
    const firstScript = document.head.querySelector('script')!;
    fireEvent.error(firstScript);
    await rejection;
    expect(firstScript).not.toBeInTheDocument();
    const retried = solveTurnstile();
    const nextScript = document.head.querySelector('script')!;
    expect(nextScript).not.toBe(firstScript);
    window.turnstile = turnstile;
    window.__uniMarketTurnstileLoaded!();
    await screen.findByRole('dialog');
    options.callback('fresh-token');
    await expect(retried).resolves.toBe('fresh-token');
  });

  it('waits for the SDK onload callback with async loading, without calling ready()', async () => {
    const turnstile = window.turnstile!;
    delete window.turnstile;
    const { solveTurnstile } = await import('../../apps/web/src/turnstile');
    const result = solveTurnstile();
    const script = document.head.querySelector<HTMLScriptElement>('script')!;
    expect(script.async).toBe(true);
    const callbackName = new URL(script.src).searchParams.get('onload');
    expect(callbackName).toBe('__uniMarketTurnstileLoaded');
    window.turnstile = turnstile;
    fireEvent.load(script);
    await Promise.resolve();
    expect(renderWidget).not.toHaveBeenCalled();
    window.__uniMarketTurnstileLoaded!();
    await screen.findByRole('dialog');
    expect(turnstile.ready).not.toHaveBeenCalled();
    options.callback('fresh-token');
    await expect(result).resolves.toBe('fresh-token');
    expect(window.__uniMarketTurnstileLoaded).toBeUndefined();

    const subsequent = solveTurnstile();
    await screen.findByRole('dialog');
    options.callback('second-token');
    await expect(subsequent).resolves.toBe('second-token');
    expect(turnstile.ready).not.toHaveBeenCalled();
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
  });

  it('leaves no orphaned popup after a render failure', async () => {
    renderWidget.mockImplementationOnce(() => { throw new Error('initialization failed'); });
    const { solveTurnstile } = await import('../../apps/web/src/turnstile');
    const result = solveTurnstile();
    expect(renderWidget).not.toHaveBeenCalled();
    await screen.findByRole('dialog');
    expect(screen.getByRole('status')).toHaveTextContent('could not start');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(2));
    options.callback('fresh-token');
    await expect(result).resolves.toBe('fresh-token');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
