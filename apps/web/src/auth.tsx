import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { api } from './api';

export interface CurrentUser { id: string; email: string; displayName: string; avatarUrl: string | null; institution: string | null; campus: string | null; graduationYear: number | null; phoneVerifiedAt: string | null; onboardingComplete: boolean; suspendedAt: string | null; roles: string[]; }
const AuthContext = createContext<{ user: CurrentUser | null; loading: boolean; refresh: () => Promise<unknown> }>({ user: null, loading: true, refresh: async () => undefined });

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['me'], queryFn: () => api<CurrentUser | null>('/api/auth/session') });
  return <AuthContext.Provider value={{ user: query.data ?? null, loading: query.isLoading, refresh: () => client.invalidateQueries({ queryKey: ['me'] }) }}>{children}</AuthContext.Provider>;
}
export function useAuth() { return useContext(AuthContext); }

export function RequireAuth({ children, phone = false, roles }: { children: ReactNode; phone?: boolean; roles?: string[] }) {
  const { user, loading } = useAuth(); const location = useLocation();
  if (loading) return <div className="page"><div className="skeleton h-40" aria-label="Loading account" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!user.onboardingComplete && location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  if (phone && !user.phoneVerifiedAt) return <Navigate to="/settings?verify=phone" replace />;
  if (roles && !roles.some((role) => user.roles.includes(role))) return <Navigate to="/" replace />;
  return children;
}
