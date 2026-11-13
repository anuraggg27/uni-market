import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { api } from '../api';

function UserUnreadBadge({ userId }: { userId: string }) {
  const { data } = useQuery({ queryKey: ['unread-conversations', userId],
    queryFn: ({ signal }) => api<{ count: number }>('/api/conversations/unread-count', { signal }), staleTime: 15_000 });
  const count = data?.count ?? 0;
  if (!count) return null;
  return <span className="chat-unread-badge" aria-label={`${count} unread conversations`}>{count > 99 ? '99+' : count}</span>;
}

export function ChatUnreadBadge() {
  const { user } = useAuth();
  return user ? <UserUnreadBadge userId={user.id} /> : null;
}
