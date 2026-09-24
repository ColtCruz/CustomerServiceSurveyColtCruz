// ─────────────────────────────────────────────────────────────────────
// App
//
// DOM wiring for chatScreen.html's participant/professional-reviewer study.
// General participant flow: Consent -> Instructions -> 25 conversations ->
// external Google Form survey -> Google Form confirmation (done).
// Professional reviewer flow: Consent -> Qualification -> Instructions ->
// 25 conversations -> Completion.
// No AI analysis is ever computed or shown here - that runs offline, once,
// via research/precompute_ai_analysis.js. See dataSubmission.js for storage.
// ─────────────────────────────────────────────────────────────────────

const STUDY_MODE = new URLSearchParams(window.location.search).get('mode') === 'professional'
  ? 'professional'
  : 'general';
const STUDY_CONVERSATIONS_URL = 'research/study_conversations.json';
const GENERAL_SURVEY_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSeL3dvj2Db0DxrW9GTq37_ZCjHDpAc8_JJxE5fQgwzaKCBBVw/viewform?usp=header';

let participantId = null;
let studyConversations = [];
let currentConversationIndex = 0;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bindIfExists(id, eventName, handler) {
  const element = document.getElementById(id);
  if (element) element.addEventListener(eventName, handler);
}

const SUBMITTED_CONVERSATIONS_STORAGE_KEY = 'study.submittedConversationIds.v1';

// Client-side half of duplicate-response protection: tracks which conversationIds
// this participant has already submitted so a resumed/duplicated flow can't send
// a second participant_responses record for the same conversation (the Supabase
// unique constraint on participantId+conversationId is the server-side half).
function getSubmittedConversationIds(id) {
  try {
    const all = JSON.parse(localStorage.getItem(SUBMITTED_CONVERSATIONS_STORAGE_KEY) || '{}');
    return Array.isArray(all[id]) ? all[id] : [];
  } catch (_error) {
    return [];
  }
}

function markConversationSubmitted(id, conversationId) {
  let all = {};
  try {
    all = JSON.parse(localStorage.getItem(SUBMITTED_CONVERSATIONS_STORAGE_KEY) || '{}');
  } catch (_error) {
    all = {};
  }
  if (!Array.isArray(all[id])) all[id] = [];
  if (!all[id].includes(conversationId)) all[id].push(conversationId);
  localStorage.setItem(SUBMITTED_CONVERSATIONS_STORAGE_KEY, JSON.stringify(all));
}

const PARTICIPANT_ID_STORAGE_KEY = 'study.participantId.v1';

function createUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback UUID v4 generator for browsers without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// UUID-based participant ID, globally unique across devices/browsers. Persisted in
// localStorage so a page refresh mid-study keeps the same participant identity.
function generateParticipantId() {
  const existing = localStorage.getItem(PARTICIPANT_ID_STORAGE_KEY);
  if (existing) return existing;

  const newId = createUuid();
  localStorage.setItem(PARTICIPANT_ID_STORAGE_KEY, newId);
  return newId;
}

function randomizeConversations(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function loadStudyConversations() {
  const response = await fetch(STUDY_CONVERSATIONS_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load the study conversations file.');
  const conversations = await response.json();
  if (!Array.isArray(conversations) || conversations.length !== 25) {
    throw new Error(
      `Expected exactly 25 study conversations, but found ${
        Array.isArray(conversations) ? conversations.length : 0
      }.`
    );
  }
  return randomizeConversations(conversations);
}

// ───────── Card visibility ─────────

const ALL_CARD_IDS = [
  'studyUnavailableCard', 'consentCard', 'declineCard', 'qualificationCard',
  'taskCard', 'datasetReviewCard', 'postSurveyCard', 'doneCard'
];

function showCard(cardId) {
  ALL_CARD_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', id !== cardId);
  });
}

function showStudyUnavailable(message) {
  const text = document.getElementById('studyUnavailableMessage');
  if (text) text.textContent = message;
  showCard('studyUnavailableCard');
}

// ───────── Consent ─────────

function handleConsentCheckboxChange() {
  document.getElementById('consentSubmitButton').disabled = !document.getElementById('consentCheckbox').checked;
}

function handleConsentSubmit() {
  if (!document.getElementById('consentCheckbox').checked) return;
  participantId = generateParticipantId();

  // Fire-and-forget: server-side IP capture is supplementary duplicate-detection
  // metadata, not required for the participant to proceed.
  submitParticipantSession({
    participantId,
    role: STUDY_MODE,
    mode: STUDY_MODE
  });

  if (STUDY_MODE === 'professional') {
    showCard('qualificationCard');
  } else {
    showCard('taskCard');
  }
}

function handleConsentDecline() {
  showCard('declineCard');
}

// ───────── Qualification (professional mode only) ─────────

async function handleQualificationSubmit() {
  const jobTitle = document.getElementById('qualJobTitle').value.trim();
  const yearsExperience = document.getElementById('qualYearsExperience').value.trim();
  const industry = document.getElementById('qualIndustry').value.trim();
  const handoffExperienceInput = document.querySelector('input[name="qualHandoffExperience"]:checked');

  if (!jobTitle || !yearsExperience || !industry || !handoffExperienceInput) {
    const error = document.getElementById('qualificationError');
    if (error) error.textContent = 'Please answer every question before continuing.';
    return;
  }

  await submitQualification({
    participantId,
    jobTitle,
    yearsExperience,
    industry,
    hasMadeHandoffDecisions: handoffExperienceInput.value === 'yes',
    submittedAt: new Date().toISOString()
  });

  showCard('taskCard');
}

