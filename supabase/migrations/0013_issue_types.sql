-- =====================================================================================================================
-- a2b TAB App: observations
--
-- An issue is a deficiency (turns its unit red, listed on the Summary pages as before) or an observation (recorded
-- without flagging the unit, numbered on its own: "Obs. N-1"). `issues.issue_type` holds it, 'deficiency' by default
-- (every issue before this is one); synced as `issueType`. Re-runnable.
--
-- Run this BEFORE the app version with observations is used on any device: until then the server does not know
-- issueType (an observation is stored as a deficiency, a type change is logged but not applied).
--
-- Rollback: rollback/0013_issue_types_down.sql (issueType is no longer synced; the column and its values stay).
-- =====================================================================================================================

alter table public.issues add column if not exists issue_type text not null default 'deficiency';
alter table public.issues drop constraint if exists issues_issue_type_check;
alter table public.issues add constraint issues_issue_type_check check (issue_type in ('deficiency', 'observation'));

insert into public.sync_columns (table_name, app_key, column_name, kind) values
  ('issues', 'issueType', 'issue_type', 'text')
on conflict (table_name, app_key) do nothing;
