/* Transport to the Apps Script Web App.

   text/plain, and idToken in the body, are both deliberate: Apps Script
   cannot answer a preflight OPTIONS, so the request has to stay CORS-simple.
   application/json or an Authorization header would trigger one and fail. */
import { SCRIPT_URL } from '../config.js';

export const isConfigured = () => Boolean(SCRIPT_URL);

/** `authExpired` tells the store to keep its queue and ask for a new token. */
export class ApiError extends Error {
  constructor(message, { authExpired = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.authExpired = authExpired;
  }
}

export async function call(action, payload = {}, idToken = null) {
  if (!SCRIPT_URL) throw new ApiError('Chưa cấu hình SCRIPT_URL.');
  if (!idToken) throw new ApiError('Chưa đăng nhập.', { authExpired: true });

  let res;
  try {
    res = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // see note above
      body: JSON.stringify({ action, payload, idToken }),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'follow'
    });
  } catch (e) {
    throw new ApiError('Không kết nối được backend: ' + (e.message || e));
  }

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    // Apps Script serves an HTML error page when the deployment permissions
    // are wrong or the script failed to load.
    throw new ApiError(
      res.ok
        ? 'Backend trả về không phải JSON — kiểm tra deployment đặt "Who has access: Anyone" chưa.'
        : 'Backend lỗi HTTP ' + res.status
    );
  }

  // Every response is HTTP 200; the outcome is this flag.
  if (!body.ok) {
    const msg = body.error || 'Backend báo lỗi không rõ.';
    throw new ApiError(msg, { authExpired: /token|idToken|hết hạn|đăng nhập/i.test(msg) });
  }
  return body.data;
}

/** Liveness probe, for diagnosing a bad configuration. */
export async function ping() {
  if (!SCRIPT_URL) return false;
  try {
    const res = await fetch(SCRIPT_URL, { redirect: 'follow' });
    const body = await res.json();
    return Boolean(body && body.ok);
  } catch (e) {
    return false;
  }
}
