import type { ReactNode } from 'react';
import { AlertCircle, Inbox, LoaderCircle, ShieldCheck } from 'lucide-react';
import { safetyReminder } from '@campus-market/shared';
import { ApiError } from '../api';

export function Loading({ label = 'Loading' }: { label?: string }) { return <div className="stack" role="status" aria-live="polite"><div className="skeleton h-44" /><span className="sr-only">{label}</span></div>; }
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) { const message = error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong'; return <div className="state"><AlertCircle aria-hidden="true"/><h2>Couldn’t load this</h2><p>{message}</p>{retry ? <button className="button secondary" onClick={retry}>Try again</button> : null}</div>; }
export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) { return <div className="state"><Inbox aria-hidden="true"/><h2>{title}</h2><p>{body}</p>{action}</div>; }
export function SafetyReminder({ compact = false }: { compact?: boolean }) { return <aside className={`safety ${compact ? 'compact' : ''}`}><ShieldCheck aria-hidden="true"/><div><strong>Meet safely</strong><p>{safetyReminder}</p></div></aside>; }
export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) { return <button className="button primary" type="submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" aria-hidden="true"/>Saving…</> : children}</button>; }
export function StatusBadge({ value }: { value: string }) { return <span className={`status status-${value.toLowerCase().replaceAll('_', '-')}`}>{value.replaceAll('_', ' ')}</span>; }
export function FieldError({ children }: { children?: ReactNode }) { return children ? <p className="field-error" role="alert">{children}</p> : null; }
