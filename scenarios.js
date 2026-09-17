// ─────────────────────────────────────────────────────────────────────
// Scenarios
//
// Shared support-topic data and reply-building helpers used by both
// agent engines (failsafeEngine.js and baselineEngine.js). Neither
// engine owns this data outright since both conditions must answer
// identically on the "happy path" — only their escalation behavior
// differs.
// ─────────────────────────────────────────────────────────────────────

// Each tier below is an ARRAY of variants, not a single string. The
// baseline (and fail-safe, pre-escalation) agent genuinely can't do
// anything beyond these canned options - that's the point being
// demonstrated - but early on this was a single fixed string per tier,
// so a customer who got a fallback reply and then said essentially the
// same thing again (asking a second, third, fourth... time) got back
// byte-identical text. That reads as broken/unresponsive rather than
// "limited but still trying," especially once the customer calls out
// the repetition directly. Cycling through differently-worded variants
// (see pickFallbackVariant below) keeps the same underlying truth -
// none of these ever actually resolve the issue, they all still just
// point to the same email address and the same menu of options - while
// no longer literally repeating the prior message word-for-word.
const SUPPORT_TOPICS = [
  {
    id: 'order',
    label: 'Order status / tracking',
    keywords: ['order', 'tracking', 'track', 'shipment', 'ship', 'deliver', 'package'],
    firstAttemptReply: "Thanks for reaching out about your order - I'd be happy to help track it down. Could you share your order number so I can look into the current shipping status for you?",
    fallbackReplies: {
      calm: [
        "Thank you for confirming that. I don't have a way to check live shipping status beyond what I've already shown you, so I've sent this to our support team - support@example.com with your order number reaches them directly. A few related options: Track a package, Report a missing delivery, Request a refund.",
        "I don't have a way to pull anything past what I've already shown you. I've logged this for our support team - email support@example.com with your order number and a person will pick it up. In the meantime: Track a package, Report a missing delivery, Request a refund.",
        "This is past what I can do on my end, honestly. I've passed your order details to our support team - support@example.com with your order number gets you a person directly. Related options: Track a package, Report a missing delivery, Request a refund.",
        "I want to be straight with you: I can't check the warehouse system myself. I've sent your order number to our support team so someone with access can look. You can also reach them at support@example.com. Other options: Track a package, Report a missing delivery, Request a refund.",
        "That's helpful, thank you. I've forwarded it to our support team since I can't go further than what I've already told you - support@example.com with your order number if you'd rather reach them yourself. A few things that might help: Track a package, Report a missing delivery, Request a refund."
      ],
      frustrated: [
        "I know this hasn't moved, and I get why that's frustrating. I've sent your order details to our support team so a person can dig in - support@example.com with your order number is the fastest way to reach them. Related options: Track a package, Report a missing delivery, Request a refund.",
        "You shouldn't have to keep asking. I've flagged this again for our support team - support@example.com with your order number gets an actual person on it. What I still have: Track a package, Report a missing delivery, Request a refund.",
        "I don't want to just repeat myself either, so I've re-sent your details to the team directly. If you'd rather not wait on that, support@example.com with your order number reaches someone yourself. Options on my end: Track a package, Report a missing delivery, Request a refund.",
        "Fair enough - I haven't been able to move this forward. I've pushed it to our support team again just now. support@example.com with your order number if you want to follow up in parallel. Still available: Track a package, Report a missing delivery, Request a refund.",
        "I hear that this is dragging on. I don't have anything new to offer beyond flagging it for our team again, which I've just done - support@example.com with your order number reaches them directly. Related options: Track a package, Report a missing delivery, Request a refund."
      ],
      angry: [
        "You're right to be upset - this should've been sorted by now. I've escalated your order details to our support team so a specialist can dig in directly. Email support@example.com with your order number if you'd rather chase it yourself.",
        "That's a fair thing to be angry about. I've pushed this to our support team as urgent just now - support@example.com with your order number reaches a person directly if you want to follow up yourself.",
        "I'm sorry this has dragged on this long. I've flagged it for our support team right now, marked urgent - support@example.com with your order number if you'd like to reach them directly.",
        "You've every right to be furious about this. I've sent your order details to our support team with a note that this needs attention now - support@example.com with your order number for a direct line.",
        "This shouldn't have taken this long, and I understand the frustration. I've escalated your order to our support team as a priority - support@example.com with your order number if you want to follow up yourself in the meantime."
      ]
    }
  },
  {
    id: 'password',
    label: 'Password reset / login',
    keywords: ['password', 'login', 'log in', 'sign in', 'locked', 'account access', 'reset'],
    firstAttemptReply: "No worries, I can help you get back into your account. Please use the 'Forgot Password' link on the sign-in page - you should receive a reset email within a few minutes. Let me know if that comes through.",
    fallbackReplies: {
      calm: [
        "Thanks for letting me know. I can't unlock the account myself, so I've sent this to our support team - support@example.com with your account email reaches them directly. Other options: Reset password, Unlock account, Update account email.",
        "I don't have access to unlock accounts from here, but I've logged this for our support team to handle. You're also welcome to email support@example.com with your account email. Other options: Reset password, Unlock account, Update account email.",
        "Since the reset email still isn't arriving, I've passed this along to our support team - they can look into it directly. support@example.com with your account email reaches them. What I can offer: Reset password, Unlock account, Update account email.",
        "I want to be upfront: I can't reset this manually myself. I've forwarded your details to the team who can. support@example.com with your account email if you'd rather reach them directly. Other options: Reset password, Unlock account, Update account email.",
        "That's useful, thank you. I've sent this to our support team since I've run out of things I can try on my end - support@example.com with your account email. Related options: Reset password, Unlock account, Update account email."
      ],
      frustrated: [
        "I can see this is still a problem, and I don't want to leave you stuck. I've forwarded your details to our support team - support@example.com with your account email reaches a person directly. Other options: Reset password, Unlock account, Update account email.",
        "I get that repeating this is frustrating. I've sent it to our support team again just now - support@example.com with your account email is the quickest way to a person. Same options: Reset password, Unlock account, Update account email.",
        "I don't want you going in circles either. I've re-flagged this for the team directly. If you'd rather not wait, support@example.com with your account email gets a person on it. What I have: Reset password, Unlock account, Update account email.",
        "This is taking longer than it should, I know. I've pushed your account details to our support team again - support@example.com with your account email if you want to follow up yourself. Still available: Reset password, Unlock account, Update account email.",
        "I hear you - being locked out this long isn't right. I don't have a way to fix it myself, but I've re-sent everything to the team. support@example.com with your account email reaches them directly."
      ],
      angry: [
        "You've every right to be annoyed - being locked out is genuinely frustrating. I've sent this straight to our support team for hands-on help. Email support@example.com with your account email if you'd like to follow up directly.",
        "That's a completely fair reaction to being locked out this long. I've pushed this to our support team as urgent - support@example.com with your account email reaches them directly.",
        "I hear you - this has gone on too long. I've re-sent your details to our support team right now, marked urgent. support@example.com with your account email if you want to reach them yourself.",
        "This shouldn't still be a problem, and I'm sorry it is. I've flagged your account with our support team as a priority - support@example.com with your account email for a direct line.",
        "You're right to be upset about this. I've escalated it to our support team just now - support@example.com with your account email if you'd rather chase it yourself in the meantime."
      ]
    }
  },
  {
    id: 'refund',
    label: 'Refund / billing question',
    keywords: ['refund', 'charge', 'billing', 'bill', 'payment', 'money back', 'double charged', 'overcharged'],
    firstAttemptReply: "I understand, and I'm glad to help look into that refund or billing question. Refunds are typically processed within 5-7 business days once the return is received - let me check on the specifics for your case.",
    fallbackReplies: {
      calm: [
        "Thank you for the details. I can't adjust billing directly myself, so I've flagged this for our support team to review - support@example.com with your order number reaches them. Related options: Dispute a charge, Request a refund, Update payment method.",
        "I don't have a way to issue that adjustment myself, but I've logged it for the team. support@example.com with your order number gets a person looking at it directly. What I can offer: Dispute a charge, Request a refund, Update payment method.",
        "This is past what I can resolve on my end, honestly. I've sent your billing details to our support team - support@example.com with your order number reaches them directly. Related options: Dispute a charge, Request a refund, Update payment method.",
        "I want to be straight with you: I can't touch billing records myself. I've forwarded this to the team who can. support@example.com with your order number if you'd rather reach them directly. Other options: Dispute a charge, Request a refund, Update payment method.",
        "That's helpful, thank you. I've flagged it for our support team since I've reached the limit of what I can do here - support@example.com with your order number. Related options: Dispute a charge, Request a refund, Update payment method."
      ],
      frustrated: [
        "I hear that this still isn't sorted, and I don't want to leave you hanging. I've flagged it for our support team to review properly - support@example.com with your order number reaches them. Related options: Dispute a charge, Request a refund, Update payment method.",
        "I hear that this keeps coming back unresolved. I've flagged it again for our support team just now - support@example.com with your order number is the quickest path to a person. Same options: Dispute a charge, Request a refund, Update payment method.",
        "I don't want to just repeat myself here either. I've re-sent this to the team directly. If you'd rather not wait, support@example.com with your order number reaches someone yourself. What I have: Dispute a charge, Request a refund, Update payment method.",
        "This is taking longer than it should, I know. I've pushed your billing details to the team again - support@example.com with your order number if you want to follow up yourself. Still available: Dispute a charge, Request a refund, Update payment method.",
        "I get why this is frustrating - it's unresolved and I can't fix it myself. I've re-sent everything to our support team. support@example.com with your order number reaches them directly."
      ],
      angry: [
        "That's a fair frustration to have about a billing issue - I've escalated this to our support team right now so they can take a closer look. Email support@example.com with your order number if you'd like to follow up yourself.",
        "That's a fair thing to be upset about with a billing issue like this. I've escalated it to our support team right now - support@example.com with your order number if you want to chase it yourself in the meantime.",
        "I hear you, and this should've been sorted already. I've re-flagged this as urgent for the team - support@example.com with your order number reaches a person directly.",
        "You're right to be angry about a billing issue like this. I've sent it to our support team marked urgent - support@example.com with your order number for a direct line.",
        "This shouldn't have taken this long to sort out, and I'm sorry it has. I've escalated your billing issue to our support team as a priority - support@example.com with your order number if you'd like to follow up yourself."
      ]
    }
  }
];

