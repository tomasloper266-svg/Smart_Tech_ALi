/* صوت الحارة — منطق التطبيق */
'use strict';

/* ================= أدوات عامة ================= */
const STORAGE_KEY = 'sawt-alhara-v1';
const $ = (sel) => document.querySelector(sel);
const uid = () => (window.crypto && crypto.randomUUID)
  ? crypto.randomUUID()
  : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function clean(s, max) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').slice(0, max || 100);
}
function fmtDT(ts) {
  try {
    return new Date(ts).toLocaleString('ar-SY-u-nu-latn', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  } catch (e) { return String(ts); }
}

/* ================= التخزين ================= */
function normalizePoll(p) {
  return {
    id: String(p.id || uid()),
    streetName: clean(p.streetName, 100) || 'استطلاع بدون اسم',
    streetNumber: clean(p.streetNumber, 20),
    collectorName: clean(p.collectorName, 60),
    createdAt: Number(p.createdAt) || Date.now(),
    candidates: Array.isArray(p.candidates) ? p.candidates.map((c) => ({
      id: String(c.id || uid()),
      name: clean(c.name, 60) || 'مرشح',
      createdAt: Number(c.createdAt) || Date.now()
    })) : [],
    votes: Array.isArray(p.votes) ? p.votes.filter((v) => p.candidates.some((c) => String(c.id) === String(v.candidateId))).map((v) => ({
      id: String(v.id || uid()),
      candidateId: String(v.candidateId),
      personName: clean(v.personName, 80),
      createdAt: Number(v.createdAt) || Date.now()
    })) : [],
    activity: Array.isArray(p.activity) ? p.activity.slice(0, 500).map((a) => ({
      id: String(a.id || uid()),
      kind: String(a.kind || 'info'),
      text: clean(a.text, 200),
      ts: Number(a.ts) || Date.now()
    })) : []
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { polls: [], activePollId: null };
    const d = JSON.parse(raw);
    return {
      polls: Array.isArray(d.polls) ? d.polls.map(normalizePoll) : [],
      activePollId: d.activePollId || null
    };
  } catch (e) {
    return { polls: [], activePollId: null };
  }
}
let db = load();
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
  catch (e) { toast('تعذر حفظ البيانات محليًا: مساحة التخزين ممتلئة', 'error'); }
}
window.addEventListener('beforeunload', save);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });

const activePoll = () => db.polls.find((p) => p.id === db.activePollId) || null;
const votesOf = (poll, candId) => poll.votes.filter((v) => v.candidateId === candId).length;

/* ================= التنبيهات والنوافذ ================= */
function toast(msg, type, undoVoteId) {
  const box = document.createElement('div');
  box.className = 'toast' + (type ? ' ' + type : '');
  const span = document.createElement('span');
  span.textContent = msg;
  box.appendChild(span);
  if (undoVoteId) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-undo';
    btn.textContent = 'تراجع';
    btn.addEventListener('click', () => {
      box.remove();
      deleteVote(undoVoteId);
    });
    box.appendChild(btn);
  }
  $('#toasts').appendChild(box);
  setTimeout(() => box.remove(), undoVoteId ? 9000 : 3500);
}

let confirmResolve = null;
function confirmDialog(title, message, confirmText) {
  $('#cfTitle').textContent = title;
  $('#cfMessage').textContent = message;
  $('#cfConfirm').textContent = confirmText || 'تأكيد';
  openModal('#confirmModal');
  return new Promise((resolve) => { confirmResolve = resolve; });
}

function openModal(sel) {
  const el = $(sel);
  el.hidden = false;
  const focusable = el.querySelector('input, select, button:not([data-close])');
  if (focusable) focusable.focus();
}
function closeModal(sel) {
  $(sel).hidden = true;
}
document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) {
      backdrop.hidden = true;
      if (backdrop.id === 'confirmModal' && confirmResolve) {
        confirmResolve(false);
        confirmResolve = null;
      }
    }
  });
});
$('#cfConfirm').addEventListener('click', () => {
  $('#confirmModal').hidden = true;
  if (confirmResolve) { confirmResolve(true); confirmResolve = null; }
});

