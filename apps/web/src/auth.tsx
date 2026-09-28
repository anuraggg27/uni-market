import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { api } from './api';
import type { AvatarAchievementId, AvatarId } from '@campus-market/shared';
import { RouteLoading } from './components/LoadingSkeletons';

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  avatarId: AvatarId | null;
  avatarAchievements: AvatarAchievementId[];
  institution: string | null;
  campus: string | null;
  graduationYear: number | null;
  phoneVerifiedAt: string | null;
  studentEmailMasked: string | null;
  studentEmailDomain: string | null;
  studentEmailVerifiedAt: string | null;
  studentEmailExpiresAt: string | null;
  adultAttestedAt: string | null;
  onboardingComplete: boolean;
  marketplaceEligible: boolean;
  eligibility: {
    phoneVerified: boolean;
    studentEmailVerified: boolean;
    adultAttested: boolean;
    policiesAccepted: boolean;
  };
  suspendedAt: string | null;
  roles: string[];
}
const AuthContext = createContext<{ user: CurrentUser | null; loading: boolean; refresh: () => Promise<unknown>; clearSession: () => void }>({ user: null, loading: true, refresh: async () => undefined, clearSession: () => undefined });

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['me'], queryFn: () => api<CurrentUser | null>('/api/auth/session') });
  return <AuthContext.Provider value={{ user: query.data ?? null, loading: query.isLoading, refresh: () => client.invalidateQueries({ queryKey: ['me'] }), clearSession: () => { client.setQueryData(['me'], null); client.removeQueries({ queryKey: ['favourites'] }); } }}>{children}</AuthContext.Provider>;
}
export function useAuth() { return useContext(AuthContext); }

export function RequireAuth({ children, eligible = false, allowIncomplete = false, roles }: { children: ReactNode; eligible?: boolean; allowIncomplete?: boolean; roles?: string[] }) {
  const { user, loading } = useAuth(); const location = useLocation();
  if (loading) return <RouteLoading />;
  if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  if (!allowIncomplete && !user.onboardingComplete && location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  if (eligible && !user.marketplaceEligible) return <Navigate to="/settings?verify=eligibility" replace />;
  if (roles && !roles.some((role) => user.roles.includes(role))) return <Navigate to="/" replace />;
  return children;
}
