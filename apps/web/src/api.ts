const API_URL = import.meta.env.VITE_API_URL ?? "";
let csrfToken: string | null = null;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await fetch(`${API_URL}/api/auth/csrf`, {
    credentials: "include",
  });
  if (!response.ok)
    throw new ApiError(
      response.status,
      "CSRF_UNAVAILABLE",
      "Please sign in again",
    );
  csrfToken = (await response.json()).data.csrfToken;
  return csrfToken!;
}

export async function api<T = any>(
  path: string,
  options: RequestInit = {},
  challenged = false,
): Promise<T> {
  const method = options.method?.toUpperCase() ?? "GET";
  const headers = new Headers(options.headers);
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has("content-type")
  )
    headers.set("content-type", "application/json");
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
    path !== "/api/auth/google"
  )
    headers.set("x-csrf-token", await ensureCsrf());
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (payload?.error?.code === "CSRF_INVALID") csrfToken = null;
    if (!challenged && payload?.error?.code === "BOT_CHECK_REQUIRED") {
      const token = await solveTurnstile();
      headers.set("x-turnstile-token", token);
      return api<T>(path, { ...options, headers }, true);
    }
    throw new ApiError(
      response.status,
      payload?.error?.code ?? "REQUEST_FAILED",
      payload?.error?.message ?? "Request failed",
      payload?.error?.fieldErrors,
    );
  }
  return payload.data as T;
}

export function jsonBody(value: unknown): Pick<RequestInit, "body"> {
  return { body: JSON.stringify(value) };
}
export function clearCsrf(): void {
  csrfToken = null;
}
import { solveTurnstile } from "./turnstile";
