-- ─────────────────────────────────────────────────────────────────────
-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query).
-- It creates the participant_sessions table used for server-side IP capture,
-- and locks down all study tables so anon (public) can only INSERT, never SELECT.
-- ─────────────────────────────────────────────────────────────────────

-- 1) New table for session/IP-capture records, written only by the
--    capture-session Edge Function (via the service-role key, which
--    bypasses RLS). No policies are granted to anon/authenticated, so
--    the browser can never read or write this table directly.
create table if not exists public.participant_sessions (
  id bigint generated always as identity primary key,
  "participantId" text not null unique,
  "ipHash" text not null,
  "userAgent" text,
  role text,
  mode text,
  "createdAt" timestamptz not null default now()
);

alter table public.participant_sessions enable row level security;
-- Intentionally no policies here: only the service_role (used server-side by
-- the Edge Function) can read/write. anon and authenticated get zero access.

-- 2) Lock down the existing study tables to INSERT-only for anon, so
--    research data is not publicly readable. Adjust table/policy names if
--    your existing policies differ.

alter table public.participant_responses enable row level security;
drop policy if exists "participant_responses_insert_anon" on public.participant_responses;
create policy "participant_responses_insert_anon"
  on public.participant_responses
  for insert
  to anon
  with check (true);

alter table public.reviewer_qualifications enable row level security;
drop policy if exists "reviewer_qualifications_insert_anon" on public.reviewer_qualifications;
create policy "reviewer_qualifications_insert_anon"
  on public.reviewer_qualifications
  for insert
  to anon
  with check (true);

alter table public.post_study_surveys enable row level security;
drop policy if exists "post_study_surveys_insert_anon" on public.post_study_surveys;
create policy "post_study_surveys_insert_anon"
  on public.post_study_surveys
  for insert
  to anon
  with check (true);

alter table public.study_completions enable row level security;
drop policy if exists "study_completions_insert_anon" on public.study_completions;
create policy "study_completions_insert_anon"
  on public.study_completions
  for insert
  to anon
  with check (true);

-- NOTE: this intentionally removes/omits any anon SELECT policy on all four
-- tables. researcherDashboard.html currently reads these tables directly
-- with the anon key (see loadStoredCollection in dataSubmission.js) - after
-- running this migration, that read path will stop working until the
-- dashboard is updated (out of scope here per your request) to read through
-- an authenticated/service-side path instead.
