// Thin fetch wrapper. Cookies carry the session; X-Org-Id tells the server
// which org this tab is rendering so cross-tab switches can't misfire.

export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  data: Record<string, unknown>;
  constructor(status: number, body: { error?: { code?: string; message?: string; fields?: Record<string, string> } } & Record<string, unknown>) {
    super(body.error?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body.error?.code ?? 'UNKNOWN';
    this.fields = body.error?.fields ?? {};
    this.data = (body.error ?? {}) as Record<string, unknown>;
  }
}

let currentOrgId: string | null = null;
export function setApiOrg(id: string | null) {
  currentOrgId = id;
}

type Handler = (err: ApiError) => void;
let onAuthLost: Handler = () => {};
let onOrgChanged: Handler = () => {};
export function onApiEvents(h: { authLost: Handler; orgChanged: Handler }) {
  onAuthLost = h.authLost;
  onOrgChanged = h.orgChanged;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (currentOrgId) headers['x-org-id'] = currentOrgId;
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && !path.startsWith('/api/auth/')) onAuthLost(err);
    if (err.code === 'ORG_MISMATCH' || err.code === 'NOT_A_MEMBER' || err.code === 'NO_ACTIVE_ORG') onOrgChanged(err);
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body ?? {}),
};