// Tone tier derived from the classifier's per-turn signals - the same
// dimensions the fail-safe engine uses for escalation decisions, reused
// here so reply wording reflects how the customer actually sounds
// instead of repeating identical copy regardless of sentiment. A
// message flagged as repeatedComplaint (e.g. "you already said that",
// "how many times") reads as at least frustrated even when the word-
// and phrase-level scores alone come out near zero, since calling out
// the repetition is itself a clear signal the canned reply isn't
// landing - without this, that exact callout could otherwise still be
// answered with the calm-tier variant.
function toneTier(result) {
  if (!result) return 'calm';
  if (result.anger >= 0.4 || result.sentimentScore <= -0.6) return 'angry';
  if (result.frustration >= 0.4 || result.sentimentScore <= -0.3 || result.anger > 0 || result.repeatedComplaint) return 'frustrated';
  return 'calm';
}

// Cycles through a tier's fallback variants by how many times this
// topic has already fallen back (1st fallback -> variants[0], 2nd ->
// variants[1], ...), wrapping around rather than running out, so
// repeat asks read as differently-worded non-answers instead of an
// identical repeated string.
function pickFallbackVariant(variants, fallbackCount) {
  return variants[(fallbackCount - 1) % variants.length];
}

// Quick-reply prompts shown right after intake. Each sampleMessage is
// worded to contain that topic's own keywords so clicking it resolves
// the same way as if the customer had typed it.
const QUICK_REPLY_PROMPTS = [
  { id: 'order', label: 'Order status / tracking', sampleMessage: 'I have a question about order tracking.' },
  { id: 'password', label: 'Password reset / login', sampleMessage: 'I have a question about password reset / login.' },
  { id: 'refund', label: 'Refund / billing question', sampleMessage: 'I have a refund / billing question.' },
  { id: 'other', label: 'Something else', sampleMessage: 'Something else' }
];

