// Load optional .env (e.g. XAI_API_KEY=...) without extra dependencies
try { for (const l of require('fs').readFileSync(require('path').join(__dirname, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } } catch {}
const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const crypto = require('crypto');
const { customAlphabet } = require('nanoid');
const path = require('path');
const fs = require('fs');
const judge = require('./judge');
const paywall = require('./paywall');

const PORT = process.env.PORT || 3300;
const DIR = __dirname;
const UPLOADS = path.join(DIR, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true }); fs.mkdirSync(path.join(DIR, 'data'), { recursive: true });
const db = new Database(path.join(DIR, 'data', 'court2.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS seq (name TEXT PRIMARY KEY, n INTEGER);
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY, code TEXT UNIQUE, case_number TEXT UNIQUE, share_id TEXT UNIQUE, public_id TEXT UNIQUE,
  title TEXT, a_name TEXT, b_name TEXT, a_token TEXT, b_token TEXT, b_joined INTEGER DEFAULT 0,
  a_statement TEXT, a_evidence_text TEXT, a_images TEXT DEFAULT '[]', a_submitted_at TEXT,
  b_statement TEXT, b_evidence_text TEXT, b_images TEXT DEFAULT '[]', b_submitted_at TEXT,
  a_jury INTEGER DEFAULT 0, b_jury INTEGER DEFAULT 0,
  phase TEXT DEFAULT 'pleadings', working TEXT, error TEXT,
  questions TEXT DEFAULT '{}', answers TEXT DEFAULT '{}', a_answered INTEGER DEFAULT 0, b_answered INTEGER DEFAULT 0,
  ruling TEXT, ruled_at TEXT, appeal TEXT, appeal_ruling TEXT, appeal_ruled_at TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS votes (case_id TEXT, voter TEXT, vote TEXT, created_at TEXT, PRIMARY KEY (case_id, voter));
INSERT OR IGNORE INTO seq VALUES ('case', 122);`);

const idGen = customAlphabet('abcdefghijkmnpqrstuvwxyz23456789', 12);
const codeGen = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
const tokGen = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 32);
const J = s => (s ? JSON.parse(s) : null);
const get = id => db.prepare('SELECT * FROM cases WHERE id=?').get(id);
const upd = (id, f) => { const k = Object.keys(f); db.prepare(`UPDATE cases SET ${k.map(x => `${x}=@${x}`).join(',')} WHERE id=@id`).run({ ...f, id }); };
const sideOf = (c, t) => (!t ? null : t === c.a_token ? 'a' : c.b_token && t === c.b_token ? 'b' : null);
const other = s => (s === 'a' ? 'b' : 'a');
const bothFiled = c => !!(c.a_submitted_at && c.b_submitted_at);
const finalVerdict = c => { const ar = J(c.appeal_ruling); return ar ? ar.verdict : (J(c.ruling) || {}).verdict; };
const isPublic = c => !!(c.a_jury && c.b_jury && c.ruling);
const voteTally = id => { const t = { A: 0, B: 0, split: 0 }; for (const r of db.prepare('SELECT vote, COUNT(*) n FROM votes WHERE case_id=? GROUP BY vote').all(id)) t[r.vote] = r.n; t.total = t.A + t.B + t.split; return t; };
const canAppeal = (c, side) => { if (c.phase !== 'judgment' || c.appeal) return false; const v = J(c.ruling).verdict; return v === 'split' || (v === 'A' ? side === 'b' : side === 'a'); };
const imgUrl = (c, f) => `/api/cases/${c.id}/img/${f}`;

function exhibitList(c, side) {
  return judge.exhibits(c).filter(e => e.side === side || bothFiled(c)).filter(e => e.stage === 'trial' || c.appeal)
    .map(e => ({ label: e.label, side: e.side, kind: e.kind, stage: e.stage, text: e.kind === 'text' ? e.text : null, url: e.kind === 'image' ? imgUrl(c, e.file) : null }));
}

function view(c, side) {
  const both = bothFiled(c);
  const party = s => ({ name: c[s + '_name'], submitted: !!c[s + '_submitted_at'], jury: !!c[s + '_jury'],
    statement: s === side || both ? c[s + '_statement'] : null });
  const q = J(c.questions) || {}, a = J(c.answers) || {};
  const ap = J(c.appeal);
  return {
    id: c.id, code: c.code, case_number: c.case_number, title: c.title, you: side, phase: c.phase, working: c.working, error: c.error,
    b_joined: !!c.b_joined, a: party('a'), b: party('b'), exhibits: exhibitList(c, side),
    my_questions: q[side] || [], i_answered: !!c[side + '_answered'], other_answered: !!c[other(side) + '_answered'],
    examination: both && c.a_answered && c.b_answered ? { a: { q: q.a || [], a: a.a || [] }, b: { q: q.b || [], a: a.b || [] } } : null,
    ruling: J(c.ruling), ruled_at: c.ruled_at,
    appeal: ap ? { by: ap.by, argument: ap.argument, filed_at: ap.filed_at, response: ap.response || null, waived: !!ap.waived, responded: !!(ap.response || ap.waived) } : null,
    appeal_ruling: J(c.appeal_ruling), appeal_ruled_at: c.appeal_ruled_at,
    can_appeal: canAppeal(c, side), share_url: c.ruling ? `/judgment/${c.share_id}` : null,
    jury: isPublic(c) ? { url: `/jury/${c.public_id}`, tally: voteTally(c.id) } : null,
    judge_live: judge.isLive(), paywall: paywall.ENABLED,
  };
}

// ---- state machine: pleadings -> examination -> judgment -> (appeal_response -> final) ----
async function advance(id) {
  const c = get(id); if (!c || c.working) return;
  let stage = null;
  if (c.phase === 'pleadings' && bothFiled(c)) stage = 'exam';
  else if (c.phase === 'examination' && c.a_answered && c.b_answered) stage = 'ruling';
  else if (c.phase === 'appeal_response') { const ap = J(c.appeal); if (ap && (ap.response || ap.waived)) stage = 'appeal'; }
  if (!stage) return;
  if (db.prepare('UPDATE cases SET working=?, error=NULL WHERE id=? AND working IS NULL').run(stage, id).changes !== 1) return;
  try {
    if (stage === 'exam') { const qs = await judge.crossExamine(get(id), UPLOADS); upd(id, { questions: JSON.stringify(qs), a_answered: 0, b_answered: 0, phase: 'examination', working: null }); }
    if (stage === 'ruling') { const r = await judge.judgment(get(id), UPLOADS); upd(id, { ruling: JSON.stringify(r), ruled_at: new Date().toISOString(), phase: 'judgment', working: null }); }
    if (stage === 'appeal') { const r = await judge.appellate(get(id), UPLOADS); upd(id, { appeal_ruling: JSON.stringify(r), appeal_ruled_at: new Date().toISOString(), phase: 'final', working: null }); }
  } catch (e) {
    console.error('judge error', id, stage, e.message);
    upd(id, { working: null, error: 'The court encountered a technical problem while deliberating. Please tap "Retry".' });
  }
}

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(DIR, 'public')));
const upload = multer({ storage: multer.diskStorage({ destination: UPLOADS,
  filename: (req, f, cb) => { const e = path.extname(f.originalname).toLowerCase(); cb(null, idGen() + (/^\.(png|jpe?g|webp|gif|heic)$/.test(e) ? e : '.jpg')); } }),
  limits: { fileSize: 10 * 1024 * 1024, files: 6 }, fileFilter: (req, f, cb) => cb(null, /^image\//.test(f.mimetype)) });
const clean = (s, n) => String(s ?? '').trim().slice(0, n);
const tok = req => req.get('x-case-token') || req.query.t;
function load(req, res) {
  const c = get(req.params.id); if (!c) { res.status(404).json({ error: 'Case not found.' }); return []; }
  const side = sideOf(c, tok(req)); if (!side) { res.status(403).json({ error: 'You are not a party to this case.' }); return []; }
  return [c, side];
}

app.get('/api/config', (req, res) => res.json({ judge_live: judge.isLive(), provider: judge.provider(), paywall: paywall.ENABLED }));

// PAYWALL GATE #1: opening a case
app.post('/api/cases', paywall.gate('open_case'), (req, res) => {
  const title = clean(req.body.title, 120), a_name = clean(req.body.a_name, 60), b_name = clean(req.body.b_name, 60);
  if (!title || !a_name || !b_name) return res.status(400).json({ error: 'Case title and both names are required.' });
  if (a_name.toLowerCase() === b_name.toLowerCase()) return res.status(400).json({ error: 'The two parties must have different names.' });
  const id = idGen(), a_token = tokGen();
  const n = db.prepare("UPDATE seq SET n=n+1 WHERE name='case' RETURNING n").get().n;
  const case_number = `${new Date().getUTCFullYear()}-${String(n).padStart(6, '0')}`;
  db.prepare('INSERT INTO cases (id,code,case_number,share_id,public_id,title,a_name,b_name,a_token,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, codeGen(), case_number, tokGen().slice(0, 20), idGen(), title, a_name, b_name, a_token, new Date().toISOString());
  res.json({ id, token: a_token });
});

const byCode = code => db.prepare('SELECT * FROM cases WHERE code=?').get(String(code).toUpperCase());
app.get('/api/join/:code', (req, res) => {
  const c = byCode(req.params.code); if (!c) return res.status(404).json({ error: 'No case found with that code.' });
  res.json({ id: c.id, case_number: c.case_number, title: c.title, a_name: c.a_name, b_name: c.b_name, b_joined: !!c.b_joined });
});
app.post('/api/join/:code', (req, res) => {
  const c = byCode(req.params.code); if (!c) return res.status(404).json({ error: 'No case found with that code.' });
  const b_token = tokGen();
  if (db.prepare('UPDATE cases SET b_token=?, b_joined=1 WHERE id=? AND b_joined=0').run(b_token, c.id).changes !== 1)
    return res.status(409).json({ error: 'The Defendant has already joined this case from another device.' });
  res.json({ id: c.id, token: b_token });
});

app.get('/api/cases/:id', (req, res) => { const [c, s] = load(req, res); if (c) res.json(view(c, s)); });

app.post('/api/cases/:id/submit', upload.array('images', 6), (req, res) => {
  const [c, side] = load(req, res); if (!c) return;
  if (c[side + '_submitted_at']) return res.status(409).json({ error: 'You have already filed your side.' });
  const statement = clean(req.body.statement, 6000);
  if (statement.length < 10) return res.status(400).json({ error: 'Please write your statement (at least a sentence).' });
  upd(c.id, { [side + '_statement']: statement, [side + '_evidence_text']: clean(req.body.evidence_text, 4000),
    [side + '_images']: JSON.stringify((req.files || []).map(f => f.filename)), [side + '_jury']: req.body.jury === 'on' || req.body.jury === '1' ? 1 : 0,
    [side + '_submitted_at']: new Date().toISOString() });
  advance(c.id); res.json(view(get(c.id), side));
});

app.post('/api/cases/:id/answer', (req, res) => {
  const [c, side] = load(req, res); if (!c) return;
  if (c.phase !== 'examination' || c[side + '_answered']) return res.status(409).json({ error: 'No questions are awaiting your answer.' });
  const qs = (J(c.questions) || {})[side] || [];
  const ans = qs.map((_, i) => clean((req.body.answers || [])[i], 2000));
  if (ans.some(a => a.length < 2)) return res.status(400).json({ error: 'Cross-examination is required: please answer every question.' });
  const all = J(c.answers) || {}; all[side] = ans;
  upd(c.id, { answers: JSON.stringify(all), [side + '_answered']: 1 });
  advance(c.id); res.json(view(get(c.id), side));
});

app.post('/api/cases/:id/jury', (req, res) => {
  const [c, side] = load(req, res); if (!c) return;
  upd(c.id, { [side + '_jury']: req.body.optin ? 1 : 0 }); res.json(view(get(c.id), side));
});

// PAYWALL GATE #2: filing an appeal (gate runs before any upload is stored)
app.post('/api/cases/:id/appeal', (req, res, next) => { const [c, side] = load(req, res); if (!c) return;
  if (!canAppeal(c, side)) return res.status(409).json({ error: 'An appeal is not available to you in this case.' });
  next(); }, paywall.gate('appeal'), upload.array('images', 6), (req, res) => {
  const c = get(req.params.id), side = sideOf(c, tok(req));
  if (!canAppeal(c, side)) return res.status(409).json({ error: 'An appeal is not available to you in this case.' });
  const argument = clean(req.body.argument, 6000);
  if (argument.length < 20) return res.status(400).json({ error: 'Please set out your grounds of appeal.' });
  const ap = { by: side, argument, evidence_text: clean(req.body.evidence_text, 4000), images: (req.files || []).map(f => f.filename), filed_at: new Date().toISOString() };
  upd(c.id, { appeal: JSON.stringify(ap), phase: 'appeal_response' }); res.json(view(get(c.id), side));
});
app.post('/api/cases/:id/appeal/respond', (req, res) => {
  const [c, side] = load(req, res); if (!c) return;
  const ap = J(c.appeal);
  if (c.phase !== 'appeal_response' || !ap || ap.by === side || ap.response || ap.waived) return res.status(409).json({ error: 'No appeal is awaiting your response.' });
  if (req.body.waive) ap.waived = true; else { ap.response = clean(req.body.response, 6000); if (ap.response.length < 5) return res.status(400).json({ error: 'Please write a response, or choose to waive.' }); }
  ap.responded_at = new Date().toISOString();
  upd(c.id, { appeal: JSON.stringify(ap) }); advance(c.id); res.json(view(get(c.id), side));
});
app.post('/api/cases/:id/retry', (req, res) => { const [c, side] = load(req, res); if (!c) return; advance(c.id); setTimeout(() => res.json(view(get(c.id), side)), 50); });

app.get('/api/cases/:id/img/:file', (req, res) => {
  const c = get(req.params.id); if (!c) return res.sendStatus(404);
  const side = sideOf(c, tok(req)); if (!side) return res.sendStatus(403);
  const f = path.basename(req.params.file);
  const e = judge.exhibits(c).find(x => x.file === f);
  if (!e || (e.side !== side && !bothFiled(c))) return res.sendStatus(403);
  res.sendFile(path.join(UPLOADS, f));
});

// ---- Read-only judgment (anyone with the link) ----
app.get('/api/judgment/:share', (req, res) => {
  const c = db.prepare('SELECT * FROM cases WHERE share_id=?').get(req.params.share);
  if (!c || !c.ruling) return res.status(404).json({ error: 'Judgment not found.' });
  res.json({ case_number: c.case_number, title: c.title, a_name: c.a_name, b_name: c.b_name, ruling: J(c.ruling), ruled_at: c.ruled_at,
    appeal: c.appeal ? { by: J(c.appeal).by } : null, appeal_ruling: J(c.appeal_ruling), appeal_ruled_at: c.appeal_ruled_at,
    exhibits: judge.exhibits(c).map(e => ({ label: e.label, side: e.side, kind: e.kind, stage: e.stage })) });
});

// ---- Public jury (only when BOTH parties opted in), anonymised ----
function redactor(c) {
  const rules = [];
  for (const [s, role] of [['a', 'Plaintiff'], ['b', 'Defendant']]) {
    const nm = c[s + '_name'].trim();
    rules.push([nm, role]); for (const w of nm.split(/\s+/)) if (w.length >= 2) rules.push([w, role]);
  }
  rules.sort((x, y) => y[0].length - x[0].length);
  return t => { let s = String(t ?? ''); for (const [n, r] of rules) s = s.replace(new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu'), r); return s; };
}
const deep = (o, f) => typeof o === 'string' ? f(o) : Array.isArray(o) ? o.map(x => deep(x, f)) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deep(v, f)])) : o;
function publicCase(c) {
  const R = redactor(c), q = J(c.questions) || {}, a = J(c.answers) || {};
  return deep({ public_id: c.public_id, case_number: c.case_number, title: c.title,
    plaintiff: { statement: c.a_statement, exam: (q.a || []).map((x, i) => ({ q: x, a: (a.a || [])[i] })) },
    defendant: { statement: c.b_statement, exam: (q.b || []).map((x, i) => ({ q: x, a: (a.b || [])[i] })) },
    exhibits: judge.exhibits(c).map(e => ({ label: e.label, kind: e.kind, stage: e.stage, text: e.kind === 'text' ? e.text : null })),
    ruling: J(c.ruling), appeal_ruling: J(c.appeal_ruling), appeal_by: c.appeal ? J(c.appeal).by : null, phase: c.phase, ruled_at: c.ruled_at }, R);
}
const voterId = (req, res) => {
  let v = (req.headers.cookie || '').match(/(?:^|;\s*)jv=([\w-]{16,40})/)?.[1];
  if (!v) { v = tokGen(); res.setHeader('Set-Cookie', `jv=${v}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`); }
  return crypto.createHash('sha256').update(v).digest('hex').slice(0, 32);
};
app.get('/api/jury/:pub', (req, res) => {
  const c = db.prepare('SELECT * FROM cases WHERE public_id=?').get(req.params.pub);
  if (!c || !isPublic(c)) return res.status(404).json({ error: 'This case is not on the public docket.' });
  const v = db.prepare('SELECT vote FROM votes WHERE case_id=? AND voter=?').get(c.id, voterId(req, res));
  res.json({ ...publicCase(c), my_vote: v ? v.vote : null, tally: v ? voteTally(c.id) : null });
});
app.post('/api/jury/:pub/vote', (req, res) => {
  const c = db.prepare('SELECT * FROM cases WHERE public_id=?').get(req.params.pub);
  if (!c || !isPublic(c)) return res.status(404).json({ error: 'This case is not on the public docket.' });
  const vote = req.body.vote; if (!['A', 'B', 'split'].includes(vote)) return res.status(400).json({ error: 'Invalid vote.' });
  const t = tok(req); if (t && sideOf(c, t)) return res.status(403).json({ error: 'Parties to the case may not sit on its jury.' });
  db.prepare('INSERT OR IGNORE INTO votes VALUES (?,?,?,?)').run(c.id, voterId(req, res), vote, new Date().toISOString());
  res.json({ ok: true, tally: voteTally(c.id) });
});
app.get('/api/docket', (req, res) => {
  const rows = db.prepare('SELECT * FROM cases WHERE a_jury=1 AND b_jury=1 AND ruling IS NOT NULL ORDER BY ruled_at DESC LIMIT 100').all();
  res.json(rows.map(c => { const R = redactor(c); return { public_id: c.public_id, case_number: c.case_number, title: R(c.title), verdict: finalVerdict(c),
    appealed: !!c.appeal_ruling, disposition: c.appeal_ruling ? J(c.appeal_ruling).disposition : null, tally: voteTally(c.id), ruled_at: c.ruled_at }; }));
});

app.get(['/case/:id', '/join/:code', '/new', '/judgment/:s', '/jury/:p', '/docket'], (req, res) => res.sendFile(path.join(DIR, 'public', 'index.html')));
app.use((err, req, res, next) => { console.error(err.message); res.status(400).json({ error: err.message || 'Bad request' }); });

// Resume anything interrupted mid-deliberation by a restart
db.prepare('UPDATE cases SET working=NULL WHERE working IS NOT NULL').run();
for (const r of db.prepare("SELECT id FROM cases WHERE phase IN ('pleadings','examination','appeal_response')").all()) advance(r.id);
app.listen(PORT, () => console.log(`Court running on :${PORT} judge=${judge.provider()} paywall=${paywall.ENABLED}`));
