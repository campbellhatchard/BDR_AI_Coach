require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'activity.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ events: [] }, null, 2), 'utf8');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SCENARIOS = [
  {label:"Inventory Accuracy Issues", opening:"Inventory isn't always where the system says it is.", vertical:"Distribution", persona:"Operations Director"},
  {label:"Slow Receiving Process", opening:"Receiving takes longer than it should.", vertical:"Distribution", persona:"Warehouse Manager"},
  {label:"Shipping Delays", opening:"We're having trouble getting orders out on time.", vertical:"Distribution", persona:"VP Operations"},
  {label:"Too Much Manual Work", opening:"There's still a lot of manual work in our process.", vertical:"Multi-site Warehousing", persona:"Operations Director"},
  {label:"Lack of Real-Time Visibility", opening:"We don't always have a clear picture of inventory in real time.", vertical:"Distribution", persona:"Chief Supply Chain Officer"},
  {label:"Spreadsheet Reliance", opening:"We rely heavily on spreadsheets.", vertical:"Warehouse Operations", persona:"CIO"},
  {label:"Too Much Safety Stock", opening:"We carry more inventory than we'd like.", vertical:"Distribution", persona:"CFO"},
  {label:"Picking Errors", opening:"We see too many errors during picking.", vertical:"Distribution", persona:"VP Customer Experience"},
  {label:"Inconsistent Processes Across Locations", opening:"Each site tends to do things a bit differently.", vertical:"Multi-site Operations", persona:"COO"},
  {label:"ERP Doesn't Reflect Reality", opening:"Our ERP doesn't always match what's happening on the floor.", vertical:"Warehouse Operations", persona:"CIO"},
  {label:"Production Delays", opening:"Production gets delayed waiting on materials.", vertical:"Manufacturing", persona:"Plant Director"},
  {label:"Field Inventory Issues", opening:"Technicians don't always have the parts they need.", vertical:"Field Service", persona:"VP Service Operations"},
  {label:"Too Many Fire Drills", opening:"We spend a lot of time reacting to issues.", vertical:"Warehouse Operations", persona:"VP Operations"},
  {label:"Difficult to Train New Staff", opening:"It takes too long to get new people up to speed.", vertical:"Warehouse Operations", persona:"Director of Operations"},
  {label:"Integration Challenges", opening:"Our systems don't always work well together.", vertical:"Supply Chain Operations", persona:"IT Director"}
];

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { events: [] }; }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}
function appendEvent(event) {
  const data = loadData();
  data.events = data.events || [];
  data.events.push(event);
  saveData(data);
}
function makeSafetyIdentifier(name, sessionId) {
  const raw = `${name || 'unknown'}|${sessionId || 'unknown'}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash) + raw.charCodeAt(i);
  return `ci_${Math.abs(hash)}`;
}
function extractOutputText(resp) {
  if (resp.output_text) return resp.output_text;
  let texts = [];
  for (const item of (resp.output || [])) {
    for (const c of (item.content || [])) {
      if (typeof c.text === 'string') texts.push(c.text);
      else if (c.text && typeof c.text.value === 'string') texts.push(c.text.value);
    }
  }
  return texts.join('\n').trim();
}
function parseJsonFromText(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in model response');
  return JSON.parse(match[0]);
}

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/api/config', (req, res) => {
  res.json({ scenarios: SCENARIOS, modelConfigured: !!OPENAI_API_KEY, model: OPENAI_MODEL });
});

app.post('/api/respond', async (req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(400).json({ ok: false, error: 'OPENAI_API_KEY is not configured on the server.' });

    const { bdr_name, session_id, scenario, difficulty, history, bdr_response } = req.body || {};
    const safety_identifier = makeSafetyIdentifier(bdr_name, session_id);
    const level = (difficulty || 'medium').toLowerCase();

    const difficultyRules = {
      easy: `Difficulty level: EASY.
- Prospect is open, cooperative, and reasonably clear.
- They volunteer more detail when the BDR asks decent questions.
- Score more generously for solid discovery behavior.`,
      medium: `Difficulty level: MEDIUM.
- Prospect is realistic and moderately busy.
- They answer useful questions but do not over-volunteer detail.
- Scoring should be balanced and realistic.`,
      hard: `Difficulty level: HARD.
- Prospect is skeptical, busy, and less patient.
- They push back on vague questions and early pitching.
- They reveal less detail unless the BDR earns it with strong, specific discovery.
- Score more strictly.`
    };

    const instructions = `You are simulating a prospect in a Cloud Inventory BDR coaching application.

This tool trains BDRs in:
- problem discovery
- operational root cause probing
- business impact articulation
- transition from discovery to a meeting request with Sales/Presales

${difficultyRules[level] || difficultyRules.medium}

Return ONLY valid JSON in this exact shape:
{
  "question_type_detected": ["location"|"cause"|"impact"|"urgency"|"product-led"|"generic question"|"not a question"],
  "prospect_reply": "string",
  "score": 0,
  "strengths": ["string"],
  "weaknesses": ["string"],
  "better_next_response": "string",
  "discovery_progress": {
    "problem_location": "not found|partial|found",
    "likely_cause": "not found|partial|found",
    "business_impact": "not found|partial|found",
    "why_it_matters_now": "not found|partial|found"
  },
  "transition_readiness": "not_ready|almost_ready|ready",
  "transition_coaching": ["string"],
  "suggested_transition": "string",
  "problem_summary_hints": ["string"]
}

Rules:
- Stay in role as the prospect.
- Be concise and realistic.
- Reward good discovery questions.
- Push back on early pitching.
- If the BDR is vague, ask for more specificity.
- If the BDR asks strong questions, reveal useful detail.
- Keep the prospect tone aligned to the persona.
- Do not mention being an AI model.
- Only mark transition_readiness as "ready" when the BDR has uncovered a clear problem and at least one meaningful business impact or urgency signal.
- The suggested_transition must sound natural, consultative, and should position a Sales/Presales meeting as the logical next step rather than a product demo.
- If not ready, suggested_transition should still be useful but explain what is missing before asking for a meeting.`;

    const transcript = (history || []).map(item => `${item.speaker}: ${item.text}`).join('\n');

    const payload = {
      model: OPENAI_MODEL,
      instructions,
      input: [{
        role: 'user',
        content: [{
          type: 'input_text',
          text: `Scenario label: ${scenario?.label || ''}
Vertical: ${scenario?.vertical || ''}
Prospect persona: ${scenario?.persona || ''}
Difficulty: ${level}
Opening statement: ${scenario?.opening || ''}

Transcript so far:
${transcript}

Latest BDR response:
${bdr_response || ''}`
        }]
      }],
      temperature: 0.4,
      max_output_tokens: 1100,
      store: false,
      safety_identifier
    };

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const raw = await response.text();
    if (!response.ok) return res.status(500).json({ ok: false, error: raw });

    const parsedBody = JSON.parse(raw);
    const parsed = parseJsonFromText(extractOutputText(parsedBody));

    appendEvent({
      type: 'turn',
      timestamp: Date.now(),
      session_id,
      bdr_name,
      scenario_label: scenario?.label || null,
      scenario_vertical: scenario?.vertical || null,
      scenario_persona: scenario?.persona || null,
      difficulty: level,
      bdr_response,
      score: parsed.score,
      question_type_detected: parsed.question_type_detected || [],
      strengths: parsed.strengths || [],
      weaknesses: parsed.weaknesses || [],
      discovery_progress: parsed.discovery_progress || {},
      transition_readiness: parsed.transition_readiness || 'not_ready',
      transition_coaching: parsed.transition_coaching || [],
      suggested_transition: parsed.suggested_transition || ''
    });

    res.json({ ok: true, result: parsed });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Unknown server error' });
  }
});

app.post('/api/log-summary', (req, res) => {
  const { session_id, bdr_name, scenario_label, difficulty, summary_text, summary_score, summary_feedback } = req.body || {};
  appendEvent({
    type: 'summary',
    timestamp: Date.now(),
    session_id,
    bdr_name,
    scenario_label,
    difficulty,
    summary_text,
    summary_score,
    summary_feedback: summary_feedback || []
  });
  res.json({ ok: true });
});

app.get('/api/manager-data', (req, res) => {
  const events = (loadData().events || []);
  const byBdr = {};
  for (const ev of events) {
    const name = ev.bdr_name || 'Unknown';
    if (!byBdr[name]) byBdr[name] = { turns: 0, summaries: 0, scores: [], questionTypes: {}, weaknesses: {}, scenarios: {}, readiness: {}, difficulties: {} };
    const row = byBdr[name];
    if (ev.type === 'turn') {
      row.turns += 1;
      if (typeof ev.score === 'number') row.scores.push(ev.score);
      for (const qt of (ev.question_type_detected || [])) row.questionTypes[qt] = (row.questionTypes[qt] || 0) + 1;
      for (const w of (ev.weaknesses || [])) row.weaknesses[w] = (row.weaknesses[w] || 0) + 1;
      const scen = ev.scenario_label || 'Unknown';
      row.scenarios[scen] = (row.scenarios[scen] || 0) + 1;
      const ready = ev.transition_readiness || 'not_ready';
      row.readiness[ready] = (row.readiness[ready] || 0) + 1;
      const diff = ev.difficulty || 'medium';
      row.difficulties[diff] = (row.difficulties[diff] || 0) + 1;
    } else if (ev.type === 'summary') {
      row.summaries += 1;
    }
  }
  const rows = Object.entries(byBdr).map(([bdr_name, row]) => ({
    bdr_name,
    turns: row.turns,
    summaries: row.summaries,
    avg_score: row.scores.length ? Math.round((row.scores.reduce((a,b)=>a+b,0)/row.scores.length) * 10) / 10 : null,
    question_types: Object.entries(row.questionTypes).sort((a,b)=>b[1]-a[1]),
    top_weaknesses: Object.entries(row.weaknesses).sort((a,b)=>b[1]-a[1]).slice(0,5),
    scenarios: Object.entries(row.scenarios).sort((a,b)=>b[1]-a[1]).slice(0,5),
    transition_readiness: row.readiness,
    difficulties: row.difficulties
  })).sort((a,b)=> (b.avg_score || 0) - (a.avg_score || 0));
  res.json({ rows, event_count: events.length });
});

app.get('/manager', (req, res) => res.sendFile(path.join(__dirname, 'public', 'manager.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((req, res) => res.status(404).send('Not Found'));

app.listen(PORT, () => console.log(`Cloud Inventory BDR AI Coach running on port ${PORT}`));
