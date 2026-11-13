import { SignJWT } from 'jose';

export const AUTH_ENV = {
  SUPABASE_URL: 'https://auth.example',
  SUPABASE_JWT_SECRET: 'test-only-signing-secret-with-at-least-32-characters',
};
export const USER_ID = '11111111-1111-4111-8111-111111111111';
export const SESSION_TOKEN = await new SignJWT({ role: 'authenticated' })
  .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
  .setIssuer(`${AUTH_ENV.SUPABASE_URL}/auth/v1`)
  .setAudience('authenticated')
  .setSubject(USER_ID)
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(new TextEncoder().encode(AUTH_ENV.SUPABASE_JWT_SECRET));

export function authenticatedRequest(url, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${SESSION_TOKEN}`);
  return new Request(url, { ...init, headers });
}
