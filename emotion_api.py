# ─────────────────────────────────────────────────────────────────────
# Local inference API for the participant study's sentiment/emotion
# analysis.
#
# The browser (sentimentAnalysis.js -> app.js's buildConversationModelAnalysis)
# cannot run the Hugging Face Transformers pipeline directly, so this
# small Flask server loads SamLowe/roberta-base-go_emotions once at
# startup and exposes it as POST /analyze-emotion. It uses the exact
# same mapping logic (emotion_mapping.py) as emotion_validation.py, so
# the participant study and the research validation script are backed
# by identical inference + mapping code.
#
# Run from the CustomerAgent/ directory:
#   ..\.venv\Scripts\python.exe emotion_api.py
#
# The study app expects this at http://127.0.0.1:5001.
# ─────────────────────────────────────────────────────────────────────

import logging

from flask import Flask, jsonify, request
from flask_cors import CORS
from transformers import pipeline

from emotion_mapping import MODEL_NAME, build_emotion_profile, normalize_text

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("emotion_api")

app = Flask(__name__)
CORS(app)

logger.info("Loading GoEmotions model (%s)... this happens once at startup.", MODEL_NAME)
_classifier = pipeline("text-classification", model=MODEL_NAME, top_k=None, truncation=True)
logger.info("GoEmotions model loaded and ready.")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": MODEL_NAME})


@app.route("/analyze-emotion", methods=["POST"])
def analyze_emotion():
    payload = request.get_json(silent=True) or {}
    text = normalize_text(payload.get("text"))

    if not text:
        return jsonify({"error": "Field 'text' is required and must be non-empty."}), 400

    try:
        raw_output = _classifier(text, truncation=True)
        profile = build_emotion_profile(raw_output, text)
    except Exception as exc:  # surfaced to the caller as a developer-visible error
        logger.exception("GoEmotions inference failed.")
        return jsonify({"error": f"GoEmotions inference failed: {exc}"}), 500

    return jsonify(profile)


if __name__ == "__main__":
    # Localhost only - this serves live model inference for the local
    # participant study, not a public endpoint.
    app.run(host="127.0.0.1", port=5001, debug=False)
