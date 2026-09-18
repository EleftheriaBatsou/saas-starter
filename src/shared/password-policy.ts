// Shared by the API (authoritative) and the signup/reset forms (live hints).

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234', '1234567890', '12345678910',
  'qwertyuiop', 'qwerty1234', 'qwerty12345', 'iloveyou12', 'letmein123', 'welcome123', 'admin12345',
  'abc1234567', 'passw0rd123', 'changeme123', 'football123', 'baseball123', 'sunshine123', 'princess123',
  'dragon1234', 'monkey1234', 'trustno1234', '1q2w3e4r5t', 'zaq12wsxcde', 'aaaaaaaaaa', '0000000000',
  '1111111111', 'superman123', 'starwars123', 'whatever123', 'correcthorse', 'p@ssw0rd123',
]);

/** Returns a list of human-readable problems; empty = acceptable. */
export function checkPasswordPolicy(password: string, ctx: { email?: string; name?: string } = {}): string[] {
  const problems: string[] = [];
  if (password.length < 10) problems.push('Use at least 10 characters.');
  if (password.length > 128) problems.push('Use at most 128 characters.');
  if (new Set(password).size < 5) problems.push('Use a more varied mix of characters.');
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) problems.push('This password is too common.');
  const local = ctx.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) problems.push("Don't include your email address.");
  const first = ctx.name?.split(/\s+/)[0]?.toLowerCase();
  if (first && first.length >= 4 && lower.includes(first)) problems.push("Don't include your name.");
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (password.length < 16 && classes < 3) {
    problems.push('Mix at least three of: lowercase, uppercase, digits, symbols (or use 16+ characters).');
  }
  return problems;
}
