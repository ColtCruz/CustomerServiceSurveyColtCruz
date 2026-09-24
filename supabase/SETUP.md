# Supabase setup: server-side IP capture (`capture-session` Edge Function)

These steps deploy the pieces that let the study capture a participant's IP
address **on the server**, hash it, and store it centrally in Supabase - without
ever putting a secret key in frontend code, GitHub Pages, or the public repo.

## 1. Run the SQL migration

In the Supabase dashboard: **SQL Editor → New query**, paste and run:

`supabase/sql/2026-09-24_participant_sessions_and_rls.sql`

This creates the `participant_sessions` table and tightens Row Level Security
on `participant_responses`, `reviewer_qualifications`, `post_study_surveys`,
and `study_completions` so the public `anon` key can only **INSERT**, never
**SELECT**.

> After this runs, `researcherDashboard.html`'s current anon-key reads will
> stop working. Per your instructions that file isn't being touched here -
> it will need a separate authenticated/service-side read path later.

## 1b. Run the duplicate-response migration

Also in the SQL Editor, paste and run:

`supabase/sql/2026-09-24_dedupe_participant_responses.sql`

This removes any pre-existing duplicate `participant_responses` rows for the
same participant + conversation (keeping the earliest one; responses from
other participants are untouched), then adds a unique constraint on
`(participantId, conversationId)` so the same participant can never create a
second response row for the same conversation. The frontend now submits
responses with `?on_conflict=participantId,conversationId` and
`Prefer: resolution=ignore-duplicates`, which requires this constraint to
exist - deploy it before shipping the updated `dataSubmission.js`.

## 2. Install the Supabase CLI and log in (one time)

```powershell
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
```

`<your-project-ref>` is the short ID in your project's Supabase URL
(`https://<project-ref>.supabase.co`).

## 3. Set the IP-hash salt secret (never commit this)

```powershell
supabase secrets set IP_HASH_SALT=<generate-a-long-random-string>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` do **not** need to be set
manually - Supabase automatically injects them into every Edge Function's
environment. The service-role key never appears in your repo or in
frontend code.

## 4. Deploy the function

```powershell
supabase functions deploy capture-session
```

## 5. Point the frontend at your project (already client-safe)

In `dataSubmission.js`, fill in:

```js
supabaseUrl: 'https://<your-project-ref>.supabase.co',
supabaseAnonKey: '<your-anon/publishable-key>',
```

Only the anon/publishable key goes here - it is safe to expose client-side
and is the same key already used for `participant_responses`, etc.

## What happens at runtime

1. On consent, the browser generates a UUID `participantId` and calls the
   `capture-session` Edge Function with `{ participantId, role, mode }`.
2. The Edge Function reads the real client IP from the incoming request
   headers (not from anything the client sends), hashes it with
   `IP_HASH_SALT`, and upserts a row into `participant_sessions` using the
   service-role key (server-side only, bypasses RLS).
3. The 25 conversation responses, qualifications, post-survey, and
   completion records continue to insert directly from the browser via the
   anon key exactly as before, just now under insert-only RLS.
