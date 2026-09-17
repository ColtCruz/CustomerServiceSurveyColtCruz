// ─────────────────────────────────────────────────────────────────────
// Fail-Safe Engine (failure-signal handoff condition)
//
// Same topic replies as the baseline engine, but runs every customer
// message through the deterministic classifier in sentimentAnalysis.js
// (sentiment, frustration, anger, urgency, confusion, escalationRisk,
// issueResolved, plus phrase-based rule flags: requestsHuman,
// mentionsChargeback, securityRisk, legalThreat) and tracks
// conversation-level trend (consecutiveNegativeTurns, sentimentDrop,
// lowestSentimentScore). This is the actual safety net: when it
// notices the conversation isn't working - repeated asks, rising
// anger, a direct request for a human - it acts, instead of leaving
// the customer to keep repeating themselves.
//
// Escalation rules are independent of raw sentiment - a calm message
// like "I believe my account has been compromised" escalates on
// securityRisk alone, not on how negative it sounds.
// ─────────────────────────────────────────────────────────────────────

function createFailsafeState(customer) {
  return {
    ...createBaseConversationState(customer),
    escalated: false,
    sentimentLabelHistory: []  // parallel to recentSentimentScores - needed for consecutiveNegativeTurns
  };
}

// ───────── Conversation-level trend ─────────

function computeConversationTrend(state) {
  const scores = state.recentSentimentScores;
  const labels = state.sentimentLabelHistory;

  let consecutiveNegativeTurns = 0;
  for (let i = labels.length - 1; i >= 0; i--) {
    if (labels[i] !== 'negative') break;
    consecutiveNegativeTurns += 1;
  }

  const lowestSentimentScore = scores.length ? Math.min(...scores) : 0;

  // How far the current turn has fallen from the best point reached
  // earlier in the conversation (not counting the current turn itself).
  const scoresBeforeCurrent = scores.slice(0, -1);
  const highestScoreSoFar = scoresBeforeCurrent.length ? Math.max(...scoresBeforeCurrent) : (scores[0] || 0);
  const currentScore = scores[scores.length - 1] || 0;
  const sentimentDrop = currentScore - highestScoreSoFar;

  return { consecutiveNegativeTurns, lowestSentimentScore, sentimentDrop };
}

// ───────── Escalation decision ─────────
// A user can be calm but still require escalation (e.g. a compromised
// account, or a firm cancellation/chargeback request) - those checks
// are independent of the sentiment-derived signals.

function shouldEscalate(result, conversationTrend) {
  return (
    result.escalationRisk >= 0.8 ||
    result.anger >= 0.85 ||
    conversationTrend.consecutiveNegativeTurns >= 3 ||
    conversationTrend.sentimentDrop <= -0.5 ||
    result.requestsHuman === true ||
    result.mentionsChargeback === true ||
    result.securityRisk === true ||
    result.legalThreat === true
  );
}

// ───────── Reply generation ─────────

async function generateFailsafeReply(userText, state) {
  state.turnCount += 1;

  const result = await classify(userText);
  state.recentSentimentScores.push(result.sentimentScore);
  state.sentimentLabelHistory.push(result.sentiment);
  const conversationTrend = computeConversationTrend(state);

  if (!state.escalated && result.issueResolved) {
    state.resolved = true;
    state.activeTopicId = null;
    return {
      text: RESOLVED_CLOSING_REPLY,
      escalated: false,
      topicConcluded: true,
      sentiment: result.sentiment,
      sentimentScore: result.sentimentScore,
      classification: result,
      conversationTrend
    };
  }

  if (!state.escalated && isSomethingElseRequest(userText)) {
    state.activeTopicId = null;
    return {
      text: SOMETHING_ELSE_REPLY,
      escalated: false,
      topicConcluded: true,
      sentiment: result.sentiment,
      sentimentScore: result.sentimentScore,
      classification: result,
      conversationTrend
    };
  }

  const topic = resolveTopicForMessage(state, userText);
  if (!topic) state.unmatchedTopicCount += 1;

  if (!state.escalated && shouldEscalate(result, conversationTrend)) {
    state.escalated = true;
    return {
      text: "Thanks for your patience - I want to make sure you get this fully sorted out, so I'm connecting you with a human support specialist who can take it from here.",
      escalated: true,
      topicConcluded: false,
      sentiment: result.sentiment,
      sentimentScore: result.sentimentScore,
      classification: result,
      conversationTrend
    };
  }

  if (state.escalated) {
    const tier = toneTier(result);
    const text = tier === 'angry'
      ? "Our support team has this now and will take it from here - no need to repeat anything, they can see everything so far."
      : 'A member of our support team now has this conversation and will continue helping you directly.';
    return {
      text,
      escalated: true,
      topicConcluded: false,
      sentiment: result.sentiment,
      sentimentScore: result.sentimentScore,
      classification: result,
      conversationTrend
    };
  }

  const topicReply = topic ? buildTopicReply(state, topic, result) : { text: buildUnclassifiedReply(state.customerEmail, result), topicConcluded: false };
  return {
    text: topicReply.text,
    escalated: false,
    topicConcluded: topicReply.topicConcluded,
    sentiment: result.sentiment,
    sentimentScore: result.sentimentScore,
    classification: result,
    conversationTrend
  };
}
