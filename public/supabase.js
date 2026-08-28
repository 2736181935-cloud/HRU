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
