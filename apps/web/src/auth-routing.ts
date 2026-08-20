export interface LoginRoutingUser {
  onboardingComplete: boolean;
  roles: string[];
}

const staffRoles = new Set(["MODERATOR", "SUPPORT_AGENT", "SUPER_ADMIN"]);

export function postLoginDestination(
  user: LoginRoutingUser,
  requestedPath?: string,
): string {
  if (!user.onboardingComplete) return "/onboarding";
  if (requestedPath && requestedPath !== "/login") return requestedPath;
  if (user.roles.some((role) => staffRoles.has(role))) return "/admin";
  return "/";
}
