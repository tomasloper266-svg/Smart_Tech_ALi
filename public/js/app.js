/* صوت الحارة — منطق التطبيق (خادم مشترك) */
'use strict';

/* ================= أدوات عامة ================= */
const $ = (sel) => document.querySelector(sel);
const credsStore = 'sawt-alhara-login';
const recentStore = 'sawt-alhara-recent';

let creds = null; // { streetNumber, username }
let poll = null;  // الاستطلاع الحالي من الخادم
let currentView = 'dashboard';
const charts = {};

/* عنوان الخادم المشترك: نفس الأصل عند التشغيل من الخادم نفسه،
   وعنوان بعيد عندما تُنشر الواجهة على GitHub Pages أو تُفتح كملف */
const API_BASE = (location.hostname.indexOf('github.io') !== -1 || location.protocol === 'file:')
  ? 'https://0ym9ir41kl-8091.hosted.obvious.ai'
  : '';
/* الرابط الأساسي للتطبيق (المشترَك عبر واتساب) */
const APP_LINK = 'https://tomasloper266-svg.github.io/Smart_Tech_ALi/';

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

/* ================= الاتصال بالخادم ================= */
async function api(route, extra) {
  const body = Object.assign({}, creds, extra || {});
  let res;
  try {
    res = await fetch(API_BASE + '/api/' + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    toast('تعذّر الاتصال بالخادم — تحقق من الإنترنت', 'error');
    throw e;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    if (res.status === 401) { logout(); }
    toast(json.error || 'حدث خطأ غير متوقع', 'error');
    throw new Error(json.error || res.status);
  }
  if (json.poll) { poll = json.poll; }
  return json;
}

/* ================= الحفظ المحلي (تذكّر الدخول) ================= */
function saveLogin() {
  try { localStorage.setItem(credsStore, JSON.stringify(creds)); } catch (e) {}
}
function loadLogin() {
  try {
    const v = JSON.parse(localStorage.getItem(credsStore) || 'null');
    return (v && v.streetNumber && v.username) ? v : null;
  } catch (e) { return null; }
}
function clearLogin() {
  try { localStorage.removeItem(credsStore); } catch (e) {}
}
function pushRecent(c) {
  try {
    let list = JSON.parse(localStorage.getItem(recentStore) || '[]');
    list = list.filter((x) => !(x.streetNumber === c.streetNumber && x.username === c.username));
    list.unshift({ streetNumber: c.streetNumber, username: c.username, streetName: poll ? poll.streetName : c.streetName });
    if (list.length > 6) list.length = 6;
    localStorage.setItem(recentStore, JSON.stringify(list));
  } catch (e) {}
}
function getRecent() {
  try { return JSON.parse(localStorage.getItem(recentStore) || '[]'); } catch (e) { return []; }
}

/* ================= التنبيهات ================= */
function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' toast-' + kind : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.remove(); }, 3200);
}

/* ================= نافذة التأكيد ================= */
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

/* ================= التنقل بين الشاشات ================= */
function showView(name) {
  if (!poll) name = 'login';
  currentView = name === 'login' ? 'dashboard' : name;
  document.querySelectorAll('.view').forEach((v) => { v.hidden = true; });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === currentView));
  $('#view-' + name).hidden = false;
  render();
}
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => showView(t.dataset.view));
});

