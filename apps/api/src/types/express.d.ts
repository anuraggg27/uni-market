import type { Role } from '@campus-market/shared';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: { userId: string; sessionId: string; roles: Role[]; phoneVerified: boolean; suspended: boolean };
    }
  }
}

export {};
