import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const origin = 'https://uni.rocks';

export function evaluateMetrics(metrics, now = Date.now()) {
  const issues = [];
  const validCount = (value) => Number.isFinite(value) && value >= 0;
  if (metrics?.version !== 1 || metrics.windowMinutes !== 60 || !Number.isFinite(Date.parse(metrics.checkedAt)) ||
      Math.abs(now - Date.parse(metrics.checkedAt)) > 5 * 60_000) {
    return ['Operational metrics are missing, incompatible or stale.'];
  }
  if (!metrics.database?.ok) issues.push('Database readiness check failed.');
  if (!validCount(metrics.disk?.usedPercent) || !validCount(metrics.disk?.freeBytes)) {
    issues.push('Droplet filesystem usage could not be measured.');
  } else if (metrics.disk.usedPercent >= 85 || metrics.disk.freeBytes < 1024 ** 3 || metrics.disk.inodeUsedPercent >= 85) {
    issues.push(`Droplet filesystem is low on space or inodes (${metrics.disk.usedPercent}% space used).`);
  }
  const mail = metrics.database?.email;
  if (metrics.database?.ok) {
    if (!mail || ![mail.failed, mail.pending, mail.oldestPendingSeconds].every(validCount)) {
      issues.push('Email queue metrics could not be read.');
    } else {
      if (mail.failed > 0) issues.push(`${mail.failed} email job(s) exhausted retries in the last 24 hours.`);
      if (mail.oldestPendingSeconds >= 900) issues.push(`Email queue is delayed (${mail.pending} pending; oldest at least 15 minutes).`);
    }
  }
  for (const signal of ['otp_provider', 'otp_widget', 'email_delivery', 'email_worker']) {
    const counts = metrics.signals?.[signal];
    if (!counts || ![counts.successes, counts.failures].every(validCount)) {
      issues.push(`Missing ${signal} telemetry.`);
      continue;
    }
    const threshold = signal === 'otp_widget' ? 3 : 1;
    if (counts.failures >= threshold && (signal !== 'otp_widget' || counts.failures >= counts.successes)) {
      issues.push(`${signal}: ${counts.failures} failure(s) observed in the last ${metrics.windowMinutes} minutes.`);
    }
  }
  return issues;
}

async function request(url, options = {}, fetcher = fetch) {
  const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

export async function probeProduction(token, fetcher = fetch) {
  const issues = [];
  for (const [name, url, check] of [
    ['Public health', `${origin}/health`, async (r) => (await r.json()).status === 'ok'],
    ['Marketplace page', `${origin}/marketplace`, async (r) => (await r.text()).includes('Uni Market')],
  ]) {
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try { ok = await check(await request(url, {}, fetcher)); } catch { /* retry once, never log response bodies */ }
    }
    if (!ok) issues.push(`${name} is unavailable after two checks.`);
  }
  if (!/^[a-fA-F0-9]{64}$/.test(token ?? '')) {
    issues.push('MONITORING_TOKEN is missing or invalid; internal checks are not active.');
  } else {
    try {
      const result = await request(`${origin}/api/internal/operations`, { headers: { authorization: `Bearer ${token}` } }, fetcher);
      issues.push(...evaluateMetrics(await result.json()));
    } catch { issues.push('Protected operational checks are unavailable (check the app, database and monitoring token).'); }
  }
  return issues;
}