// Shown when the message doesn't match any known topic. Personalized
// with the customer's own email (collected at intake) so they know
// where a specialist will follow up, in addition to the general inbox.
// Tone tracks the classifier's read on the customer's current message,
// same as buildTopicReply, so an unmatched message written in obvious
// frustration doesn't get the same flat menu-recital as a calm one.
const UNCLASSIFIED_REPLIES = {
  calm: "I want to make sure you get to the right place - right now I'm able to help with order tracking, password/login issues, and refund or billing questions. Could you let me know which of these fits best? For anything else, feel free to email support@example.com.",
  frustrated: "I know this is taking a few tries, and I want to get you to the right place - right now I can help directly with order tracking, password/login issues, and refund or billing questions. Let me know if one of those fits, or email support@example.com for anything else.",
  angry: "I don't want to keep sending you in circles - here's what I can help with directly: order tracking, password/login issues, and refund or billing questions. If none of those fit, support@example.com will get you a person right away."
};

function buildUnclassifiedReply(customerEmail, result) {
  const followUpNote = customerEmail
    ? ` I've also made a note so a specialist can follow up with you directly at ${customerEmail}.`
    : '';
  const tier = toneTier(result);
  return `${UNCLASSIFIED_REPLIES[tier]}${followUpNote}`;
}

