create extension if not exists pgcrypto;

create table if not exists public.study_admins (
  email text primary key,
  created_at timestamptz not null default now()
);

insert into public.study_admins(email)
values ('2736181935@qq.com')
on conflict do nothing;

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  public_id text unique not null,
  session_token_hash text not null,
  study_mode text not null default 'pilot' check (study_mode in ('pilot','formal')),
  condition_code text not null check (condition_code in ('A','B','C','D')),
  ai_weight text not null check (ai_weight in ('high','low')),
  feedback text not null check (feedback in ('developmental','non_developmental')),
  status text not null default 'in_progress' check (status in ('in_progress','completed','withdrawn')),
  current_step text not null default 'scenario',
  questionnaire_version text not null default '1.0.0',
  source text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  last_active_at timestamptz not null default now(),
  completion_code text unique
);

create table if not exists public.responses (
  id bigint generated always as identity primary key,
  participant_id uuid not null references public.participants(id) on delete cascade,
  question_code text not null check (question_code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  raw_value text,
  numeric_value numeric,
  answered_at timestamptz not null default now(),
  unique(participant_id, question_code)
);

create table if not exists public.step_events (
  id bigint generated always as identity primary key,
  participant_id uuid not null references public.participants(id) on delete cascade,
  step_code text not null,
  entered_at timestamptz,
  submitted_at timestamptz not null default now(),
  duration_ms integer not null default 0,
  focus_loss_count integer not null default 0
);

create table if not exists public.quality_flags (
  id bigint generated always as identity primary key,
  participant_id uuid not null references public.participants(id) on delete cascade,
  flag_code text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(participant_id, flag_code)
);

alter table public.study_admins enable row level security;
alter table public.participants enable row level security;
alter table public.responses enable row level security;
alter table public.step_events enable row level security;
alter table public.quality_flags enable row level security;

revoke all on public.study_admins, public.participants, public.responses, public.step_events, public.quality_flags from anon, authenticated;

create or replace function public.is_study_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.study_admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.start_participant(p_source text default '')
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_public_id text := 'P-' || upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
  v_condition text;
  v_ai_weight text;
  v_feedback text;
begin
  perform pg_advisory_xact_lock(84202601);
  with conditions(code) as (values ('A'),('B'),('C'),('D')),
  counts as (
    select c.code, count(p.id) as n
    from conditions c left join public.participants p
      on p.condition_code = c.code and p.status in ('in_progress','completed')
    group by c.code
  )
  select code into v_condition
  from counts order by n asc, random() limit 1;

  v_ai_weight := case when v_condition in ('A','B') then 'high' else 'low' end;
  v_feedback := case when v_condition in ('A','C') then 'developmental' else 'non_developmental' end;

  insert into public.participants(public_id, session_token_hash, condition_code, ai_weight, feedback, source)
  values (v_public_id, encode(digest(v_token, 'sha256'), 'hex'), v_condition, v_ai_weight, v_feedback, left(coalesce(p_source,''),100));

  return jsonb_build_object('publicId',v_public_id,'sessionToken',v_token,'currentStep','scenario','aiWeight',v_ai_weight,'feedback',v_feedback);
end;
$$;

create or replace function public.get_participant(p_public_id text, p_session_token text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_p public.participants%rowtype;
begin
  select * into v_p from public.participants
  where public_id=p_public_id and session_token_hash=encode(digest(p_session_token,'sha256'),'hex');
  if not found then raise exception '参与者不存在或凭证无效'; end if;
  return jsonb_build_object('publicId',v_p.public_id,'currentStep',v_p.current_step,'status',v_p.status,'aiWeight',v_p.ai_weight,'feedback',v_p.feedback,'completionCode',v_p.completion_code);
end;
$$;

create or replace function public.submit_step(
  p_public_id text, p_session_token text, p_step_code text,
  p_answers jsonb default '{}'::jsonb, p_duration_ms integer default 0,
  p_focus_loss_count integer default 0, p_entered_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_p public.participants%rowtype;
  v_steps text[] := array['scenario','ai_authority_material','evaluation_complete','feedback_material','comprehension_check','manipulation_check','organizational_dehumanization','demographics'];
  v_index integer;
  v_next text;
  v_item record;
  v_ai_correct text;
  v_feedback_correct text;
begin
  select * into v_p from public.participants
  where public_id=p_public_id and session_token_hash=encode(digest(p_session_token,'sha256'),'hex') for update;
  if not found then raise exception '参与者不存在或凭证无效'; end if;
  if v_p.status='completed' then raise exception '问卷已完成'; end if;
  if v_p.current_step<>p_step_code then raise exception '页面顺序不正确'; end if;
  v_index := array_position(v_steps,p_step_code);
  if v_index is null then raise exception '无效页面'; end if;
  v_next := case when v_index=array_length(v_steps,1) then 'complete' else v_steps[v_index+1] end;

  for v_item in select * from jsonb_each_text(coalesce(p_answers,'{}'::jsonb)) loop
    if v_item.key ~ '^[A-Z][A-Z0-9_]{1,39}$' then
      insert into public.responses(participant_id,question_code,raw_value,numeric_value)
      values(v_p.id,v_item.key,v_item.value,case when v_item.value ~ '^[0-9]+([.][0-9]+)?$' then v_item.value::numeric else null end)
      on conflict(participant_id,question_code) do update set raw_value=excluded.raw_value,numeric_value=excluded.numeric_value,answered_at=now();
    end if;
  end loop;

  insert into public.step_events(participant_id,step_code,entered_at,duration_ms,focus_loss_count)
  values(v_p.id,p_step_code,p_entered_at,least(greatest(coalesce(p_duration_ms,0),0),3600000),greatest(coalesce(p_focus_loss_count,0),0));

  if p_step_code='comprehension_check' then
    v_ai_correct := case when v_p.ai_weight='high' then 'ai' else 'supervisor' end;
    v_feedback_correct := case when v_p.feedback='developmental' then 'yes' else 'no' end;
    if p_answers->>'CHECK_AI_AUTHORITY' is distinct from v_ai_correct then
      insert into public.quality_flags(participant_id,flag_code) values(v_p.id,'FAILED_AI_CHECK') on conflict do nothing;
    end if;
    if p_answers->>'CHECK_FEEDBACK' is distinct from v_feedback_correct then
      insert into public.quality_flags(participant_id,flag_code) values(v_p.id,'FAILED_FEEDBACK_CHECK') on conflict do nothing;
    end if;
  end if;

  update public.participants set current_step=v_next,last_active_at=now() where id=v_p.id;
  return jsonb_build_object('currentStep',v_next);
end;
$$;

create or replace function public.complete_participant(p_public_id text, p_session_token text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_p public.participants%rowtype; v_code text;
begin
  select * into v_p from public.participants
  where public_id=p_public_id and session_token_hash=encode(digest(p_session_token,'sha256'),'hex') for update;
  if not found then raise exception '参与者不存在或凭证无效'; end if;
  if v_p.status='completed' then return jsonb_build_object('completionCode',v_p.completion_code); end if;
  if v_p.current_step<>'complete' then raise exception '问卷尚未完成'; end if;
  v_code := 'OD-' || upper(substr(encode(gen_random_bytes(8),'hex'),1,8));
  update public.participants set status='completed',completed_at=now(),last_active_at=now(),completion_code=v_code where id=v_p.id;
  return jsonb_build_object('completionCode',v_code);
end;
$$;

create or replace function public.admin_dashboard()
returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_study_admin() then raise exception '无管理员权限'; end if;
  return jsonb_build_object(
    'totals',(select jsonb_build_object('total',count(*),'completed',count(*) filter(where status='completed')) from public.participants),
    'groups',(select coalesce(jsonb_agg(x order by x->>'condition_code'),'[]'::jsonb) from (select jsonb_build_object('condition_code',condition_code,'total',count(*),'completed',count(*) filter(where status='completed')) x from public.participants group by condition_code) s),
    'flags',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select jsonb_build_object('flag_code',flag_code,'count',count(*)) x from public.quality_flags group by flag_code) s)
  );
end;
$$;

create or replace function public.admin_responses()
returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_study_admin() then raise exception '无管理员权限'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.started_at desc) from (
    select p.public_id,p.condition_code,p.ai_weight,p.feedback,p.status,p.started_at,p.completed_at,p.completion_code,
      (select count(*) from public.quality_flags q where q.participant_id=p.id) flag_count,
      coalesce((select jsonb_object_agg(r.question_code,r.raw_value) from public.responses r where r.participant_id=p.id),'{}'::jsonb) answers
    from public.participants p limit 2000
  ) x),'[]'::jsonb);
end;
$$;

grant execute on function public.start_participant(text) to anon, authenticated;
grant execute on function public.get_participant(text,text) to anon, authenticated;
grant execute on function public.submit_step(text,text,text,jsonb,integer,integer,timestamptz) to anon, authenticated;
grant execute on function public.complete_participant(text,text) to anon, authenticated;
grant execute on function public.admin_dashboard() to authenticated;
grant execute on function public.admin_responses() to authenticated;