function githubClient(env, fetcher = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '') || !env.GH_TOKEN) throw new Error('GitHub alert configuration is missing');
  return async (route, method = 'GET', data) => {
    const response = await request(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${route}`, {
      method,
      headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'content-type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}),
    }, fetcher);
    return response.status === 204 ? null : response.json();
  };
}

export async function reconcileIncident(client, kind, issues, runUrl, assignees = []) {
  const title = `[Operations] ${kind}`;
  const marker = `<!-- uni-market-operations:${kind} -->`;
  const signature = createHash('sha256').update(JSON.stringify(issues)).digest('hex');
  const fingerprint = `<!-- signature:${signature} -->`;
  // Follow pagination so a busy support repository cannot hide an open incident.
  let existing;
  for (let page = 1; ; page++) {
    const rows = await client(`issues?state=open&per_page=100&page=${page}`);
    existing = rows.find((issue) => !issue.pull_request && issue.title === title && issue.body?.includes(marker));
    if (existing || rows.length < 100) break;
  }
  if (!issues.length) {
    if (existing) {
      await client(`issues/${existing.number}/comments`, 'POST', { body: `Checks recovered. [Verification run](${runUrl}).` });
      await client(`issues/${existing.number}`, 'PATCH', { state: 'closed', state_reason: 'completed' });
    }
    return;
  }
  const body = `${marker}\n${fingerprint}\nAutomated checks need an admin to investigate:\n\n${issues.map((item) => `- ${item}`).join('\n')}\n\n[Workflow run](${runUrl}) · Runbook: docs/recovery-and-alerts.md\n\nNo customer data or provider error payloads are included. This issue closes automatically once checks recover.`;
  if (!existing) await client('issues', 'POST', { title, body, ...(assignees.length ? { assignees } : {}) });
  else if (!existing.body.includes(fingerprint)) {
    await client(`issues/${existing.number}`, 'PATCH', { body });
    await client(`issues/${existing.number}/comments`, 'POST', { body: `Incident conditions changed:\n\n${issues.map((item) => `- ${item}`).join('\n')}\n\n[Workflow run](${runUrl}).` });
  }
}

async function checkStoredBackup(runId, attempt, env = process.env) {
  const { verifyR2Backup } = await import('./r2-backups.mjs');
  await verifyR2Backup(env, runId, attempt);
}

export async function checkBackupFreshness(client, now = Date.now(), verifyStored = checkStoredBackup) {
  const runs = await client('actions/workflows/backup.yml/runs?status=success&per_page=1&branch=main');
  const latest = runs.workflow_runs?.[0];
  if (!latest || !Number.isFinite(Date.parse(latest.run_started_at)) || now - Date.parse(latest.run_started_at) > 30 * 60 * 60_000) return ['No successfully restored backup in the last 30 hours.'];
  try { await verifyStored(latest.id, latest.run_attempt ?? 1); }
  catch { return ['The latest restore-tested backup is missing, changed or inaccessible in private R2 storage.']; }
  return [];
}

export async function main(env = process.env) {
  const client = githubClient(env);
  const assignees = (env.OPS_ALERT_ASSIGNEES ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (assignees.some((item) => !/^[a-zA-Z0-9-]{1,39}$/.test(item))) throw new Error('OPS_ALERT_ASSIGNEES must contain GitHub usernames');
  const runUrl = `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  if (env.OPS_TEST_ALERT === 'true') {
    await reconcileIncident(client, 'Alert delivery test', ['An admin requested this test. Confirm you received the GitHub notification, then close this test issue manually.'], runUrl, assignees);
    return;
  }
  if (env.OPS_BACKUP_RESULT === 'failure') {
    await reconcileIncident(client, 'Database backup', ['The scheduled backup/restore job failed. The previous backup has not been replaced.'], runUrl, assignees);
    return;
  }
  if (env.OPS_BACKUP_RESULT === 'success') {
    await reconcileIncident(client, 'Database backup', [], runUrl, assignees);
    return;
  }
  const issues = await probeProduction(env.MONITORING_TOKEN);
  await reconcileIncident(client, 'Production health', issues, runUrl, assignees);
  let backupIssues;
  try { backupIssues = await checkBackupFreshness(client, Date.now(), (id, attempt) => checkStoredBackup(id, attempt, env)); }
  catch { backupIssues = ['Backup freshness could not be verified; inspect the backup workflow and R2 storage.']; }
  await reconcileIncident(client, 'Database backup', backupIssues, runUrl, assignees);
  if (issues.length || backupIssues.length) throw new Error('Operational checks failed; see the Operations issues');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Operations check failed. Inspect the workflow configuration and Operations issues; no private response data has been logged.'); process.exitCode = 1; });
}