/* ================= الدخول والخروج ================= */
function enterPoll(p) {
  poll = p;
  creds = { streetNumber: p.streetNumber, username: p.username };
  saveLogin();
  pushRecent(creds);
  $('#userChip').hidden = false;
  $('#mainTabs').hidden = false;
  $('#ucStreet').textContent = 'شارع ' + p.streetNumber;
  $('#ucUser').textContent = 'المستخدم: ' + p.username;
  showView('dashboard');
}
function logout() {
  clearLogin();
  creds = null;
  poll = null;
  $('#userChip').hidden = true;
  $('#mainTabs').hidden = true;
  showView('login');
}
function renderRecent() {
  const list = getRecent();
  $('#recentLogins').hidden = list.length === 0;
  const wrap = $('#recentCards');
  wrap.innerHTML = '';
  list.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'card poll-card';
    const info = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = c.streetName || ('شارع ' + c.streetNumber);
    const span = document.createElement('span');
    span.className = 'muted small';
    span.textContent = 'شارع ' + c.streetNumber + ' — ' + c.username;
    info.appendChild(strong);
    info.appendChild(document.createElement('br'));
    info.appendChild(span);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn btn-primary';
    open.textContent = 'دخول';
    open.addEventListener('click', async () => {
      const r = await api('login', { streetNumber: c.streetNumber, username: c.username }).catch(() => null);
      if (r) enterPoll(r.poll);
    });
    card.appendChild(info);
    card.appendChild(open);
    wrap.appendChild(card);
  });
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const streetNumber = clean($('#fStreetNumber').value, 20);
  const username = clean($('#fUsername').value, 60);
  if (!streetNumber || !username) { toast('أدخل رقم الشارع واسم المستخدم', 'error'); return; }
  const btn = $('#loginForm button[type="submit"]');
  btn.disabled = true;
  try {
    const r = await api('login', { streetNumber, username });
    $('#fStreetNumber').value = '';
    $('#fUsername').value = '';
    enterPoll(r.poll);
    toast('أهلًا بك — شارع ' + streetNumber, 'success');
  } finally {
    btn.disabled = false;
  }
});

$('#btnLogout').addEventListener('click', logout);

/* ================= مشاركة معلومات الدخول ================= */
function loginShareText() {
  return 'فوت معي على الشارع ' + poll.streetNumber + '\n' +
    'رقم الشارع: ' + poll.streetNumber + '\n' +
    'اسم المستخدم: ' + poll.username + '\n' +
    'افتح التطبيق وسجّل الدخول بنفس المعلومات وستجد نفس الاستطلاع:\n' + APP_LINK;
}
function openLoginShare() {
  const url = 'https://wa.me/?text=' + encodeURIComponent(loginShareText());
  window.open(url, '_blank');
}
$('#btnShareLogin').addEventListener('click', openLoginShare);
$('#btnShareLogin2').addEventListener('click', openLoginShare);

/* ================= العرض ================= */
function votesOf(candId) { return poll.votes.filter((v) => v.candidateId === candId).length; }

function render() {
  if (!poll) return;
  renderHeader();
  renderDashboard();
  renderCandidates();
  renderVoters();
  renderResults();
  renderManage();
}

function renderHeader() {
  $('#dStreetName').textContent = poll.streetName;
  $('#dStreetMeta').textContent = 'رقم الشارع: ' + poll.streetNumber + ' — جامع الأصوات: ' + poll.username + ' — أُنشئ في ' + fmtDT(poll.createdAt);
}

function renderDashboard() {
  $('#dTotalVotes').textContent = poll.votes.length;
  $('#dCandidatesCount').textContent = poll.candidates.length;
  $('#dNamedVotes').textContent = poll.votes.filter((v) => v.personName).length;

  // بطاقات التصويت السريع
  const grid = $('#voteGrid');
  grid.innerHTML = '';
  poll.candidates.forEach((c) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-vote';
    btn.innerHTML = '<span class="vote-name"></span><span class="vote-count"></span>';
    btn.querySelector('.vote-name').textContent = c.name;
    btn.querySelector('.vote-count').textContent = votesOf(c.id) + ' صوت';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api('vote', { candidateId: c.id });
        toast('تم تسجيل صوت لـ «' + c.name + '»', 'success');
      } finally { btn.disabled = false; }
    });
    grid.appendChild(btn);
  });
  if (!poll.candidates.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'لا يوجد مرشحون بعد — أضفهم من تبويب «المرشحون».';
    grid.appendChild(p);
  }

  // زر التراجع
  const last = poll.votes[poll.votes.length - 1];
  $('#btnUndoLast').hidden = !last;

  // الترتيب
  const rank = $('#dRanking');
  rank.innerHTML = '';
  const ranked = poll.candidates.map((c) => ({ c, n: votesOf(c.id) })).sort((a, b) => b.n - a.n);
  ranked.forEach(({ c, n }) => {
    const pct = poll.votes.length ? Math.round(n * 100 / poll.votes.length) : 0;
    const row = document.createElement('div');
    row.className = 'rank-row';
    row.innerHTML = '<span class="rank-name"></span><div class="rank-bar"><div class="rank-fill"></div></div><span class="rank-count"></span>';
    row.querySelector('.rank-name').textContent = c.name;
    row.querySelector('.rank-fill').style.width = pct + '%';
    row.querySelector('.rank-count').textContent = n + ' صوت (' + pct + '%)';
    rank.appendChild(row);
  });
  if (!ranked.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'أضف مرشحين لعرض الترتيب.';
    rank.appendChild(p);
  }

  drawChart('dChart', ranked);
}

