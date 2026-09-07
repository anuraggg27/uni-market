import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { seoStructuredData, staticPageSeo, type SeoMetadata } from '@campus-market/shared';
import { publicApi } from '../api';

const origin = document.querySelector<HTMLMetaElement>('meta[name="seo-origin"]')?.content ?? window.location.origin;
function readInitialSeo(): { path: string; metadata: SeoMetadata } | undefined {
  try {
    const value = JSON.parse(document.getElementById('seo-data')?.textContent ?? 'null');
    return value && typeof value.path === 'string' && typeof value.metadata?.title === 'string' ? value : undefined;
  } catch { return undefined; }
}
const initialSeo = readInitialSeo();
const initialSearch = window.location.search;

export function applyPageSeo(metadata: SeoMetadata) {
  document.querySelectorAll('head [data-seo], head title, head meta[name="description"], head meta[name="robots"], head link[rel="canonical"]').forEach((element) => element.remove());
  document.title = metadata.title;
  const addMeta = (name: string, content: string, property = false) => {
    const tag = document.createElement('meta');
    tag.setAttribute(property ? 'property' : 'name', name);
    tag.content = content;
    tag.dataset.seo = '';
    document.head.append(tag);
  };
  addMeta('description', metadata.description);
  addMeta('robots', metadata.robots);
  const canonical = document.createElement('link');
  canonical.rel = 'canonical'; canonical.href = metadata.canonical; canonical.dataset.seo = '';
  document.head.append(canonical);
  addMeta('og:site_name', 'Uni Rocks', true);
  addMeta('og:type', 'website', true);
  addMeta('og:locale', 'en_IN', true);
  addMeta('og:title', metadata.title, true);
  addMeta('og:description', metadata.description, true);
  addMeta('og:url', metadata.canonical, true);
  addMeta('twitter:card', metadata.image ? 'summary_large_image' : 'summary');
  addMeta('twitter:title', metadata.title);
  addMeta('twitter:description', metadata.description);
  if (metadata.image) {
    addMeta('og:image', metadata.image, true);
    addMeta('og:image:alt', metadata.imageAlt ?? metadata.title, true);
    addMeta('twitter:image', metadata.image);
  }
  if (metadata.robots.startsWith('index')) {
    const structured = document.createElement('script');
    structured.type = 'application/ld+json'; structured.dataset.seo = '';
    structured.textContent = JSON.stringify(seoStructuredData(metadata));
    document.head.append(structured);
  }
}

export function PageSeo() {
  const { pathname, search } = useLocation();
  const dynamic = /^\/(?:listing\/[0-9a-f-]{36}|category\/[a-z0-9-]+)\/?$/i.test(pathname);
  const query = useQuery({
    queryKey: ['seo', pathname, search],
    queryFn: () => publicApi<SeoMetadata>(`/api/seo?path=${encodeURIComponent(pathname.replace(/\/$/, ''))}&search=${encodeURIComponent(search)}`),
    enabled: dynamic,
    initialData: dynamic && search === initialSearch && initialSeo?.path === pathname ? initialSeo.metadata : undefined,
    staleTime: 30_000,
  });
  useEffect(() => {
    applyPageSeo(dynamic && query.data ? query.data : staticPageSeo(origin, pathname, search));
  }, [pathname, search, dynamic, query.data]);
  return null;
}
