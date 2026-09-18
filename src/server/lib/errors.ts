export class HttpError extends Error {
  statusCode: number;
  code: string;
  details?: Record<string, unknown>;
  headers?: Record<string, string>;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const unauthorized = (msg = 'Please sign in to continue.') => new HttpError(401, 'UNAUTHENTICATED', msg);
export const forbidden = (msg = "You don't have permission to do that.") => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (code: string, msg: string) => new HttpError(409, code, msg);
export const badRequest = (code: string, msg: string, details?: Record<string, unknown>) =>
  new HttpError(400, code, msg, details);

export function tooManyRequests(retryAfter: number, msg = 'Too many attempts. Please wait and try again.') {
  const e = new HttpError(429, 'RATE_LIMITED', msg, { retryAfter });
  e.headers = { 'retry-after': String(retryAfter) };
  return e;
}