// "Something else" (the quick-reply button, or a customer typing the
// same intent) means "none of the listed topics fit" - it should drop
// whatever topic was active and re-offer the topic menu, not fall
// through to the sticky-active-topic behavior in resolveTopicForMessage
// (which would otherwise just repeat the old topic's last reply).
function isSomethingElseRequest(text) {
  return text.toLowerCase().includes('something else');
}

const SOMETHING_ELSE_REPLY = 'Sure - here are the things I can help with. Pick one below, or tell me more about what you need:';

const HUMAN_REQUEST_PHRASES = [
  'human', 'representative', 'real person', 'live agent', 'speak to someone',
  'talk to someone', 'talk to a person', 'speak to a manager', 'speak with a manager',
  'speak with a supervisor', 'talk to a supervisor', 'supervisor'
];

// Deliberately excludes bare "thanks" / "thank you" - those are common
// mid-conversation filler ("thank you, yes, please continue") and were
// getting misread as the customer closing out the conversation.
const RESOLUTION_PHRASES = [
  'that worked', 'that solved it', 'solved', 'resolved', 'got it, thanks',
  'perfect, thanks', 'all set', 'finally fixed', 'problem solved', 'thank you for helping'
];

// ───────── Matching helpers ─────────

function matchTopic(text) {
  const lowerText = text.toLowerCase();
  return SUPPORT_TOPICS.find((topic) => topic.keywords.some((keyword) => lowerText.includes(keyword))) || null;
}

// Falls back to whatever topic is already active in the conversation
// when the message doesn't contain a fresh topic keyword, so a plain
// continuation ("yes please", "ok what about the charge") doesn't
// bounce the customer back to "please choose a topic."
function resolveTopicForMessage(state, text) {
  return matchTopic(text) || (state.activeTopicId ? SUPPORT_TOPICS.find((topic) => topic.id === state.activeTopicId) : null);
}

function containsHumanRequest(text) {
  const lowerText = text.toLowerCase();
  return HUMAN_REQUEST_PHRASES.some((phrase) => lowerText.includes(phrase));
}

function containsResolutionPhrase(text) {
  const lowerText = text.toLowerCase();
  return RESOLUTION_PHRASES.some((phrase) => lowerText.includes(phrase));
}

// ───────── Shared conversation state + reply building ─────────

// Base fields both engines track. Each engine extends this with its
// own escalation-specific fields (see createFailsafeState /
// createBaselineState). `customer` is the { name, email } collected at
// intake (see app.js) - carried on the state so engines can
// personalize replies (e.g. the unclassified-topic follow-up email).
function createBaseConversationState(customer) {
  return {
    turnCount: 0,
    resolved: false,
    activeTopicId: null,  // topic the conversation is currently on, if any
    topicAskCounts: {},   // topicId -> number of times asked
    fallbackCounts: {},   // topicId -> number of times fallback reply was given
    unmatchedTopicCount: 0,
    recentSentimentScores: [],  // tracked in both conditions; only failsafeEngine acts on it
    customerName: (customer && customer.name) || '',
    customerEmail: (customer && customer.email) || ''
  };
}

// First time a topic is asked about, give the first-attempt reply.
// Every time after that, give the fallback (email / other options),
// worded to match how the customer's message actually reads (see
// toneTier) rather than repeating the same line regardless of how
// much more frustrated they've gotten since the last ask.
// Identical for both agent conditions - only escalation differs.
// `topicConcluded` tells the caller (app.js) whether this is a natural
// point to re-offer the topic prompts, since the fallback is the last
// thing either agent condition can say about a topic on its own.
function buildTopicReply(state, topic, result) {
  state.activeTopicId = topic.id;

  const askCount = (state.topicAskCounts[topic.id] || 0) + 1;
  state.topicAskCounts[topic.id] = askCount;

  const isRepeatAsk = askCount > 1;
  if (isRepeatAsk) {
    const fallbackCount = (state.fallbackCounts[topic.id] || 0) + 1;
    state.fallbackCounts[topic.id] = fallbackCount;
    const tier = toneTier(result);
    return { text: pickFallbackVariant(topic.fallbackReplies[tier], fallbackCount), topicConcluded: true };
  }
  return { text: topic.firstAttemptReply, topicConcluded: false };
}

const RESOLVED_CLOSING_REPLY = "That's great to hear! Is there anything else I can help you with today?";