/* ================= سجل النشاط ================= */
function logActivity(poll, kind, text) {
  poll.activity.unshift({ id: uid(), kind, text: clean(text, 200), ts: Date.now() });
  if (poll.activity.length > 500) poll.activity.length = 500;
}
const KIND_LABEL = {
  vote: ['تسجيل صوت', 'add'],
  'vote-undo': ['تراجع عن صوت', 'warn'],
  'vote-edit': ['تعديل صوت', 'warn'],
  'candidate-add': ['إضافة مرشح', 'add'],
  'candidate-edit': ['تعديل مرشح', 'warn'],
  'candidate-delete': ['حذف مرشح', 'bad'],
  'poll-edit': ['تعديل بيانات الاستطلاع', 'warn'],
  reset: ['تصفير الأصوات', 'bad'],
  'poll-delete': ['حذف استطلاع', 'bad'],
  import: ['استيراد نسخة احتياطية', 'warn']
};

/* ================= التنقل ================= */
let currentView = 'dashboard';
const CHART_COLORS = ['#0e7a5f', '#f2b722', '#3f7fbf', '#c6423b', '#7a4fbf', '#2f9e8f', '#d97b29', '#5b4203'];
const charts = {};

function showView(name) {
  const poll = activePoll();
  if (!poll) name = 'start'; // لا استطلاع نشط → شاشة البداية
  currentView = name === 'start' ? 'dashboard' : name;
  document.querySelectorAll('.view').forEach((v) => { v.hidden = true; });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === currentView));
  $('#view-' + name).hidden = false;
  render();
}
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => showView(t.dataset.view));
});

function render() {
  const poll = activePoll();
  // الترويسة والتبويبات
  $('#pollSwitcherWrap').hidden = db.polls.length === 0;
  $('#mainTabs').hidden = !poll;
  const sw = $('#pollSwitcher');
  sw.innerHTML = '';
  db.polls.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.streetName + (p.streetNumber ? ' — ' + p.streetNumber : '');
    opt.selected = p.id === db.activePollId;
    sw.appendChild(opt);
  });
  $('#btnNewPollTop').hidden = !poll;

  if (!poll) { renderStart(); return; }
  if (currentView === 'dashboard') renderDashboard(poll);
  else if (currentView === 'candidates') renderCandidates(poll);
  else if (currentView === 'voters') renderVoters(poll);
  else if (currentView === 'results') renderResults(poll);
  else if (currentView === 'manage') renderManage(poll);
}

/* ================= شاشة البداية ================= */
function renderStart() {
  const has = db.polls.length > 0;
  $('#existingPolls').hidden = !has;
  const wrap = $('#pollCards');
  wrap.innerHTML = '';
  if (!has) return;
  db.polls.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'card poll-card';
    const h = document.createElement('h3');
    h.textContent = p.streetName + (p.streetNumber ? ' — شارع ' + p.streetNumber : '');
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = (p.collectorName ? 'جامع الأصوات: ' + p.collectorName + ' • ' : '')
      + p.votes.length + ' صوت • أُنشئ في ' + fmtDT(p.createdAt);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn btn-primary';
    open.textContent = 'فتح الاستطلاع';
    open.addEventListener('click', () => {
      db.activePollId = p.id;
      save();
      showView('dashboard');
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-ghost';
    del.textContent = 'حذف';
    del.addEventListener('click', async () => {
      const ok = await confirmDialog('حذف الاستطلاع',
        'سيتم حذف استطلاع «' + p.streetName + '» وكل بياناته نهائيًا. هل أنت متأكد؟', 'حذف نهائي');
      if (!ok) return;
      const ok2 = await confirmDialog('تأكيد إضافي', 'لا يمكن التراجع عن هذه العملية. تأكيد الحذف النهائي؟', 'نعم، احذف');
      if (!ok2) return;
      db.polls = db.polls.filter((x) => x.id !== p.id);
      if (db.activePollId === p.id) db.activePollId = null;
      save();
      toast('تم حذف الاستطلاع', 'success');
      render();
    });
    card.appendChild(h);
    card.appendChild(meta);
    card.appendChild(open);
    card.appendChild(del);
    wrap.appendChild(card);
  });
}

