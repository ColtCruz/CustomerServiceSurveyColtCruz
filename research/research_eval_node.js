const fs = require('fs');
const vm = require('vm');
const path = require('path');

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    module: { exports: {} },
    exports: {},
    require,
    __dirname: root,
    __filename: path.join(root, 'research_eval_node.js')
  };

  const files = ['scenarios.js', 'sentimentAnalysis.js', 'failsafeEngine.js'];
  files.forEach((file) => {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    vm.runInNewContext(code, context);
  });

  return context;
}

async function main() {
  const payload = process.argv[2] ? JSON.parse(process.argv[2]) : { messages: [] };
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const context = loadContext();
  const state = context.createFailsafeState({ name: 'Research', email: 'research@example.com' });
  const turns = [];
  let escalatedTurn = null;

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    const result = await context.generateFailsafeReply(message, state);

    if (result.escalated && escalatedTurn === null) {
      escalatedTurn = i + 1;
    }

    turns.push({
      turn: i + 1,
      customerMessage: message,
      agentSentiment: result.sentiment,
      agentSentimentScore: Number(result.sentimentScore || 0),
      agentEscalationRisk: Number((result.classification && result.classification.escalationRisk) || 0),
      agentEscalated: !!result.escalated,
      handoffTriggered: !!result.escalated,
      classification: result.classification || {},
      conversationTrend: result.conversationTrend || {}
    });
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    totalTurns: state.turnCount,
    escalatedTurn,
    finalEscalated: !!state.escalated,
    turns
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
