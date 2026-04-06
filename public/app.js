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
function readinessBadge(status){
  if(status === 'ready') return '<span class="detected">Transition readiness: ready</span>';
  if(status === 'almost_ready') return '<span class="detected">Transition readiness: almost ready</span>';
  return '<span class="detected">Transition readiness: not ready</span>';
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
  els.transcript.scrollTop = els.transcript.scrollHeight;
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
  els.feedbackBox.innerHTML = '<div class="watch">Start with discovery. Find the problem, the cause, and the business impact before trying to transition.</div>';

  setPill(els.pLocation, 'not found');
  setPill(els.pCause, 'not found');
  setPill(els.pImpact, 'not found');
  setPill(els.pUrgency, 'not found');

  renderTranscript();
  renderTags();
}
async function submitTurn(){
  if(!state.bdrName){ showNameModal(); return; }
  if(!state.current){ alert('Choose a scenario first.'); return; }
  const response = els.reply.value.trim();
  if(!response) return;
  state.history.push({speaker:'BDR', text:response});
  renderTranscript();
  els.reply.value = '';
  els.feedbackBox.innerHTML = '<div class="watch">AI coach is analyzing the response…</div>';

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
  if(!data.ok){
    els.feedbackBox.innerHTML = '<div class="bad">' + esc(data.error || 'Unknown error') + '</div>';
    return;
  }

  const res = data.result;
  state.history.push({speaker:'Prospect', text:res.prospect_reply});
  state.scores.push(Number(res.score || 0));
  els.scoreVal.textContent = String(res.score || '-') + '/100';
  els.avgVal.textContent = avg(state.scores) + '/100';
  els.prospectBox.innerHTML = '<strong>Prospect:</strong> ' + esc(res.prospect_reply);

  const strengths = (res.strengths || []).map(s => '• ' + esc(s)).join('<br>');
  const weaknesses = (res.weaknesses || []).map(s => '• ' + esc(s)).join('<br>');
  const transitionCoaching = (res.transition_coaching || []).map(s => '• ' + esc(s)).join('<br>');
  const suggestedTransition = esc(res.suggested_transition || '');

  els.feedbackBox.innerHTML = `
    <div><strong>Score:</strong> ${esc(res.score)}</div>
    <div class="detected">Question type detected: ${esc((res.question_type_detected || []).join(' • ') || 'none')}</div>
    ${readinessBadge(res.transition_readiness || 'not_ready')}
    <div class="good" style="margin-top:10px;"><strong>Strengths</strong><br>${strengths || '• None noted'}</div>
    <div class="watch" style="margin-top:10px;"><strong>Weaknesses</strong><br>${weaknesses || '• None noted'}</div>
    <div class="panel" style="margin-top:10px;"><strong>Transition coaching</strong><br>${transitionCoaching || '• Keep discovering before moving to the meeting ask.'}</div>
    <div style="margin-top:10px;"><strong>Better next response</strong><br>${esc(res.better_next_response || '')}</div>
    <div style="margin-top:10px;"><strong>Suggested transition</strong><br>${suggestedTransition || 'Not ready yet — uncover more impact before transitioning.'}</div>
  `;

  const dp = res.discovery_progress || {};
  setPill(els.pLocation, dp.problem_location || 'not found');
  setPill(els.pCause, dp.likely_cause || 'not found');
  setPill(els.pImpact, dp.business_impact || 'not found');
  setPill(els.pUrgency, dp.why_it_matters_now || 'not found');

  if(['found','partial'].includes(dp.problem_location) &&
     ['found','partial'].includes(dp.likely_cause) &&
     ['found','partial'].includes(dp.business_impact)) {
    els.summaryWrap.classList.remove('hidden');
  }

  renderTranscript();
}
async function saveSummary(){
  const text = els.summaryInput.value.trim();
  if(!text || !state.current) return;
  const lower = text.toLowerCase();
  let score = 0;
  if(/issue|problem|challenge|delay|inaccur|visibility|manual|error|integration/.test(lower)) score += 25;
  if(/cause|driv|manual|disconnect|delay|workaround|offline|update|because/.test(lower)) score += 25;
  if(/impact|delay|service|cost|labor|rework|revenue|capital|customer|output|productivity/.test(lower)) score += 35;
  if(/quarter|year|priority|leadership|focus|now|attention|review/.test(lower)) score += 15;

  const feedback = [];
  if(score < 70) feedback.push('Make the cause and impact more explicit.');
  else feedback.push('Strong summary. It is close to sales-ready.');

  els.summaryFeedback.innerHTML = '<div class="good"><strong>Summary score:</strong> ' + score + '/100<br>' + feedback.join('<br>') + '</div>';

  await fetch('/api/log-summary', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      session_id: state.sessionId,
      bdr_name: state.bdrName,
      scenario_label: state.current.label,
      summary_text: text,
      summary_score: score,
      summary_feedback: feedback
    })
  });
}
function showNameModal(){
  els.nameModal.classList.remove('hidden');
  els.nameInput.value = state.bdrName || '';
  els.nameInput.focus();
}
function saveName(){
  const name = els.nameInput.value.trim();
  if(!name) return;
  state.bdrName = name;
  localStorage.setItem('ci_bdr_name', name);
  els.nameModal.classList.add('hidden');
  renderMetrics();
  if (!state.current && window.__scenarios && window.__scenarios.length > 0) {
    startScenario();
  }
}

els.submitBtn.addEventListener('click', submitTurn);
els.summaryBtn.addEventListener('click', ()=> els.summaryWrap.classList.remove('hidden'));
els.evalSummaryBtn.addEventListener('click', saveSummary);
els.restartBtn.addEventListener('click', startScenario);
els.saveNameBtn.addEventListener('click', saveName);
els.scenarioSelect.addEventListener('change', startScenario);
els.reply.addEventListener('keydown', (e)=>{ if((e.ctrlKey||e.metaKey) && e.key==='Enter') submitTurn(); });

loadConfig();
