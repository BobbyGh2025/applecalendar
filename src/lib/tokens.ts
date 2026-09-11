import { createHash, randomUUID } from 'crypto';

/**
 * Generate a cryptographically secure random token.
 */
export function generateSecureToken(): string {
  return randomUUID();
}

/**
 * Hash a token using SHA-256 for secure storage.
 * Tokens are never stored in plaintext — only their hashes.
 */
export async function hashToken(token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    hash.update(token);
    resolve(hash.digest('hex'));
  });
}

/**
 * Verify a token against its stored hash.
 */
export async function verifyTokenHash(token: string, hash: string): Promise<boolean> {
  const computedHash = await hashToken(token);
  return computedHash === hash;
}