$('#createPollForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const streetName = clean($('#fStreetName').value, 100);
  if (!streetName) { toast('اسم الشارع مطلوب', 'error'); return; }
  const poll = normalizePoll({
    streetName,
    streetNumber: clean($('#fStreetNumber').value, 20),
    collectorName: clean($('#fCollector').value, 60),
    createdAt: Date.now(),
    candidates: [], votes: [], activity: []
  });
  db.polls.push(poll);
  db.activePollId = poll.id;
  save();
  $('#fStreetName').value = '';
  $('#fStreetNumber').value = '';
  $('#fCollector').value = '';
  toast('تم إنشاء الاستطلاع. أضف المرشحين وابدأ!', 'success');
  showView('candidates');
});

$('#pollSwitcher').addEventListener('change', (e) => {
  db.activePollId = e.target.value;
  save();
  showView('dashboard');
});
$('#btnNewPollTop').addEventListener('click', () => {
  db.activePollId = null;
  save();
  showView('start');
  window.scrollTo({ top: 0 });
});

/* ================= لوحة التحكم ================= */
function renderDashboard(poll) {
  $('#dStreetName').textContent = poll.streetName;
  const parts = [];
  if (poll.streetNumber) parts.push('رقم الشارع: ' + poll.streetNumber);
  if (poll.collectorName) parts.push('جامع الأصوات: ' + poll.collectorName);
  $('#dStreetMeta').textContent = parts.join(' • ');

  const total = poll.votes.length;
  $('#dTotalVotes').textContent = total;
  $('#dCandidatesCount').textContent = poll.candidates.length;
  $('#dNamedVotes').textContent = poll.votes.filter((v) => v.personName).length;

  const ranked = poll.candidates
    .map((c) => ({ c, n: votesOf(poll, c.id) }))
    .sort((a, b) => b.n - a.n);
  const wrap = $('#dRanking');
  wrap.innerHTML = '';
  if (ranked.length === 0) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'لا يوجد مرشحون بعد. أضف المرشحين من تبويب «المرشحون».';
    wrap.appendChild(note);
  }
  ranked.forEach(({ c, n }, i) => {
    const pct = total > 0 ? Math.round((n / total) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'rank-row';
    const name = document.createElement('div');
    name.className = 'rank-name';
    const medal = document.createElement('span');
    medal.className = 'rank-medal';
    medal.textContent = i + 1;
    const nm = document.createElement('span');
    nm.textContent = c.name;
    name.appendChild(medal);
    name.appendChild(nm);
    const votes = document.createElement('div');
    votes.className = 'rank-votes';
    votes.textContent = n + ' صوت (' + pct + '%)';
    const bar = document.createElement('div');
    bar.className = 'rank-bar';
    const fill = document.createElement('div');
    fill.className = 'rank-fill';
    fill.style.width = (total > 0 ? Math.max(2, pct) : 0) + '%';
    bar.appendChild(fill);
    row.appendChild(name);
    row.appendChild(votes);
    row.appendChild(bar);
    wrap.appendChild(row);
  });

  drawChart('dChart', ranked, total);
}

function drawChart(canvasId, ranked, total) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ranked.map((r) => r.c.name),
      datasets: [{
        label: 'الأصوات',
        data: ranked.map((r) => r.n),
        backgroundColor: ranked.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
        borderRadius: 8
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { rtl: true, textDirection: 'rtl' }
      },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0, callback: (v) => (Number.isInteger(v) ? v : '') } }
      }
    }
  });
}

