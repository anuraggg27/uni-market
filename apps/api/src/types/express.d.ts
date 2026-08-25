import type { Role } from '@campus-market/shared';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: {
        userId: string;
        sessionId: string;
        roles: Role[];
        phoneVerified: boolean;
        studentEmailVerified: boolean;
        adultAttested: boolean;
        policiesAccepted: boolean;
        marketplaceEligible: boolean;
        staffVerified: boolean;
        suspended: boolean;
      };
    }
  }
}

export {};