function renderCandidates() {
  const grid = $('#candidateGrid');
  grid.innerHTML = '';
  poll.candidates.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'card candidate-card';
    const top = document.createElement('div');
    top.className = 'candidate-top';
    const h = document.createElement('h3');
    h.textContent = c.name;
    const count = document.createElement('span');
    count.className = 'pill';
    count.textContent = votesOf(c.id) + ' صوت';
    top.appendChild(h);
    top.appendChild(count);
    const actions = document.createElement('div');
    actions.className = 'candidate-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn-secondary btn-sm';
    edit.textContent = 'تعديل';
    edit.addEventListener('click', () => openCandidateModal(c));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-danger btn-sm';
    del.textContent = 'حذف';
    del.addEventListener('click', async () => {
      const n = votesOf(c.id);
      const ok = await confirmDialog('حذف المرشح',
        'سيُحذف «' + c.name + '»' + (n ? ' وكل أصواته (' + n + ' صوتًا)' : '') + '. هل أنت متأكد؟',
        'نعم، احذف');
      if (!ok) return;
      await api('candidate-delete', { candidateId: c.id });
      toast('تم حذف المرشح', 'success');
      render();
    });
    actions.appendChild(edit);
    actions.appendChild(del);
    card.appendChild(top);
    card.appendChild(actions);
    grid.appendChild(card);
  });
  if (!poll.candidates.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'لا يوجد مرشحون بعد — أضف أول مرشح بالزر بالأعلى.';
    grid.appendChild(p);
  }
}

/* المرشح: إضافة/تعديل */
let editingCandidateId = null;
function openCandidateModal(c) {
  editingCandidateId = c ? c.id : null;
  $('#cmTitle').textContent = c ? 'تعديل مرشح' : 'إضافة مرشح';
  $('#cmName').value = c ? c.name : '';
  openModal('#candidateModal');
}
$('#btnAddCandidate').addEventListener('click', () => openCandidateModal(null));
$('#cmSave').addEventListener('click', async () => {
  const name = clean($('#cmName').value, 60);
  if (!name) { toast('اسم المرشح مطلوب', 'error'); return; }
  if (editingCandidateId) await api('candidate-update', { candidateId: editingCandidateId, name });
  else await api('candidate-add', { name });
  $('#candidateModal').hidden = true;
  toast(editingCandidateId ? 'تم تعديل المرشح' : 'تمت إضافة المرشح', 'success');
  render();
});

