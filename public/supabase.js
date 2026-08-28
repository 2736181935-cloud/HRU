import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export async function rpc(name, params = {}, accessToken = SUPABASE_PUBLISHABLE_KEY) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error_description || '云端请求失败');
  return data;
}

export async function sendMagicLink(email) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, create_user: true, options: { emailRedirectTo: location.href.split('#')[0] } }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || data.error_description || '登录邮件发送失败');
}

export function captureAuthSession() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const accessToken = hash.get('access_token');
  if (accessToken) {
    sessionStorage.setItem('admin_access_token', accessToken);
    history.replaceState(null, '', location.pathname);
  }
  return accessToken || sessionStorage.getItem('admin_access_token');
}
