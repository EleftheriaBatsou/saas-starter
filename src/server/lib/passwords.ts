import argon2 from 'argon2';
import { config } from '../config.ts';

const pepper = Buffer.from(config.passwordPepper);

// OWASP-recommended argon2id parameters (19 MiB, t=2, p=1).
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  secret: pepper,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password, { secret: pepper });
  } catch {
    return false;
  }
}

// Used when the email doesn't exist so response timing doesn't reveal accounts.
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalisation');
  await verifyPassword(await dummyHash, password);
}

export { checkPasswordPolicy } from '../../shared/password-policy.ts';
