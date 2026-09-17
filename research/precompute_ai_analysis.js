// Researcher-only: runs GoEmotions inference once across all 25 study
// conversations and saves the result to ai_analysis_25.json. Never loaded by
// any participant-facing page - the AI output must stay hidden from
// participants and professional reviewers during their review.
//
// Requires emotion_api.py running locally (python emotion_api.py from the
// CustomerAgent directory) - this script calls it once per customer turn.
//
// Run from the CustomerAgent directory:
//   node research/precompute_ai_analysis.js

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONVERSATIONS_PATH = path.join(ROOT, 'research', 'study_conversations.json');
const OUTPUT_PATH = path.join(ROOT, 'research', 'ai_analysis_25.json');

function loadContext() {
  const context = {
    console,
    fetch,
    module: { exports: {} },
    exports: {},
    require,
    __dirname: ROOT,
    __filename: path.join(ROOT, 'precompute_ai_analysis.js')
  };
  vm.createContext(context);

  // sentimentAnalysis.js: analyzeCustomerTurnWithGoEmotions() (calls emotion_api.py)
  // failsafeEngine.js: shouldEscalate() - same escalation rule the live app used
  const files = ['sentimentAnalysis.js', 'failsafeEngine.js'];
  files.forEach((file) => {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(code, context, { filename: file });
  });

  return context;
}

// Ported from the former buildConversationModelAnalysis()/
// computeConversationTrendFromSequence() in app.js - relocated here because
// the live app no longer runs any inference during a participant session.
function computeConversationTrendFromSequence(sentimentScores, sentimentLabels) {
  let consecutiveNegativeTurns = 0;
  for (let i = sentimentLabels.length - 1; i >= 0; i -= 1) {
    if (String(sentimentLabels[i] || '').toLowerCase() !== 'negative') break;
    consecutiveNegativeTurns += 1;
  }

  const scoresBeforeCurrent = sentimentScores.slice(0, -1);
  const highestScoreSoFar = scoresBeforeCurrent.length ? Math.max(...scoresBeforeCurrent) : (sentimentScores[0] || 0);
  const currentScore = sentimentScores[sentimentScores.length - 1] || 0;
  const sentimentDrop = currentScore - highestScoreSoFar;

  return { consecutiveNegativeTurns, sentimentDrop };
}

async function buildConversationAiAnalysis(context, conversation) {
  const customerTurns = conversation.turns.filter((turn) => turn.role === 'customer');
  const sentimentScores = [];
  const sentimentLabels = [];
  const customerTurnAnalysis = [];
  let highestEscalationRisk = 0;
  let escalationTurn = null;
  let escalationTriggers = [];

  let index = 0;
  for (const turn of customerTurns) {
    const result = await context.analyzeCustomerTurnWithGoEmotions(String(turn.text || ''));
    const trend = computeConversationTrendFromSequence(
      sentimentScores.concat(result.sentimentScore),
      sentimentLabels.concat(result.sentiment)
    );

    const reasons = [];
    if (result.escalationRisk >= 0.8) reasons.push('escalation risk >= 0.80');
    if (result.anger >= 0.85) reasons.push('anger >= 0.85');
    if (trend.consecutiveNegativeTurns >= 3) reasons.push('consecutive negative turns >= 3');
    if (trend.sentimentDrop <= -0.5) reasons.push('sentiment drop <= -0.50');
    if (result.requestsHuman) reasons.push('direct request for human');
    if (result.mentionsChargeback) reasons.push('chargeback language');
    if (result.securityRisk) reasons.push('security risk');
    if (result.legalThreat) reasons.push('legal threat');

    const escalatedOnThisTurn = context.shouldEscalate(result, trend);

    const turnAnalysis = {
      turnNumber: turn.turnNumber,
      customerTurn: index + 1,
      customerMessage: String(turn.text || '').trim(),
      sentimentLabel: result.sentiment,
      sentimentScore: Number(result.sentimentScore || 0),
      frustration: Number(result.frustration || 0),
      anger: Number(result.anger || 0),
      urgency: Number(result.urgency || 0),
      confusion: Number(result.confusion || 0),
      escalationRisk: Number(result.escalationRisk || 0),
      humanRequest: Boolean(result.requestsHuman),
      chargeback: Boolean(result.mentionsChargeback),
      securityRisk: Boolean(result.securityRisk),
      legalThreat: Boolean(result.legalThreat),
      rawGoEmotions: Array.isArray(result.rawGoEmotions) ? result.rawGoEmotions : [],
      mappedEmotionScores: result.mappedEmotionScores || {},
      consecutiveNegativeTurns: trend.consecutiveNegativeTurns,
      sentimentDrop: Number(trend.sentimentDrop || 0),
      escalatedOnThisTurn,
      escalationTriggers: reasons
    };

    highestEscalationRisk = Math.max(highestEscalationRisk, turnAnalysis.escalationRisk);
    sentimentScores.push(result.sentimentScore);
    sentimentLabels.push(result.sentiment);
    customerTurnAnalysis.push(turnAnalysis);

    if (escalatedOnThisTurn && escalationTurn === null) {
      escalationTurn = turnAnalysis.customerTurn;
      escalationTriggers = reasons.length ? reasons : ['escalation rule triggered'];
    }

    index += 1;
  }

  const finalTurn = customerTurnAnalysis[customerTurnAnalysis.length - 1] || {
    sentimentLabel: 'neutral', sentimentScore: 0, frustration: 0, anger: 0,
    urgency: 0, confusion: 0, escalationRisk: 0, rawGoEmotions: [], mappedEmotionScores: {}
  };

  return {
    conversationId: conversation.conversationId,
    finalSentiment: finalTurn.sentimentLabel,
    sentimentScore: Number(finalTurn.sentimentScore || 0),
    frustration: Number(finalTurn.frustration || 0),
    anger: Number(finalTurn.anger || 0),
    urgency: Number(finalTurn.urgency || 0),
    confusion: Number(finalTurn.confusion || 0),
    escalationRisk: Number(finalTurn.escalationRisk || 0),
    highestEscalationRisk,
    aiHandoffDecision: customerTurnAnalysis.some((turn) => turn.escalatedOnThisTurn) || escalationTurn !== null,
    escalationTurn,
    escalationTriggers,
    customerTurnAnalysis
  };
}

async function main() {
  const context = loadContext();
  const conversations = JSON.parse(fs.readFileSync(CONVERSATIONS_PATH, 'utf8'));

  const results = [];
  for (const conversation of conversations) {
    console.log(`Analyzing ${conversation.conversationId}...`);
    results.push(await buildConversationAiAnalysis(context, conversation));
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Wrote ${results.length} AI analysis records to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