/* ================= المرشحون ================= */
function renderCandidates(poll) {
  const grid = $('#candidateGrid');
  grid.innerHTML = '';
  if (poll.candidates.length === 0) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.style.gridColumn = '1 / -1';
    note.textContent = 'لا يوجد مرشحون بعد. اضغط «إضافة مرشح» للبدء.';
    grid.appendChild(note);
    return;
  }
  poll.candidates.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'card candidate-card';

    const top = document.createElement('div');
    top.className = 'candidate-top';
    const name = document.createElement('h3');
    name.className = 'candidate-name';
    name.textContent = c.name;
    const actions = document.createElement('div');
    actions.className = 'candidate-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-icon';
    editBtn.textContent = 'تعديل';
    editBtn.addEventListener('click', () => openCandidateModal(c.id));
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-icon danger';
    delBtn.textContent = 'حذف';
    delBtn.addEventListener('click', () => deleteCandidate(c.id));
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    top.appendChild(name);
    top.appendChild(actions);

    const count = document.createElement('div');
    count.className = 'candidate-count';
    count.textContent = votesOf(poll, c.id);
    const countLabel = document.createElement('div');
    countLabel.className = 'candidate-count-label';
    countLabel.textContent = 'صوت مسجل';

    const voteBtn = document.createElement('button');
    voteBtn.type = 'button';
    voteBtn.className = 'btn btn-primary btn-lg';
    voteBtn.textContent = 'تسجيل صوت';
    voteBtn.addEventListener('click', () => openVoteModal(c.id));

    card.appendChild(top);
    card.appendChild(count);
    card.appendChild(countLabel);
    card.appendChild(voteBtn);
    grid.appendChild(card);
  });
}

let editingCandidateId = null;
function openCandidateModal(candId) {
  editingCandidateId = candId || null;
  $('#cmTitle').textContent = candId ? 'تعديل اسم المرشح' : 'إضافة مرشح';
  const poll = activePoll();
  $('#cmName').value = candId ? (poll.candidates.find((c) => c.id === candId) || {}).name || '' : '';
  openModal('#candidateModal');
}
$('#btnAddCandidate').addEventListener('click', () => openCandidateModal(null));
$('#cmSave').addEventListener('click', () => {
  const poll = activePoll();
  if (!poll) return;
  const name = clean($('#cmName').value, 60);
  if (!name) { toast('اسم المرشح مطلوب', 'error'); return; }
  if (editingCandidateId) {
    const c = poll.candidates.find((x) => x.id === editingCandidateId);
    if (c) {
      c.name = name;
      logActivity(poll, 'candidate-edit', 'تعديل اسم المرشح إلى: ' + name);
      toast('تم تعديل اسم المرشح', 'success');
    }
  } else {
    poll.candidates.push({ id: uid(), name, createdAt: Date.now() });
    logActivity(poll, 'candidate-add', 'إضافة المرشح: ' + name);
    toast('تمت إضافة المرشح', 'success');
  }
  save();
  $('#candidateModal').hidden = true;
  render();
});

async function deleteCandidate(candId) {
  const poll = activePoll();
  if (!poll) return;
  const c = poll.candidates.find((x) => x.id === candId);
  if (!c) return;
  const n = votesOf(poll, candId);
  const ok = await confirmDialog('حذف المرشح',
    'سيتم حذف المرشح «' + c.name + '»' + (n > 0 ? ' مع ' + n + ' صوت مسجل له' : '') + '. لا يمكن التراجع. هل أنت متأكد؟', 'حذف المرشح');
  if (!ok) return;
  poll.candidates = poll.candidates.filter((x) => x.id !== candId);
  poll.votes = poll.votes.filter((v) => v.candidateId !== candId);
  logActivity(poll, 'candidate-delete', 'حذف المرشح: ' + c.name + (n > 0 ? ' وحذف أصواته (' + n + ')' : ''));
  save();
  toast('تم حذف المرشح', 'success');
  render();
}

/* ================= تسجيل الأصوات ================= */
let votingCandidateId = null;
function openVoteModal(candId) {
  const poll = activePoll();
  if (!poll) return;
  const c = poll.candidates.find((x) => x.id === candId);
  if (!c) return;
  votingCandidateId = candId;
  $('#vmCandidate').textContent = c.name;
  $('#vmPerson').value = '';
  $('#vmDupHint').hidden = true;
  const btn = $('#vmConfirm');
  btn.disabled = false;
  btn.textContent = 'تأكيد تسجيل الصوت';
  openModal('#voteModal');
}

