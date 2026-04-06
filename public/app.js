const state = {
  bdrName: localStorage.getItem('ci_bdr_name') || '',
  sessionId: 'sess_' + Math.random().toString(36).slice(2),
  current: null,
  history: [],
  scores: []
};

const els = {
  bdrVal: document.getElementById('bdrVal'),
  scenarioVal: document.getElementById('scenarioVal'),
  scoreVal: document.getElementById('scoreVal'),
  avgVal: document.getElementById('avgVal'),
  modelVal: document.getElementById('modelVal'),
  scenarioSelect: document.getElementById('scenarioSelect'),
  metaTags: document.getElementById('metaTags'),
  prospectBox: document.getElementById('prospectBox'),
  reply: document.getElementById('reply'),
  submitBtn: document.getElementById('submitBtn'),
  feedbackBox: document.getElementById('feedbackBox'),
  transcript: document.getElementById('transcript'),
  pLocation: document.getElementById('p-location'),
  pCause: document.getElementById('p-cause'),
  pImpact: document.getElementById('p-impact'),
  pUrgency: document.getElementById('p-urgency'),
  summaryBtn: document.getElementById('summaryBtn'),
  summaryWrap: document.getElementById('summaryWrap'),
  summaryInput: document.getElementById('summaryInput'),
  evalSummaryBtn: document.getElementById('evalSummaryBtn'),
  summaryFeedback: document.getElementById('summaryFeedback'),
  restartBtn: document.getElementById('restartBtn'),
  nameModal: document.getElementById('nameModal'),
  nameInput: document.getElementById('nameInput'),
  saveNameBtn: document.getElementById('saveNameBtn')
};

function esc(s){ return String(s || '').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
function avg(arr){ return arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : '-'; }

function setPill(el, status){
  el.className = 'pill';
  if(status === 'found'){ el.classList.add('ok'); el.textContent = 'Found'; }
  else if(status === 'partial'){ el.classList.add('maybe'); el.textContent = 'Partial'; }
  else { el.textContent = 'Not found'; }
}

function renderMetrics(config){
  els.bdrVal.textContent = state.bdrName || 'Not set';
  els.avgVal.textContent = state.scores.length ? avg(state.scores) + '/100' : '-';
  if(config) els.modelVal.textContent = config.modelConfigured ? config.model : 'Not configured';
}

function renderTranscript(){
  els.transcript.innerHTML = '';
  state.history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = '<strong>' + esc(item.speaker) + '</strong><div>' + esc(item.text) + '</div>';
    els.transcript.appendChild(div);
  });
}

function renderTags(){
  els.metaTags.innerHTML = '';
  if(!state.current) return;
  [state.current.vertical, state.current.persona, state.current.label].forEach(t => {
    const span = document.createElement('span');
    span.className = 'tag';
    span.textContent = t;
    els.metaTags.appendChild(span);
  });
}

async function loadConfig(){
  const r = await fetch('/api/config');
  const data = await r.json();

  data.scenarios.forEach((s, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = s.label + ' — ' + s.vertical;
    els.scenarioSelect.appendChild(opt);
  });

  window.__scenarios = data.scenarios;
  renderMetrics(data);

  if(!state.bdrName) showNameModal();

  // Auto-start first scenario
  if (data.scenarios.length > 0 && state.bdrName) {
    els.scenarioSelect.selectedIndex = 0;
    startScenario();
  }
}

function startScenario(){
  const scenarios = window.__scenarios || [];
  const scenario = scenarios[Number(els.scenarioSelect.value)];
  if(!scenario) return;

  state.current = scenario;
  state.history = [{speaker:'Prospect', text:scenario.opening}];

  els.scenarioVal.textContent = scenario.label;
  els.prospectBox.innerHTML = '<strong>Prospect:</strong> ' + esc(scenario.opening);

  els.feedbackBox.innerHTML = '<div class="watch">Start with discovery.</div>';

  setPill(els.pLocation, 'not found');
  setPill(els.pCause, 'not found');
  setPill(els.pImpact, 'not found');
  setPill(els.pUrgency, 'not found');

  renderTranscript();
  renderTags();
}

async function submitTurn(){
  const response = els.reply.value.trim();
  if(!response) return;

  state.history.push({speaker:'BDR', text:response});
  els.reply.value = '';

  const r = await fetch('/api/respond', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      bdr_name: state.bdrName,
      session_id: state.sessionId,
      scenario: state.current,
      history: state.history,
      bdr_response: response
    })
  });

  const data = await r.json();
  const res = data.result;

  state.history.push({speaker:'Prospect', text:res.prospect_reply});
  state.scores.push(res.score);

  els.scoreVal.textContent = res.score + '/100';
  els.avgVal.textContent = avg(state.scores) + '/100';

  els.prospectBox.innerHTML = '<strong>Prospect:</strong> ' + esc(res.prospect_reply);

  els.feedbackBox.innerHTML = `
    <div><strong>Score:</strong> ${res.score}</div>
    <div class="detected">Type: ${(res.question_type_detected||[]).join(', ')}</div>
  `;

  setPill(els.pLocation, res.discovery_progress.problem_location);
  setPill(els.pCause, res.discovery_progress.likely_cause);
  setPill(els.pImpact, res.discovery_progress.business_impact);
  setPill(els.pUrgency, res.discovery_progress.why_it_matters_now);

  renderTranscript();
}

function showNameModal(){
  els.nameModal.classList.remove('hidden');
}

function saveName(){
  const name = els.nameInput.value.trim();
  if(!name) return;

  state.bdrName = name;
  localStorage.setItem('ci_bdr_name', name);
  els.nameModal.classList.add('hidden');

  // Auto-start after name entered
  startScenario();
}

// EVENTS
els.submitBtn.addEventListener('click', submitTurn);
els.saveNameBtn.addEventListener('click', saveName);

// 🔥 THIS IS THE KEY CHANGE
els.scenarioSelect.addEventListener('change', startScenario);

loadConfig();
