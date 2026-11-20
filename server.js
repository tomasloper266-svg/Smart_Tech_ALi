/* صوت الحارة — خادم مشترك (Node.js بدون أي اعتماديات خارجية)
 * البيانات تُحفظ في ملف JSON مشترك، فكل الأجهزة التي تسجّل الدخول بنفس
 * (رقم الشارع + اسم المستخدم) ترى نفس الاستطلاع وتكمل عليه.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ================= التخزين ================= */
let data = { polls: {} };
function loadData() {
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!data || typeof data !== 'object' || !data.polls) data = { polls: {} };
  } catch (e) {
    data = { polls: {} };
  }
}
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('فشل حفظ البيانات:', e.message);
  }
}
loadData();

/* ================= أدوات ================= */
function clean(s, max) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').slice(0, max || 100);
}
function uid() {
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
function pollKey(streetNumber, username) {
  return clean(streetNumber, 20).toLowerCase() + '|' + clean(username, 60).toLowerCase();
}
function logActivity(poll, kind, text) {
  poll.activity.unshift({ id: uid(), kind, text: clean(text, 200), ts: Date.now() });
  if (poll.activity.length > 500) poll.activity.length = 500;
}

/* ================= API ================= */
function getPoll(creds) {
  const key = pollKey(creds.streetNumber, creds.username);
  return data.polls[key] || null;
}
function ensurePoll(creds) {
  const key = pollKey(creds.streetNumber, creds.username);
  if (!data.polls[key]) {
    data.polls[key] = {
      id: uid(),
      key,
      streetNumber: clean(creds.streetNumber, 20),
      username: clean(creds.username, 60),
      streetName: 'شارع ' + clean(creds.streetNumber, 20),
      createdAt: Date.now(),
      candidates: [],
      votes: [],
      activity: []
    };
    logActivity(data.polls[key], 'info', 'إنشاء استطلاع جديد للشارع ' + clean(creds.streetNumber, 20));
    saveData();
  }
  return data.polls[key];
}

const API_ROUTES = {
  'POST /api/login': (body) => {
    const streetNumber = clean(body.streetNumber, 20);
    const username = clean(body.username, 60);
    if (!streetNumber) return { error: 'رقم الشارع مطلوب' };
    if (!username) return { error: 'اسم المستخدم مطلوب' };
    return { ok: true, poll: ensurePoll({ streetNumber, username }) };
  },

  'POST /api/candidate-add': (body, poll) => {
    const name = clean(body.name, 60);
    if (!name) return { error: 'اسم المرشح مطلوب' };
    poll.candidates.push({ id: uid(), name, createdAt: Date.now() });
    logActivity(poll, 'candidate-add', 'إضافة المرشح «' + name + '»');
    return { ok: true };
  },

  'POST /api/candidate-update': (body, poll) => {
    const c = poll.candidates.find((x) => x.id === body.candidateId);
    if (!c) return { error: 'المرشح غير موجود' };
    const name = clean(body.name, 60);
    if (!name) return { error: 'اسم المرشح مطلوب' };
    c.name = name;
    logActivity(poll, 'candidate-edit', 'تعديل اسم المرشح إلى «' + name + '»');
    return { ok: true };
  },

  'POST /api/candidate-delete': (body, poll) => {
    const idx = poll.candidates.findIndex((x) => x.id === body.candidateId);
    if (idx === -1) return { error: 'المرشح غير موجود' };
    const removed = poll.candidates[idx];
    const votesLost = poll.votes.filter((v) => v.candidateId === removed.id).length;
    poll.candidates.splice(idx, 1);
    poll.votes = poll.votes.filter((v) => v.candidateId !== removed.id);
    logActivity(poll, 'candidate-delete', 'حذف المرشح «' + removed.name + '» (أُزيلت ' + votesLost + ' صوتًا)');
    return { ok: true };
  },

  /* التسجيل الفوري — بضغطة واحدة، الاسم اختياري ويُضاف لاحقًا */
  'POST /api/vote': (body, poll) => {
    const c = poll.candidates.find((x) => x.id === body.candidateId);
    if (!c) return { error: 'المرشح غير موجود' };
    const personName = clean(body.personName, 80);
    poll.votes.push({ id: uid(), candidateId: c.id, personName, createdAt: Date.now() });
    logActivity(poll, 'vote', 'تسجيل صوت للمرشح «' + c.name + '»' + (personName ? ' — ' + personName : ''));
    return { ok: true };
  },

  'POST /api/vote-update': (body, poll) => {
    const v = poll.votes.find((x) => x.id === body.voteId);
    if (!v) return { error: 'التسجيل غير موجود' };
    const newName = clean(body.personName, 80);
    if (!newName) return { error: 'اسم الشخص مطلوب (لحذف التسجيل استخدم زر الحذف)' };
    const newCand = poll.candidates.find((x) => x.id === body.candidateId);
    if (!newCand) return { error: 'المرشح غير موجود' };
    const oldCand = poll.candidates.find((x) => x.id === v.candidateId);
    v.personName = newName;
    v.candidateId = newCand.id;
    logActivity(poll, 'vote-edit', 'تعديل تسجيل إلى «' + newName + '» للمرشح «' + newCand.name + '»');
    return { ok: true };
  },

  'POST /api/vote-delete': (body, poll) => {
    const idx = poll.votes.findIndex((x) => x.id === body.voteId);
    if (idx === -1) return { error: 'التسجيل غير موجود' };
    const v = poll.votes[idx];
    const c = poll.candidates.find((x) => x.id === v.candidateId);
    poll.votes.splice(idx, 1);
    logActivity(poll, 'vote-undo', 'حذف صوت' + (c ? ' من «' + c.name + '»' : '') + (v.personName ? ' — ' + v.personName : ''));
    return { ok: true };
  },

  'POST /api/poll-update': (body, poll) => {
    const streetName = clean(body.streetName, 100);
    if (!streetName) return { error: 'اسم الشارع مطلوب' };
    poll.streetName = streetName;
    logActivity(poll, 'poll-edit', 'تعديل اسم الشارع إلى «' + streetName + '»');
    return { ok: true };
  },

  'POST /api/reset': (body, poll) => {
    const n = poll.votes.length;
    poll.votes = [];
    logActivity(poll, 'reset', 'تصفير كل الأصوات (' + n + ' صوتًا)');
    return { ok: true };
  },

  'POST /api/delete-poll': (body, poll) => {
    delete data.polls[poll.key];
    saveData();
    return { ok: true, deleted: true };
  }
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) { reject(new Error('حجم الطلب كبير')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const payload = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(payload);
}

function handleApi(req, res, pathname) {
  readBody(req).then((body) => {
    const route = API_ROUTES[req.method + ' ' + pathname];
    if (!route) return sendJson(res, 404, { error: 'المسار غير موجود' });

    // فقط الدخول لا يحتاج استطلاعًا قائمًا
    const needsPoll = !pathname.endsWith('/login');
    let poll = null;
    if (needsPoll) {
      poll = getPoll(body);
      if (!poll) return sendJson(res, 401, { error: 'انتهت الجلسة — سجّل الدخول من جديد' });
    }

    const result = route(body, poll);
    if (result.error) return sendJson(res, 400, result);

    if (result.deleted) return sendJson(res, 200, { ok: true });
    saveData();
    sendJson(res, 200, { ok: true, poll: (result.poll !== undefined) ? result.poll : poll });
  }).catch((e) => sendJson(res, 500, { error: 'خطأ في الخادم: ' + e.message }));
}

/* ================= الملفات الثابتة ================= */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('ممنوع'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('غير موجود'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

/* ================= الخادم ================= */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
  serveStatic(res, pathname);
});
server.listen(PORT, () => console.log('صوت الحارة يعمل على المنفذ ' + PORT));