// تنبيه فوري أثناء الكتابة عند تطابق اسم مسجّل مسبقًا
$('#vmPerson').addEventListener('input', (e) => {
  const poll = activePoll();
  if (!poll) return;
  const val = clean(e.target.value, 80).toLowerCase();
  const hint = $('#vmDupHint');
  if (val && poll.votes.some((v) => v.personName && v.personName.toLowerCase() === val)) {
    hint.textContent = 'تنبيه: يوجد صوت مسجل بهذا الاسم نفسه في هذا الاستطلاع — قد يكون الشخص صوّت سابقًا (قد يكون أيضًا شخصًا آخر يحمل الاسم نفسه).';
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
});

$('#vmConfirm').addEventListener('click', async () => {
  const poll = activePoll();
  if (!poll || !votingCandidateId) return;
  const btn = $('#vmConfirm');
  if (btn.disabled) return; // منع الضغط المتكرر
  btn.disabled = true;

  const personName = clean($('#vmPerson').value, 80);
  const dup = personName && poll.votes.some((v) => v.personName && v.personName.toLowerCase() === personName.toLowerCase());
  if (dup) {
    const ok = await confirmDialog('تنبيه: اسم مسجل مسبقًا',
      'الاسم «' + personName + '» مسجل مسبقًا في هذا الاستطلاع. هل تم تسجيل صوت هذا الشخص سابقًا؟ يمكنك المتابعة إن كان شخصًا آخر يحمل الاسم نفسه.', 'متابعة التسجيل');
    if (!ok) {
      btn.disabled = false;
      return;
    }
  }
  const cand = poll.candidates.find((x) => x.id === votingCandidateId);
  const vote = { id: uid(), candidateId: votingCandidateId, personName, createdAt: Date.now() };
  poll.votes.push(vote);
  logActivity(poll, 'vote', 'تسجيل صوت لمرشح «' + (cand ? cand.name : '؟') + '»' + (personName ? ' باسم: ' + personName : ' بدون اسم'));
  save();
  $('#voteModal').hidden = true;
  render();
  toast('تم تسجيل الصوت لـ ' + (cand ? cand.name : ''), 'success', vote.id);
});

async function deleteVote(voteId) {
  const poll = activePoll();
  if (!poll) return;
  const v = poll.votes.find((x) => x.id === voteId);
  if (!v) return;
  const cand = poll.candidates.find((x) => x.id === v.candidateId);
  const ok = await confirmDialog('التراجع عن تسجيل صوت',
    'سيتم حذف صوت' + (v.personName ? ' «' + v.personName + '»' : '') + (cand ? ' المسجل للمرشح «' + cand.name + '»' : '') + '. هل أنت متأكد؟', 'نعم، تراجع');
  if (!ok) return;
  poll.votes = poll.votes.filter((x) => x.id !== voteId);
  logActivity(poll, 'vote-undo', 'تراجع عن صوت' + (cand ? ' للمرشح «' + cand.name + '»' : '') + (v.personName ? ' (الاسم: ' + v.personName + ')' : ''));
  save();
  toast('تم التراجع عن تسجيل الصوت', 'success');
  render();
}

/* ================= سجل المصوتين ================= */
$('#vSearch').addEventListener('input', () => renderVoters(activePoll()));

function renderVoters(poll) {
  if (!poll) return;
  const named = poll.votes.filter((v) => v.personName);
  $('#vTotalNames').textContent = named.length + ' اسم مسجل';
  const q = clean($('#vSearch').value, 80).toLowerCase();
  const rows = named
    .filter((v) => !q || v.personName.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);
  const body = $('#votersBody');
  body.innerHTML = '';
  $('#votersEmpty').hidden = named.length > 0;
  rows.forEach((v) => {
    const cand = poll.candidates.find((c) => c.id === v.candidateId);
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = v.personName;
    const tdCand = document.createElement('td');
    tdCand.textContent = cand ? cand.name : '—';
    const tdTime = document.createElement('td');
    tdTime.textContent = fmtDT(v.createdAt);
    const tdAct = document.createElement('td');
    tdAct.className = 'actions-cell';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-icon';
    editBtn.textContent = 'تعديل';
    editBtn.addEventListener('click', () => openVoterEditModal(v.id));
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-icon danger';
    delBtn.textContent = 'حذف';
    delBtn.addEventListener('click', () => deleteVote(v.id));
    tdAct.appendChild(editBtn);
    tdAct.appendChild(delBtn);
    tr.appendChild(tdName);
    tr.appendChild(tdCand);
    tr.appendChild(tdTime);
    tr.appendChild(tdAct);
    body.appendChild(tr);
  });
  if (rows.length === 0 && named.length > 0) {
    $('#votersEmpty').textContent = 'لا نتائج مطابقة للبحث.';
    $('#votersEmpty').hidden = false;
  } else if (named.length === 0) {
    $('#votersEmpty').textContent = 'لا توجد أسماء مسجلة بعد.';
  }
}

let editingVoteId = null;
function openVoterEditModal(voteId) {
  const poll = activePoll();
  if (!poll) return;
  const v = poll.votes.find((x) => x.id === voteId);
  if (!v) return;
  editingVoteId = voteId;
  $('#vemPerson').value = v.personName;
  const sel = $('#vemCandidate');
  sel.innerHTML = '';
  poll.candidates.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    opt.selected = c.id === v.candidateId;
    sel.appendChild(opt);
  });
  openModal('#voterEditModal');
}
$('#vemSave').addEventListener('click', () => {
  const poll = activePoll();
  if (!poll || !editingVoteId) return;
  const v = poll.votes.find((x) => x.id === editingVoteId);
  if (!v) return;
  const newName = clean($('#vemPerson').value, 80);
  const newCandId = $('#vemCandidate').value;
  if (!newName) { toast('اسم الشخص مطلوب (لحذف التسجيل استخدم زر الحذف)', 'error'); return; }
  const oldCand = poll.candidates.find((c) => c.id === v.candidateId);
  const newCand = poll.candidates.find((c) => c.id === newCandId);
  v.personName = newName;
  v.candidateId = newCandId;
  logActivity(poll, 'vote-edit', 'تعديل تسجيل صوت إلى: ' + newName + ' للمرشح «' + (newCand ? newCand.name : '؟') + '»');
  save();
  $('#voterEditModal').hidden = true;
  toast('تم تعديل بيانات التسجيل', 'success');
  render();
});