/* سجل المصوتين */
function renderVoters() {
  const q = clean($('#vSearch').value, 80).toLowerCase();
  const body = $('#votersBody');
  body.innerHTML = '';
  const rows = poll.votes.filter((v) => {
    if (!q) return true;
    if (v.personName && v.personName.toLowerCase().includes(q)) return true;
    const c = poll.candidates.find((x) => x.id === v.candidateId);
    return c && c.name.toLowerCase().includes(q);
  });
  rows.forEach((v) => {
    const c = poll.candidates.find((x) => x.id === v.candidateId);
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = v.personName || 'بدون اسم';
    if (!v.personName) tdName.className = 'muted';
    const tdCand = document.createElement('td');
    tdCand.textContent = c ? c.name : '—';
    const tdDate = document.createElement('td');
    tdDate.className = 'muted small';
    tdDate.textContent = fmtDT(v.createdAt);
    const tdAct = document.createElement('td');
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn-secondary btn-sm';
    edit.textContent = 'تعديل';
    edit.addEventListener('click', () => openVoterEditModal(v.id));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-danger btn-sm';
    del.textContent = 'حذف';
    del.addEventListener('click', async () => {
      const ok = await confirmDialog('حذف التسجيل', 'حذف صوت ' + (v.personName ? '«' + v.personName + '»' : 'بدون اسم') + '؟', 'نعم، احذف');
      if (!ok) return;
      await api('vote-delete', { voteId: v.id });
      toast('تم حذف التسجيل', 'success');
      render();
    });
    tdAct.appendChild(edit);
    tdAct.appendChild(del);
    tr.appendChild(tdName);
    tr.appendChild(tdCand);
    tr.appendChild(tdDate);
    tr.appendChild(tdAct);
    body.appendChild(tr);
  });
  $('#votersEmpty').hidden = rows.length > 0;
  if (!rows.length) $('#votersEmpty').textContent = poll.votes.length ? 'لا نتائج مطابقة للبحث.' : 'لا توجد أصوات مسجلة بعد.';
  const named = poll.votes.filter((v) => v.personName).length;
  $('#vTotalNames').textContent = named + ' اسم مسجل';
}
$('#vSearch').addEventListener('input', renderVoters);

/* تعديل تسجيل: إضافة اسم لاحقًا أو تغيير المرشح */
let editingVoteId = null;
function openVoterEditModal(voteId) {
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
$('#vemSave').addEventListener('click', async () => {
  const newName = clean($('#vemPerson').value, 80);
  const newCandId = $('#vemCandidate').value;
  if (!newName) { toast('اسم الشخص مطلوب (لحذف التسجيل استخدم زر الحذف)', 'error'); return; }
  await api('vote-update', { voteId: editingVoteId, personName: newName, candidateId: newCandId });
  $('#voterEditModal').hidden = true;
  toast('تم تعديل بيانات التسجيل', 'success');
  render();
});

/* التراجع عن آخر صوت */
$('#btnUndoLast').addEventListener('click', async () => {
  const last = poll.votes[poll.votes.length - 1];
  if (!last) return;
  const c = poll.candidates.find((x) => x.id === last.candidateId);
  const ok = await confirmDialog('التراجع عن آخر صوت',
    'حذف آخر صوت مسجل' + (c ? ' لـ «' + c.name + '»' : '') + (last.personName ? ' — ' + last.personName : '') + '؟',
    'نعم، تراجع');
  if (!ok) return;
  await api('vote-delete', { voteId: last.id });
  toast('تم التراجع عن الصوت', 'success');
  render();
});

/* ================= النتائج والتصدير ================= */
function renderResults() {
  const total = poll.votes.length;
  const ranked = poll.candidates.map((c) => ({ c, n: votesOf(c.id) })).sort((a, b) => b.n - a.n);

  $('#rMeta').innerHTML = '';
  const meta = [
    ['اسم الشارع', poll.streetName],
    ['رقم الشارع', poll.streetNumber],
    ['جامع الأصوات', poll.username],
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
  ranked.forEach(({ c, n }) => {
    const pct = total ? (n * 100 / total).toFixed(1) : '0.0';
    const tr = document.createElement('tr');
    const tdN = document.createElement('td');
    tdN.textContent = c.name;
    const tdV = document.createElement('td');
    tdV.textContent = n;
    const tdP = document.createElement('td');
    tdP.textContent = pct + '%';
    tr.appendChild(tdN); tr.appendChild(tdV); tr.appendChild(tdP);
    body.appendChild(tr);
  });
  $('#rTotal').textContent = total;

  drawChart('rChart', ranked);
}

function drawChart(canvasId, ranked) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ranked.map((r) => r.c.name),
      datasets: [{
        label: 'عدد الأصوات',
        data: ranked.map((r) => r.n),
        backgroundColor: '#0e7a5f'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } }
    }
  });
}

