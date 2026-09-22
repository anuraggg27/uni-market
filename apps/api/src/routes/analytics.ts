import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { analyticsDailyPages, analyticsDailyReferrers, analyticsDailyVisitors } from '../db/schema.js';
import { keyedHash } from '../lib/crypto.js';
import { asyncRoute } from '../lib/errors.js';

const pageViewSchema = z.object({
  path: z.string().trim().min(1).max(500),
  visitorId: z.string().uuid(),
  landing: z.boolean().default(false),
  referrerHost: z.string().trim().max(253).nullable().optional(),
});

const publicRoutes = new Set([
  '/',
  '/browse',
  '/categories',
  '/login',
  '/leaderboard',
  '/terms',
  '/privacy',
  '/community-rules',
  '/prohibited-items',
  '/seller-policy',
  '/marketplace-disclosure',
  '/grievance',
  '/grievance/track',
  '/onboarding',
  '/sell',
  '/my-listings',
  '/saved',
  '/chats',
  '/requests',
  '/profile',
  '/notifications',
  '/support',
  '/settings',
]);

export function normalizeAnalyticsRoute(input: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(input, 'https://analytics.invalid').pathname;
  } catch {
    return null;
  }
  pathname = pathname.replace(/^\/marketplace(?=\/|$)/, '') || '/';
  pathname = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (pathname === '/transactions') return '/requests';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return null;
  if (publicRoutes.has(pathname)) return pathname;
  if (/^\/category\/[a-z0-9-]{1,80}$/i.test(pathname)) return pathname.toLowerCase();
  if (/^\/listing\/[^/]+\/edit$/i.test(pathname)) return '/listing/:id/edit';
  if (/^\/listing\/[^/]+$/i.test(pathname)) return '/listing/:id';
  if (/^\/seller\/[^/]+$/i.test(pathname)) return '/seller/:id';
  if (/^\/chats\/[^/]+$/i.test(pathname)) return '/chats/:id';
  if (/^\/support\/[^/]+$/i.test(pathname)) return '/support/:id';
  return '/not-found';
}

export function analyticsDeviceType(userAgent: string): 'mobile' | 'tablet' | 'desktop' | 'unknown' {
  if (!userAgent) return 'unknown';
  if (/ipad|tablet|android(?!.*mobile)/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|ipod|android/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

function isAutomated(userAgent: string): boolean {
  return /bot|crawl|spider|slurp|lighthouse|headless|monitoring|uptime|curl|wget|python-requests|facebookexternalhit|preview/i.test(userAgent);
}

function referrerSource(host: string | null | undefined, config: AppConfig): string {
  if (!host) return 'Direct';
  const normalized = host.toLowerCase().replace(/^www\./, '');
  if (!/^[a-z0-9.-]+$/.test(normalized)) return 'Other';
  const ownHosts = [config.CLIENT_URL, config.API_URL].map((url) => new URL(url).hostname.toLowerCase().replace(/^www\./, ''));
  if (ownHosts.includes(normalized)) return 'Internal';
  if (/(^|\.)(google|bing|duckduckgo|yahoo|ecosia)\./.test(normalized)) return 'Organic search';
  return normalized.slice(0, 120);
}

export function analyticsRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  router.post('/analytics/page-view', rateLimit({
    windowMs: 60_000,
    limit: config.NODE_ENV === 'test' ? 1_000 : 120,
    standardHeaders: true,
    legacyHeaders: false,
  }), asyncRoute(async (req, res) => {
    if (req.header('dnt') === '1' || req.header('sec-gpc') === '1') {
      res.status(204).end();
      return;
    }
    const userAgent = req.header('user-agent') ?? '';
    if (!userAgent || isAutomated(userAgent)) {
      res.status(204).end();
      return;
    }
    const input = pageViewSchema.parse(req.body);
    const route = normalizeAnalyticsRoute(input.path);
    if (!route) {
      res.status(204).end();
      return;
    }
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const visitorHash = keyedHash(`analytics:${day}:${input.visitorId}`, config.SESSION_SECRET);
    const deviceType = analyticsDeviceType(userAgent);
    await db.transaction(async (tx) => {
      await tx.insert(analyticsDailyVisitors).values({ day, visitorHash, pageViews: 1, deviceType, firstSeenAt: now, lastSeenAt: now }).onConflictDoUpdate({
        target: [analyticsDailyVisitors.day, analyticsDailyVisitors.visitorHash],
        set: { pageViews: sql`${analyticsDailyVisitors.pageViews} + 1`, lastSeenAt: now },
      });
      await tx.insert(analyticsDailyPages).values({ day, route, views: 1 }).onConflictDoUpdate({
        target: [analyticsDailyPages.day, analyticsDailyPages.route],
        set: { views: sql`${analyticsDailyPages.views} + 1` },
      });
      if (input.landing) {
        const source = referrerSource(input.referrerHost, config);
        await tx.insert(analyticsDailyReferrers).values({ day, source, visits: 1 }).onConflictDoUpdate({
          target: [analyticsDailyReferrers.day, analyticsDailyReferrers.source],
          set: { visits: sql`${analyticsDailyReferrers.visits} + 1` },
        });
      }
    });
    res.status(204).end();
  }));
  return router;
}
