import { OAuth2Client } from 'google-auth-library';
import type { AppConfig } from '../config.js';
import { AppError } from '../lib/errors.js';

export interface GoogleIdentity { sub: string; email: string; emailVerified: boolean; name: string; }
export interface GoogleVerifier { verify(credential: string): Promise<GoogleIdentity>; }

export class ProductionGoogleVerifier implements GoogleVerifier {
  private client: OAuth2Client;
  constructor(private config: AppConfig) { this.client = new OAuth2Client(config.GOOGLE_CLIENT_ID); }
  async verify(credential: string): Promise<GoogleIdentity> {
    if (!this.config.GOOGLE_CLIENT_ID) throw new AppError(503, 'GOOGLE_NOT_CONFIGURED', 'Google sign-in is not configured');
    try {
      const ticket = await this.client.verifyIdToken({ idToken: credential, audience: this.config.GOOGLE_CLIENT_ID });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || !payload.email_verified) throw new Error('missing required verified claims');
      if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) throw new Error('invalid issuer');
      return { sub: payload.sub, email: payload.email, emailVerified: true, name: payload.name || payload.email.split('@')[0]! };
    } catch {
      throw new AppError(401, 'INVALID_GOOGLE_CREDENTIAL', 'Google sign-in could not be verified');
    }
  }
}
