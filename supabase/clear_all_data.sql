-- 正式收集前清空所有问卷作答数据。
-- 本脚本保留数据库结构、RPC函数和study_admins管理员名单。
-- 警告：执行后下列四张表中的记录不可通过本项目恢复。

begin;

truncate table
  public.quality_flags,
  public.step_events,
  public.responses,
  public.participants
restart identity;

commit;

-- 执行结果应全部为0。
select 'participants' as table_name, count(*) as row_count from public.participants
union all
select 'responses', count(*) from public.responses
union all
select 'step_events', count(*) from public.step_events
union all
select 'quality_flags', count(*) from public.quality_flags;
