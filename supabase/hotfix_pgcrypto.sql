-- 修复Supabase将pgcrypto安装在extensions模式后，旧版RPC无法找到加密函数的问题。
-- 可重复执行，不修改或删除任何参与者数据。

alter function public.start_participant(text)
  set search_path = public, extensions;

alter function public.get_participant(text, text)
  set search_path = public, extensions;

alter function public.submit_step(text, text, text, jsonb, integer, integer, timestamptz)
  set search_path = public, extensions;

alter function public.complete_participant(text, text)
  set search_path = public, extensions;

notify pgrst, 'reload schema';