/* ================= النتائج والتصدير ================= */
function renderResults(poll) {
  const total = poll.votes.length;
  const ranked = poll.candidates
    .map((c) => ({ c, n: votesOf(poll, c.id) }))
    .sort((a, b) => b.n - a.n);
  $('#rMeta').innerHTML = '';
  const meta = [
    ['اسم الشارع', poll.streetName],
    ['رقم الشارع', poll.streetNumber || '—'],
    ['جامع الأصوات', poll.collectorName || '—'],
    ['تاريخ إعداد التقرير', fmtDT(Date.now())]
  ];
  meta.forEach(([k, v]) => {
    const span = document.createElement('span');
    const kd = document.createElement('span');
    kd.textContent = k + ': ';
    const strong = document.createElement('strong');
    strong.textContent = v;
    span.appendChild(kd);
    span.appendChild(strong);
    $('#rMeta').appendChild(span);
  });
  const body = $('#rBody');
  body.innerHTML = '';
  if (ranked.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 3;
    td.className = 'empty-note';
    td.textContent = 'لا يوجد مرشحون بعد.';
    tr.appendChild(td);
    body.appendChild(tr);
  }
  ranked.forEach(({ c, n }) => {
    const pct = total > 0 ? Math.round((n / total) * 100) : 0;
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = c.name;
    const td2 = document.createElement('td');
    td2.textContent = n;
    const td3 = document.createElement('td');
    td3.textContent = pct + '%';
    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
    body.appendChild(tr);
  });
  $('#rTotal').textContent = total;
  drawChart('rChart', ranked, total);
}