/* واتساب للنتائج */
$('#btnShareWhatsapp').addEventListener('click', () => {
  const total = poll.votes.length;
  const ranked = poll.candidates.map((c) => ({ c, n: votesOf(c.id) })).sort((a, b) => b.n - a.n);
  let msg = 'نتائج استطلاع آراء سكان الحارة\n' +
    'اسم الشارع: ' + poll.streetName + '\n' +
    'رقم الشارع: ' + poll.streetNumber + '\n' +
    'جامع الأصوات: ' + poll.username + '\n\n' +
    'المرشح الأصوات\n';
  ranked.forEach(({ c, n }) => { msg += c.name + ' ' + n + '\n'; });
  msg += '\nمجموع الأصوات ' + total;
  const url = 'https://wa.me/?text=' + encodeURIComponent(msg);
  window.open(url, '_blank');
});

/* ================= إدارة الاستطلاع ================= */
function renderManage() {
  $('#eStreetName').value = poll.streetName;
  $('#mStreetNumber').textContent = poll.streetNumber;
  $('#mUsername').textContent = poll.username;
  $('#mCreatedAt').textContent = fmtDT(poll.createdAt);

  const KIND_LABEL = {
    vote: 'تسجيل صوت', 'vote-undo': 'تراجع عن صوت', 'vote-edit': 'تعديل صوت',
    'candidate-add': 'إضافة مرشح', 'candidate-edit': 'تعديل مرشح', 'candidate-delete': 'حذف مرشح',
    'poll-edit': 'تعديل بيانات الاستطلاع', reset: 'تصفير الأصوات', 'poll-delete': 'حذف استطلاع',
    import: 'استيراد نسخة احتياطية', info: 'معلومة'
  };
  const list = $('#activityList');
  list.innerHTML = '';
  $('#activityEmpty').hidden = poll.activity.length > 0;
  poll.activity.forEach((a) => {
    const li = document.createElement('li');
    const kind = document.createElement('span');
    kind.className = 'act-type ' + (a.kind === 'vote' ? 'add' : (a.kind === 'info' ? '' : 'warn'));
    kind.textContent = KIND_LABEL[a.kind] || a.kind;
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
$('#editPollForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const streetName = clean($('#eStreetName').value, 100);
  if (!streetName) { toast('اسم الشارع مطلوب', 'error'); return; }
  await api('poll-update', { streetName });
  toast('تم حفظ التعديلات', 'success');
  render();
});

$('#btnResetVotes').addEventListener('click', async () => {
  const ok = await confirmDialog('تصفير الأصوات',
    'سيُحذف كل الأصوات المسجلة (' + poll.votes.length + ' صوتًا). المرشحون يبقون. متابعة؟', 'نعم، صفّر');
  if (!ok) return;
  const ok2 = await confirmDialog('تأكيد إضافي', 'تأكيد تصفير كل الأصوات؟', 'نعم، صفّر');
  if (!ok2) return;
  await api('reset');
  toast('تم تصفير الأصوات', 'success');
  render();
});

$('#btnDeletePoll').addEventListener('click', async () => {
  const ok = await confirmDialog('حذف الاستطلاع',
    'سيُحذف الاستطلاع وكل بياناته نهائيًا لكل المستخدمين المتصلين به. متابعة؟', 'نعم، احذف');
  if (!ok) return;
  const ok2 = await confirmDialog('تأكيد إضافي', 'لا يمكن التراجع عن هذه العملية. تأكيد الحذف النهائي؟', 'نعم، احذف');
  if (!ok2) return;
  await api('delete-poll');
  toast('تم حذف الاستطلاع بالكامل', 'success');
  logout();
});

/* ================= الإقلاع ================= */
(async function init() {
  renderRecent();
  const saved = loadLogin();
  if (saved) {
    creds = saved;
    try {
      const r = await api('login', saved);
      enterPoll(r.poll);
      return;
    } catch (e) { /* فشل الدخول التلقائي → شاشة الدخول */ }
  }
  showView('login');
})();
