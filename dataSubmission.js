// ─────────────────────────────────────────────────────────────────────
// Data submission
//
// Single choke point for where study data goes. Every write always lands
// in localStorage first (explicit backup/testing store - never the primary
// store once this is deployed online). If STUDY_SUBMISSION_CONFIG.supabaseUrl
// is filled in, each record is also POSTed to Supabase via its REST API, so
// switching from local-only testing to a real cloud database is a config
// change here, not a code change anywhere else.
// ─────────────────────────────────────────────────────────────────────

const STUDY_SUBMISSION_CONFIG = {
  supabaseUrl: 'https://cpumoqxlimgpeggzkozx.supabase.co',
  supabaseAnonKey: 'sb_publishable_OR1PP908JzvdleqjGyGmiQ_zp2JEe_Y',
  responsesTable: 'participant_responses',
  qualificationsTable: 'reviewer_qualifications',
  postSurveyTable: 'post_study_surveys',
  completionTable: 'study_completions'
};

const RESPONSES_STORAGE_KEY = 'study.responses.v1';
const QUALIFICATIONS_STORAGE_KEY = 'study.qualifications.v1';
const POST_SURVEY_STORAGE_KEY = 'study.postSurvey.v1';
const COMPLETIONS_STORAGE_KEY = 'study.completions.v1';

function appendToLocalStorage(key, record) {
  let existing = [];
  try {
    existing = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(existing)) existing = [];
  } catch (_error) {
    existing = [];
  }
  existing.push(record);
  localStorage.setItem(key, JSON.stringify(existing));
}

async function postToSupabase(table, record) {
  if (!STUDY_SUBMISSION_CONFIG.supabaseUrl || !STUDY_SUBMISSION_CONFIG.supabaseAnonKey) {
    return;
  }

  const url = `${STUDY_SUBMISSION_CONFIG.supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: STUDY_SUBMISSION_CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${STUDY_SUBMISSION_CONFIG.supabaseAnonKey}`,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(record)
    });
  } catch (error) {
    console.error(`Could not submit record to Supabase table "${table}" - it is still saved locally.`, error);
  }
}

async function submitParticipantResponse(record) {
  appendToLocalStorage(RESPONSES_STORAGE_KEY, record);
  await postToSupabase(STUDY_SUBMISSION_CONFIG.responsesTable, record);
}

async function submitQualification(record) {
  appendToLocalStorage(QUALIFICATIONS_STORAGE_KEY, record);
  await postToSupabase(STUDY_SUBMISSION_CONFIG.qualificationsTable, record);
}

async function submitPostStudySurvey(record) {
  appendToLocalStorage(POST_SURVEY_STORAGE_KEY, record);
  await postToSupabase(STUDY_SUBMISSION_CONFIG.postSurveyTable, record);
}

async function submitStudyCompletion(record) {
  appendToLocalStorage(COMPLETIONS_STORAGE_KEY, record);
  await postToSupabase(STUDY_SUBMISSION_CONFIG.completionTable, record);
}

// Read side for researcherDashboard.html: Supabase first (once configured),
// falling back to the same localStorage array every submit*() call above
// also writes to. Keeps the dashboard pointed at one function per
// collection instead of duplicating the "which source is authoritative"
// decision in two places.
async function loadStoredCollection(localStorageKey, table) {
  if (STUDY_SUBMISSION_CONFIG.supabaseUrl && STUDY_SUBMISSION_CONFIG.supabaseAnonKey) {
    const url = `${STUDY_SUBMISSION_CONFIG.supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}?select=*`;
    try {
      const response = await fetch(url, {
        headers: {
          apikey: STUDY_SUBMISSION_CONFIG.supabaseAnonKey,
          Authorization: `Bearer ${STUDY_SUBMISSION_CONFIG.supabaseAnonKey}`
        }
      });
      if (response.ok) return await response.json();
      console.error(`Supabase read of "${table}" returned HTTP ${response.status} - falling back to localStorage.`);
    } catch (error) {
      console.error(`Could not read Supabase table "${table}" - falling back to localStorage.`, error);
    }
  }

  try {
    const existing = JSON.parse(localStorage.getItem(localStorageKey) || '[]');
    return Array.isArray(existing) ? existing : [];
  } catch (_error) {
    return [];
  }
}