function fileSafeName(poll, ext) {
  const base = ('نتائج-' + poll.streetName + (poll.streetNumber ? '-شارع-' + poll.streetNumber : ''))
    .replace(/[\\/:*?"<>|]/g, '-').trim();
  return base + '.' + ext;
}

$('#btnExportPdf').addEventListener('click', async () => {
  const poll = activePoll();
  if (!poll) return;
  const btn = $('#btnExportPdf');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'جارٍ التحضير…';
  try {
    // إعادة رسم التقرير بأحدث البيانات ثم تحويله إلى صورة (يدعم العربية وRTL)
    renderResults(poll);
    const card = $('#reportCard');
    const canvas = await html2canvas(card, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW - 10;
    const imgH = (canvas.height * imgW) / canvas.width;
    let remaining = imgH;
    let position = 5;
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 5, position, imgW, imgH);
    remaining -= (pageH - 10);
    while (remaining > 0) {
      pdf.addPage();
      position = position - (pageH - 10);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 5, position, imgW, imgH);
      remaining -= (pageH - 10);
    }
    pdf.save(fileSafeName(poll, 'pdf'));
    toast('تم تنزيل ملف PDF', 'success');
  } catch (e) {
    toast('تعذر إنشاء ملف PDF — تأكد من اتصال الإنترنت لتحميل المكتبات', 'error');
  }
  btn.disabled = false;
  btn.textContent = 'تصدير PDF';
});

$('#btnExportExcel').addEventListener('click', () => {
  const poll = activePoll();
  if (!poll) return;
  const total = poll.votes.length;
  const ranked = poll.candidates
    .map((c) => ({ c, n: votesOf(poll, c.id) }))
    .sort((a, b) => b.n - a.n);
  const rows = [
    ['نتائج استطلاع آراء سكان الحارة'],
    ['اسم الشارع', poll.streetName],
    ['رقم الشارع', poll.streetNumber || '—'],
    ['جامع الأصوات', poll.collectorName || '—'],
    ['تاريخ إعداد التقرير', fmtDT(Date.now())],
    [],
    ['المرشح', 'عدد الأصوات', 'النسبة المئوية']
  ];
  ranked.forEach(({ c, n }) => {
    rows.push([c.name, n, (total > 0 ? Math.round((n / total) * 100) : 0) + '%']);
  });
  rows.push(['مجموع الأصوات', total, total > 0 ? '100%' : '0%']);

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(rows);
  ws1['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'النتائج');

  const named = poll.votes.filter((v) => v.personName)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (named.length > 0) {
    const rows2 = [['اسم الشخص', 'المرشح', 'التاريخ والوقت']];
    named.forEach((v) => {
      const cand = poll.candidates.find((c) => c.id === v.candidateId);
      rows2.push([v.personName, cand ? cand.name : '—', fmtDT(v.createdAt)]);
    });
    const ws2 = XLSX.utils.aoa_to_sheet(rows2);
    ws2['!cols'] = [{ wch: 30 }, { wch: 30 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'الأشخاص المسجلون');
  }
  XLSX.writeFile(wb, fileSafeName(poll, 'xlsx'));
  toast('تم تنزيل ملف Excel', 'success');
});

// رسالة واتساب بالصيغة المطلوبة حرفيًا
$('#btnShareWhatsapp').addEventListener('click', () => {
  const poll = activePoll();
  if (!poll) return;
  const total = poll.votes.length;
  const ranked = poll.candidates
    .map((c) => ({ c, n: votesOf(poll, c.id) }))
    .sort((a, b) => b.n - a.n);
  const lines = [
    'اسم الشارع: ' + poll.streetName,
    'رقم الشارع: ' + (poll.streetNumber || '—'),
    'جامع الأصوات: ' + (poll.collectorName || '—'),
    'المرشح الأصوات'
  ];
  ranked.forEach(({ c, n }) => lines.push(c.name + ' ' + n));
  lines.push('مجموع الأصوات: ' + total);
  const text = lines.join('\n');
  $('#whatsappHint').hidden = false;
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
});

/* ================= إدارة الاستطلاع ================= */
function renderManage(poll) {
  $('#eStreetName').value = poll.streetName;
  $('#eStreetNumber').value = poll.streetNumber;
  $('#eCollector').value = poll.collectorName;
  $('#mCreatedAt').textContent = fmtDT(poll.createdAt);

  const list = $('#activityList');
  list.innerHTML = '';
  $('#activityEmpty').hidden = poll.activity.length > 0;
  poll.activity.forEach((a) => {
    const li = document.createElement('li');
    const kind = document.createElement('span');
    kind.className = 'act-type ' + ((KIND_LABEL[a.kind] || ['', 'add'])[1]);
    kind.textContent = KIND_LABEL[a.kind] ? KIND_LABEL[a.kind][0] : a.kind;
    const text = document.createElement('span');
    text.textContent = a.text;
    const time = document.createElement('time');
    time.textContent = fmtDT(a.ts);
    li.appendChild(kind);
    li.appendChild(text);
    li.appendChild(time);
    list.appendChild(li);
  });
}

$('#btnEditPollInfo').addEventListener('click', () => showView('manage'));

$('#editPollForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const poll = activePoll();
  if (!poll) return;
  const streetName = clean($('#eStreetName').value, 100);
  if (!streetName) { toast('اسم الشارع مطلوب', 'error'); return; }
  poll.streetName = streetName;
  poll.streetNumber = clean($('#eStreetNumber').value, 20);
  poll.collectorName = clean($('#eCollector').value, 60);
  logActivity(poll, 'poll-edit', 'تعديل بيانات الاستطلاع: ' + poll.streetName + (poll.streetNumber ? ' — ' + poll.streetNumber : ''));
  save();
  toast('تم حفظ التعديلات', 'success');
  render();
});

$('#btnResetVotes').addEventListener('click', async () => {
  const poll = activePoll();
  if (!poll) return;
  if (poll.votes.length === 0) { toast('لا توجد أصوات لتصفيرها', 'error'); return; }
  const ok = await confirmDialog('تصفير الأصوات',
    'سيتم حذف جميع الأصوات المسجلة (' + poll.votes.length + ' صوت) مع الإبقاء على المرشحين وبيانات الشارع. لا يمكن التراجع. هل أنت متأكد؟', 'تصفير الأصوات');
  if (!ok) return;
  const ok2 = await confirmDialog('تأكيد إضافي', 'تأكيد تصفير كل الأصوات؟', 'نعم، صفّر');
  if (!ok2) return;
  poll.votes = [];
  logActivity(poll, 'reset', 'تصفير جميع الأصوات');
  save();
  toast('تم تصفير الأصوات', 'success');
  render();
});

$('#btnDeletePoll').addEventListener('click', async () => {
  const poll = activePoll();
  if (!poll) return;
  const ok = await confirmDialog('حذف الاستطلاع بالكامل',
    'سيتم حذف استطلاع «' + poll.streetName + '» مع كل المرشحين والأصوات والسجلات نهائيًا.', 'حذف نهائي');
  if (!ok) return;
  const ok2 = await confirmDialog('تأكيد إضافي',
    'هذه العملية لا يمكن التراجع عنها. يُنصح بتصدير نسخة احتياطية أولاً. تأكيد الحذف النهائي؟', 'نعم، احذف نهائيًا');
  if (!ok2) return;
  db.polls = db.polls.filter((x) => x.id !== poll.id);
  db.activePollId = null;
  save();
  toast('تم حذف الاستطلاع بالكامل', 'success');
  showView('dashboard');
});

$('#btnExportJson').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'sawt-alhara', version: 1, exportedAt: Date.now(), polls: db.polls }, null, 2)],
    { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sawt-alhara-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('تم تنزيل النسخة الاحتياطية', 'success');
});

