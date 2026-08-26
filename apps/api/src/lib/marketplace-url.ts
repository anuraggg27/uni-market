export const MARKETPLACE_BASE_PATH = "/marketplace";

export function marketplaceUrl(clientOrigin: string, path = "/"): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(
    `${MARKETPLACE_BASE_PATH}${normalizedPath}`,
    `${clientOrigin}/`,
  ).toString();
}