// ───────── Instructions ─────────

function handleTaskStart() {
  currentConversationIndex = 0;
  renderConversationCard();
  showCard('datasetReviewCard');
}

// ───────── Conversation review ─────────

function renderConversationCard() {
  const conversation = studyConversations[currentConversationIndex];
  const header = document.getElementById('datasetReviewHeader');
  const container = document.getElementById('datasetReviewConversation');
  const questions = document.getElementById('datasetReviewQuestions');
  const nextButton = document.getElementById('datasetReviewNextButton');
  if (!conversation) return;

  const total = studyConversations.length;
  const progress = ((currentConversationIndex + 1) / total) * 100;
  header.innerHTML = `
    <h2 style="margin:0 0 4px; font-size:30px;">Conversation ${currentConversationIndex + 1} of ${total}</h2>
    <div class="study-progress" aria-label="Progress">
      <div class="study-progress-bar" style="width:${progress}%"></div>
    </div>
  `;

  container.innerHTML = `
    <div class="study-transcript">
      ${conversation.turns.map((turn) => `
        <div class="study-message ${turn.role === 'customer' ? 'customer' : 'agent'}">
          <strong>${turn.role === 'customer' ? 'Customer' : 'Agent'}:</strong>
          <span>${escapeHtml(turn.text || '')}</span>
        </div>
      `).join('')}
    </div>
  `;

  questions.innerHTML = `
    <div>
      <p style="margin:0 0 12px; font-size:22px; font-weight:700; line-height:1.3;">Should this conversation be transferred to a human customer-service representative?</p>
      <div class="study-choice-group">
        <button type="button" class="study-choice-button" data-choice="yes" aria-pressed="false">Yes — Transfer to Human</button>
        <button type="button" class="study-choice-button" data-choice="no" aria-pressed="false">No — Continue Automated Support</button>
      </div>
      <label style="display:block; margin-top:18px;">
        <span style="display:block; margin-bottom:6px; font-size:13px; color:#6b7280;">Optional: please briefly explain why you made this choice.</span>
        <textarea id="optionalReasonInput" class="survey-textarea" rows="3"></textarea>
      </label>
    </div>
  `;

  if (nextButton) {
    nextButton.textContent = currentConversationIndex === total - 1 ? 'Continue to Survey' : 'Next Conversation';
    nextButton.disabled = true;
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleChoiceClick(event) {
  const button = event.target.closest('.study-choice-button');
  if (!button) return;

  document.querySelectorAll('.study-choice-button').forEach((choice) => {
    const selected = choice === button;
    choice.classList.toggle('selected', selected);
    choice.setAttribute('aria-pressed', String(selected));
  });

  const nextButton = document.getElementById('datasetReviewNextButton');
  if (nextButton) nextButton.disabled = false;
}

async function handleReviewAdvance() {
  const selectedButton = document.querySelector('.study-choice-button.selected');
  if (!selectedButton) return;

  const conversation = studyConversations[currentConversationIndex];
  const reasonInput = document.getElementById('optionalReasonInput');

  if (!getSubmittedConversationIds(participantId).includes(conversation.conversationId)) {
    const nextButton = document.getElementById('datasetReviewNextButton');
    if (nextButton) nextButton.disabled = true;

    try {
      await submitParticipantResponse({
        participantId,
        role: STUDY_MODE,
        conversationId: conversation.conversationId,
        order: currentConversationIndex + 1,
        handoffDecision: selectedButton.dataset.choice === 'yes',
        optionalReason: reasonInput ? reasonInput.value.trim() : '',
        respondedAt: new Date().toISOString()
      });
      markConversationSubmitted(participantId, conversation.conversationId);
    } catch (error) {
      console.error('Response submission failed; participant remains on the current conversation.', error);
      if (nextButton) {
        nextButton.disabled = false;
        nextButton.textContent = 'Retry Submission';
      }
      window.alert('Your response could not be saved to the study database. Please check your connection and click Retry Submission. Your response is still saved in this browser.');
      return;
    }
  }

  if (currentConversationIndex < studyConversations.length - 1) {
    currentConversationIndex += 1;
    renderConversationCard();
    return;
  }

  await submitStudyCompletion({
    participantId,
    role: STUDY_MODE,
    completed: true,
    conversationCount: studyConversations.length,
    completedAt: new Date().toISOString()
  });

  if (STUDY_MODE === 'general') {
    window.location.assign(GENERAL_SURVEY_URL);
    return;
  }

  showCard('doneCard');
}

// ───────── Init ─────────

function wireEventListeners() {
  bindIfExists('consentCheckbox', 'change', handleConsentCheckboxChange);
  bindIfExists('consentSubmitButton', 'click', handleConsentSubmit);
  bindIfExists('consentDeclineButton', 'click', handleConsentDecline);
  bindIfExists('qualificationSubmitButton', 'click', handleQualificationSubmit);
  bindIfExists('taskStartButton', 'click', handleTaskStart);
  bindIfExists('datasetReviewQuestions', 'click', handleChoiceClick);
  bindIfExists('datasetReviewNextButton', 'click', handleReviewAdvance);
}

window.addEventListener('DOMContentLoaded', async () => {
  wireEventListeners();

  try {
    studyConversations = await loadStudyConversations();
  } catch (error) {
    console.error('Could not load study conversations.', error);
    showStudyUnavailable(
      `The study is currently unavailable (${error.message || error}). This is a developer error - ` +
      'confirm research/study_conversations.json exists next to this page and reload.'
    );
    return;
  }

  showCard('consentCard');
});