$('#importJsonInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const incoming = Array.isArray(data.polls) ? data.polls.map(normalizePoll) : [normalizePoll(data)];
    if (incoming.length === 0) { toast('الملف لا يحتوي استطلاعات صالحة', 'error'); return; }
    const conflicting = incoming.filter((p) => db.polls.some((x) => x.id === p.id)).length;
    const msg = 'سيتم استيراد ' + incoming.length + ' استطلاع' + (conflicting > 0 ? ' (منها ' + conflicting + ' سيستبدل نسخة موجودة بنفس المعرف)' : '')
      + '. استطلاعاتك الحالية الأخرى لن تُحذف. متابعة؟';
    const ok = await confirmDialog('استيراد نسخة احتياطية', msg, 'استيراد');
    if (!ok) return;
    incoming.forEach((p) => {
      const idx = db.polls.findIndex((x) => x.id === p.id);
      if (idx >= 0) db.polls[idx] = p;
      else db.polls.push(p);
    });
    db.activePollId = incoming[0].id;
    const first = activePoll();
    if (first) logActivity(first, 'import', 'استيراد نسخة احتياطية (' + incoming.length + ' استطلاع)');
    save();
    toast('تم استيراد البيانات بنجاح', 'success');
    showView('dashboard');
  } catch (err) {
    toast('ملف غير صالح — تأكد أنه نسخة احتياطية من «صوت الحارة»', 'error');
  }
});

/* ================= الإقلاع ================= */
showView(currentView);
