import * as B from './backend.js';
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let pollTimer = null, routeSeq = 0;
const fmtDate = d => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
const BASE = B.appBase();
const link = h => BASE + h;
function nav(h) { if (location.hash === h) route(); else location.hash = h; window.scrollTo(0, 0); }
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
const showErr = (id, e) => { const el = document.getElementById(id); if (el) el.innerHTML = `<div class="err">${esc(e.message || e)}</div>`; };
const loading = (t = 'Loading…') => { $app.innerHTML = `<div class="card center"><div class="gavel">⚖️</div><p class="muted">${esc(t)}</p></div>`; };

async function route() {
  clearTimeout(pollTimer); const seq = ++routeSeq;
  const p = location.hash.replace(/^#/, '') || '/'; let m;
  if ((m = p.match(/^\/c\/([A-Za-z0-9-]+)\/([0-9a-f]{64})$/))) {
    loading('Opening your case…');
    try { const r = await B.importPrivate(m[1], m[2]); history.replaceState(null, '', '#/case/' + r.id); return caseView(r.id, seq); }
    catch (e) { $app.innerHTML = `<div class="card"><h2>Could not open the case</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="#/">Home</a></div>`; return; }
  }
  if ((m = p.match(/^\/case\/(\w+)/))) return caseView(m[1], seq);
  if ((m = p.match(/^\/join\/([A-Za-z0-9-]+)/))) return joinView(m[1]);
  if ((m = p.match(/^\/judgment\/(\w+)/))) return judgmentPage(m[1]);
  if ((m = p.match(/^\/jury\/(\w+)/))) return juryPage(m[1]);
  if (p === '/docket') return docketPage();
  if (p === '/new') return newView();
  if (p === '/help') return helpPage();
  return home();
}

// ---------- shared pieces ----------
const roleOf = s => (s === 'a' ? 'Plaintiff' : 'Defendant');
function caption({ case_number, title, a, b, sub, anon }) {
  return `<div class="caption-block"><div class="court">In the Court of Common Disputes</div><div class="cno">Case No. ${esc(case_number)}</div>
    <div class="pty">${esc(a)}${anon ? '' : ' <span class="role">Plaintiff</span>'}</div><div class="v">v.</div><div class="pty">${esc(b)}${anon ? '' : ' <span class="role">Defendant</span>'}</div>
    <div class="re">Re: ${esc(title)}</div>${sub ? `<div class="muted" style="font-size:12px;margin-top:4px">${sub}</div>` : ''}</div>`;
}
const verdictName = (v, a, b) => (v === 'A' ? `For the Plaintiff, ${a}` : v === 'B' ? `For the Defendant, ${b}` : 'Split Decision');
const cites = xs => (xs || []).map(x => `<span class="cite">Ex. ${esc(x)}</span>`).join('');
const linkCites = s => esc(s).replace(/\b(Exhibit|Ex\.)\s+([PD]-\d+)/g, '$1 <span class="cite">$2</span>');
const paras = s => String(s || '').split(/\n+/).filter(Boolean).map(p => `<p>${linkCites(p)}</p>`).join('');

function judgmentHTML(r, a, b, when) {
  const list = xs => `<ul>${(xs || []).map(x => `<li>${linkCites(x)}</li>`).join('')}</ul>`;
  return `<div class="eyebrow" style="text-align:center">Judgment of the Court${when ? ' · ' + esc(fmtDate(when)) : ''}</div>
    <div class="verdict"><div class="lbl">Verdict</div><div class="res">${esc(verdictName(r.verdict, a, b))}</div><div class="stmt">${esc(r.verdict_statement)}</div></div>
    <section><h3>I. Summary of Facts</h3>${paras(r.summary_of_facts)}</section>
    <section><h3>II. The Parties' Positions</h3><p class="muted" style="margin:0">Plaintiff (${esc(a)}):</p>${list(r.plaintiff_points)}<p class="muted" style="margin:6px 0 0">Defendant (${esc(b)}):</p>${list(r.defendant_points)}</section>
    <section><h3>III. Findings of Fact</h3><ol class="formal">${(r.findings_of_fact || []).map(f => `<li>${linkCites(f.finding)}${cites(f.exhibits)}</li>`).join('')}</ol></section>
    <section><h3>IV. Conclusions</h3><ol class="formal">${(r.conclusions || []).map(x => `<li>${linkCites(x)}</li>`).join('')}</ol></section>
    <section class="reasoning"><h3>V. Reasoning</h3>${paras(r.reasoning)}</section>
    <section><h3>VI. Order</h3><div class="order"><div class="lbl">IT IS SO ORDERED</div>${paras(r.order)}</div></section>`;
}
function appellateHTML(ar, a, b, by, when) {
  return `<div class="card ruling appellate">
    <div class="eyebrow" style="text-align:center">Appellate Division${when ? ' · ' + esc(fmtDate(when)) : ''}</div>
    <h2>Ruling on Appeal</h2>
    <p class="muted" style="text-align:center;margin:0">Appeal brought by the ${roleOf(by)}${a ? ', ' + esc(by === 'a' ? a : b) : ''}</p>
    <div style="text-align:center;margin:12px 0"><span class="disp ${esc(ar.disposition)}">JUDGMENT ${esc(ar.disposition.toUpperCase())}</span></div>
    <div class="verdict"><div class="lbl">Final Outcome</div><div class="res">${esc(verdictName(ar.verdict, a, b))}</div></div>
    <section><h3>Summary</h3>${paras(ar.summary)}</section>
    <section class="reasoning"><h3>Reasoning</h3>${paras(ar.reasoning)}</section>
    <section><h3>Order</h3><div class="order"><div class="lbl">IT IS SO ORDERED</div>${paras(ar.order)}</div></section></div>`;
}
function exhibitsHTML(list, opts = {}) {
  if (!list.length) return '<p class="muted">No exhibits were tendered.</p>';
  return list.map(e => `<div class="ex"><span class="tag">${esc(e.label)}</span>${e.url ? `<a href="${e.url}" target="_blank" rel="noopener"><img src="${e.url}" alt="Exhibit ${esc(e.label)}"></a>` : ''}
    <div class="tx">${e.kind === 'text' ? esc(e.text || '(written evidence)') : `${e.caption ? esc(e.caption) : `<span class="muted">Image exhibit${opts.withheld ? ' (withheld from public view)' : ''}</span>`}${e.ocr ? `<details><summary class="muted" style="font-size:13px">Text read from image</summary><div class="stmtbox" style="font-size:13px">${esc(e.ocr)}</div></details>` : ''}`}${e.stage === 'appeal' ? ' <span class="badge">On appeal</span>' : ''}</div></div>`).join('');
}
const LEGAL_AID = `<a href="https://www.lawhelp.org/" target="_blank" rel="noopener">LawHelp.org</a> (free legal aid finder), <a href="https://www.lsc.gov/about-lsc/what-legal-aid/get-legal-help" target="_blank" rel="noopener">LSC legal aid offices</a>, or call <b>211</b>`;
const NOTICE = `<div class="notice">This judgment is a neutral AI opinion offered to help the parties resolve their disagreement. It is <strong>not legally binding and not legal advice</strong>, and this is not a real court. For real legal help, try ${LEGAL_AID}, or your local small-claims court.</div>`;
const waiting = (t, m) => `<div class="card center"><div class="gavel">🔨</div><h2>${t}</h2><p class="muted">${m}</p></div>`;

// ---------- pages ----------
function home() {
  const mine = B.myCases();
  $app.innerHTML = `<div class="hero"><div class="eyebrow">A neutral forum</div><h1>Have a disagreement?<br>Take it to Court.</h1>
    <p>Each side files a statement and numbered exhibits. A free AI judge cross-examines both parties, then issues a formal written judgment. One appeal is allowed.</p></div>
  ${mine.length ? `<div class="card"><h3>Your cases</h3><div class="docket">${mine.map(c => `<a href="#/case/${esc(c.id)}"><div class="cn">${c.side === 'a' ? 'You are the Plaintiff' : 'You are the Defendant'}</div><div class="tt">${esc(c.title || 'Case')}</div></a>`).join('')}</div></div>` : ''}
  <div class="card"><h3>How it works</h3><ol class="steps">
    <li>The Plaintiff opens a case and summons the Defendant with a link.</li>
    <li>Each side files privately. Evidence becomes exhibits (P-1, D-1…).</li>
    <li>The judge cross-examines both parties (1–3 questions each).</li>
    <li>A formal judgment is entered: findings, conclusions, verdict and order.</li>
    <li>The losing party may appeal once. Both may opt in to a public jury.</li></ol>
    <a class="btn gold" href="#/new">File a New Case</a></div>
  <div class="card"><h3>Were you summoned?</h3><p class="muted" style="margin:0">Enter the case code you were sent.</p>
    <form id="jf"><input type="text" id="code" placeholder="e.g. K7Q2-MXRT-4HPA" autocapitalize="characters" autocomplete="off" maxlength="16" style="text-transform:uppercase;letter-spacing:.12em;margin-top:10px"><button class="btn">Go to Case</button></form></div>
  <div class="navlinks"><a href="#/docket">Browse the Public Docket →</a> · <a href="#/help">Free legal help →</a></div>`;
  document.getElementById('jf').onsubmit = e => { e.preventDefault(); const c = B.normCode(document.getElementById('code').value); if (c) nav('#/join/' + c); };
}
function helpPage() {
  $app.innerHTML = `<div class="card"><div class="eyebrow">Important</div><h2>This is not a real court</h2>
  <p>Court is a free tool that helps two people talk a disagreement through with a neutral AI. Its judgments are <strong>opinions, not legal advice</strong>, and nobody is bound by them. The AI can make mistakes.</p>
  <h3>Free, real legal help</h3><ul>
  <li><a href="https://www.lawhelp.org/" target="_blank" rel="noopener">LawHelp.org</a>: find free legal aid and self-help guides for your state.</li>
  <li><a href="https://www.lsc.gov/about-lsc/what-legal-aid/get-legal-help" target="_blank" rel="noopener">Legal Services Corporation</a>: find a legal aid office near you.</li>
  <li>Call or text <b>211</b> for local help, including legal aid and mediation.</li>
  <li>Small claims: search “small claims court” plus your county for how to file, usually without a lawyer.</li>
  <li>Community mediation centers often help neighbors, tenants and landlords for free.</li></ul>
  <h3>Privacy</h3><p class="muted">Case files are encrypted on your device. Only the two people with the case code can read them. If both parties opt in to the public jury, a version with names removed and images withheld is published.</p>
  <a class="btn" href="#/">Home</a></div>`;
}
function newView() {
  $app.innerHTML = `<div class="card"><div class="eyebrow">New matter</div><h2>File a Case</h2>
    <form id="nf"><label>What is the dispute about?</label><input type="text" name="title" maxlength="120" placeholder="e.g. Payment for a broken lamp" required>
      <label>Your name <span class="opt">(Plaintiff)</span></label><input type="text" name="a_name" maxlength="60" required>
      <label>The other party's name <span class="opt">(Defendant)</span></label><input type="text" name="b_name" maxlength="60" required>
      <div id="er"></div><button class="btn gold">Open Case</button>
      <p class="muted" style="font-size:12px;text-align:center">Free. No account. Not legal advice.</p></form></div>`;
  document.getElementById('nf').onsubmit = async e => {
    e.preventDefault(); const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Opening…';
    try { const r = await B.createCase(Object.fromEntries(new FormData(e.target))); nav('#/case/' + r.id); }
    catch (err) { showErr('er', err); b.disabled = false; b.textContent = 'Open Case'; }
  };
}
async function joinView(code) {
  loading('Finding the case…');
  let info;
  try { info = await B.joinInfo(code); } catch (e) { $app.innerHTML = `<div class="card"><h2>Case not found</h2><p class="muted">${esc(e.message)}</p><button class="btn" id="again">Try again</button><a class="btn ghost" href="#/">Back</a></div>`; document.getElementById('again').onclick = () => joinView(code); return; }
  if (info.mine) return nav('#/case/' + info.id);
  const cap = caption({ ...info, a: info.a_name, b: info.b_name });
  if (info.b_joined) { $app.innerHTML = `<div class="card">${cap}<p class="muted">The Defendant has already joined this case from another device. Please open it on the device you joined with, or use your private link.</p></div>`; return; }
  $app.innerHTML = `<div class="card"><div class="eyebrow" style="text-align:center">Summons</div>${cap}
    <p>${esc(info.a_name)} has brought this matter before the court and named you, <strong>${esc(info.b_name)}</strong>, as Defendant. You will file your side privately; the Plaintiff cannot read it until both sides have filed.</p>
    <p class="muted" style="font-size:13px">This is a free AI opinion, not a real court and not legal advice. Taking part is voluntary.</p>
    <div id="er"></div><button class="btn gold" id="jb">I am ${esc(info.b_name)}. Enter Court</button></div>`;
  document.getElementById('jb').onclick = async e => {
    e.target.disabled = true; e.target.textContent = 'Entering…';
    try { const r = await B.joinCase(code); nav('#/case/' + r.id); } catch (err) { showErr('er', err); e.target.disabled = false; e.target.textContent = `I am ${info.b_name}. Enter Court`; }
  };
}
function partyChip(c, s) {
  const p = c[s], st = p.submitted ? '<span class="ok">✓ Filed</span>' : s === 'b' && !c.b_joined ? '<span class="wait">Not yet summoned</span>' : '<span class="wait">Preparing</span>';
  return `<div class="party"><div class="who">${roleOf(s)} ${c.you === s ? '<span class="you">(YOU)</span>' : ''}</div><div class="nm">${esc(p.name)}</div><div class="st">${st}</div></div>`;
}
const header = c => `<div class="card">${caption({ case_number: c.case_number, title: c.title, a: c.a.name, b: c.b.name })}<div class="parties">${partyChip(c, 'a')}<div class="vs">v.</div>${partyChip(c, 'b')}</div></div>`;
function shareCard(c) {
  if (c.you !== 'a' || c.b_joined) return '';
  const u = link('#/join/' + B.normCode(c.code));
  return `<div class="card"><h3>Summon ${esc(c.b.name)}</h3><p class="muted" style="margin:0">Send this link or code so ${esc(c.b.name)} can file their side. Only people with this code can open the case.</p>
    <div class="code">${esc(c.code)}</div><div class="linkbox">${esc(u)}</div>
    <div class="row"><button class="btn" data-share="${esc(u)}" data-text="${esc(`${c.a.name} has filed "${c.title}" in Court (Case No. ${c.case_number}) and named you as Defendant. File your side here:`)}">Share Link</button><button class="btn ghost" data-copy="${esc(u)}">Copy</button></div></div>`;
}
const privCard = c => `<div class="card"><h3>Your private link</h3><p class="muted" style="margin:0">Reopen this case on another device. Don't share it; it lets anyone act as you.</p><button class="btn ghost" data-copy="${esc(B.privateLink(BASE, c.id))}">Copy My Private Link</button></div>`;
document.addEventListener('click', async e => {
  const cp = e.target.closest('[data-copy]'), sh = e.target.closest('[data-share]');
  if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); cp.textContent = 'Copied'; } catch { prompt('Copy this:', cp.dataset.copy); } }
  if (sh) { if (navigator.share) { try { await navigator.share({ title: 'Court', text: sh.dataset.text || '', url: sh.dataset.share }); } catch {} } else { try { await navigator.clipboard.writeText((sh.dataset.text ? sh.dataset.text + ' ' : '') + sh.dataset.share); sh.textContent = 'Copied'; } catch { prompt('Copy this link:', sh.dataset.share); } } }
});

const fileInput = `<label class="file"><input type="file" name="images" accept="image/*" multiple><span>📎 Tap to add screenshots, receipts or photos</span></label><div class="thumbs"></div>`;
function fileForm(c) {
  const pre = c.you === 'a' ? 'P' : 'D';
  return `<div class="card"><div class="eyebrow">Your filing as ${roleOf(c.you)}</div><h2>State Your Case</h2>
    <p class="muted" style="margin-top:0">Be factual and specific: dates, amounts, what was said. ${esc(c[c.you === 'a' ? 'b' : 'a'].name)} can't read this until both sides have filed.</p>
    <form id="sf"><label>Your statement</label><textarea name="statement" maxlength="6000" required placeholder="What happened, and why you believe you are in the right…"></textarea>
      <label>Written evidence <span class="opt">(optional, becomes Exhibit ${pre}-1)</span></label>
      <textarea name="evidence_text" maxlength="4000" style="min-height:90px" placeholder="Paste messages, a timeline, amounts, witness names…"></textarea>
      <label>Photos &amp; screenshots <span class="opt">(optional, up to 6, numbered as exhibits)</span></label>${fileInput}
      <p class="muted" style="font-size:12px;margin:4px 0 0">The AI judge can't see pictures. It reads any text in them (on your phone, nothing uploaded for that) plus the description you type under each one.</p>
      <label class="check"><input type="checkbox" name="jury"><span><strong>Opt in to the public jury.</strong> If both parties agree, an anonymised version of this case (names removed, images withheld) appears on the public docket, where visitors can vote.</span></label>
      <div id="er"></div><button class="btn gold">File My Side</button><p class="muted" style="font-size:12px;text-align:center">Once filed, your statement cannot be edited.</p></form></div>`;
}
/* ---------- images: shrink on-device, read text with free on-device OCR ---------- */
let tessP = null;
function loadTess() { return tessP || (tessP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'; s.onload = () => res(window.Tesseract); s.onerror = () => { tessP = null; rej(new Error('OCR unavailable')); }; document.head.appendChild(s); })); }
async function toCanvas(file, max) { const img = await createImageBitmap(file); const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c; }
async function shrink(file) { let max = 1100, q = 0.7, d = ''; for (let i = 0; i < 7; i++) { d = (await toCanvas(file, max)).toDataURL('image/jpeg', q); if (d.length < 68000) return d; max = Math.round(max * 0.8); q = Math.max(0.4, q - 0.06); } return d; }
async function ocr(file) {
  try { const T = await loadTess(); const c = await toCanvas(file, 1800);
    const r = await Promise.race([T.recognize(c, 'eng'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 60000))]);
    return String(r.data.text || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, 1500);
  } catch (e) { return ''; }
}
function bindFiles(form) {
  const inp = form.querySelector('input[type=file]'), th = form.querySelector('.thumbs'), lab = form.querySelector('.file span');
  if (!inp) return;
  inp.onchange = () => { const f = [...inp.files].slice(0, 6); th.innerHTML = f.map((x, i) => `<div class="thumbcap"><img src="${URL.createObjectURL(x)}" alt=""><input type="text" name="cap${i}" maxlength="300" placeholder="What does photo ${i + 1} show?"></div>`).join(''); lab.textContent = f.length ? `${f.length} image(s) selected. Tap to change` : '📎 Tap to add screenshots, receipts or photos'; };
}
async function collectImages(form, btn) {
  const inp = form.querySelector('input[type=file]'); const files = inp ? [...inp.files].slice(0, 6) : []; const out = [];
  for (let i = 0; i < files.length; i++) {
    btn.textContent = `Reading photo ${i + 1} of ${files.length}…`;
    const [data, text] = await Promise.all([shrink(files[i]), ocr(files[i])]);
    out.push({ data, ocr: text, caption: (form.elements['cap' + i] || {}).value || '' });
  }
  return out;
}
function examForm(c) {
  return `<div class="card"><div class="eyebrow">From the bench</div><h2>Cross-Examination</h2>
    <p class="muted" style="margin-top:0">The court puts the following questions to you, ${esc(c[c.you].name)}. Answers are required and become part of the record.</p>
    <form id="qf">${c.my_questions.map((q, i) => `<div class="q"><strong>Q${i + 1}.</strong> ${esc(q)}</div><textarea name="a${i}" maxlength="2000" style="min-height:90px" required></textarea>`).join('')}
    <div id="er"></div><button class="btn gold">Submit Answers</button></form></div>`;
}
function tallyLine(t) { const pct = n => (t.total ? Math.round(100 * n / t.total) : 0); return `Plaintiff ${pct(t.A)}% · Defendant ${pct(t.B)}% · Split ${pct(t.split)}%`; }
const topOf = t => ['A', 'B', 'split'].sort((x, y) => t[y] - t[x])[0];
function juryCard(c) {
  const me = c[c.you], ot = c[c.you === 'a' ? 'b' : 'a'];
  let body = `<label class="check"><input type="checkbox" id="jo" ${me.jury ? 'checked' : ''}><span>I consent to an anonymised public jury for this case.</span></label>
    <p class="muted" style="font-size:13px;margin:8px 0 0">${esc(ot.name)}: ${ot.jury ? '<span class="ok">consented</span>' : 'has not consented'}. The case goes public only if both consent, and either of you can withdraw.</p>`;
  if (c.jury) {
    const t = c.jury.tally, fv = c.appeal_ruling ? c.appeal_ruling.verdict : c.ruling.verdict, u = link(c.jury.url);
    body = `<div class="compare"><div><div class="k">Judge</div><div class="val">${esc(verdictName(fv, 'Plaintiff', 'Defendant').replace(/, .*/, ''))}</div></div><div><div class="k">Public jury (${t.total})</div><div class="val">${t.total ? esc(verdictName(topOf(t), 'P', 'D').replace(/, .*/, '')) : 'No votes yet'}</div></div></div>
      <p class="muted" style="font-size:13px">${tallyLine(t)}</p>
      <div class="row"><a class="btn ghost" href="${c.jury.url}">View Public Page</a><button class="btn" data-share="${esc(u)}" data-text="Be the jury on Case No. ${esc(c.case_number)}:">Share</button></div>` + body;
  }
  return `<div class="card"><h3>Public Jury</h3>${body}</div>`;
}
function appealCard(c) {
  if (c.appeal || !c.ruling) return '';
  if (!c.can_appeal) return `<div class="card"><h3>Appeal</h3><p class="muted" style="margin:0">Only the losing party may appeal, once. The judgment was entered in your favour.</p></div>`;
  return `<div class="card"><div class="eyebrow">Right of appeal</div><h2>File an Appeal</h2>
    <p class="muted" style="margin-top:0">You may appeal once to the Appellate Division. Set out where you believe the court went wrong and add any new evidence. ${esc(c[c.you === 'a' ? 'b' : 'a'].name)} may respond before the appeal is decided.</p>
    <form id="apf"><label>Grounds of appeal</label><textarea name="argument" maxlength="6000" required placeholder="The court erred because…"></textarea>
      <label>New written evidence <span class="opt">(optional)</span></label><textarea name="evidence_text" maxlength="4000" style="min-height:80px"></textarea>
      <label>New images <span class="opt">(optional)</span></label>${fileInput}
      <div id="aer"></div><button class="btn gold">File Appeal</button></form></div>`;
}
function appealStatus(c) {
  const ap = c.appeal; if (!ap) return '';
  const byName = c[ap.by].name, iAmAppellant = ap.by === c.you;
  let h = `<div class="card"><div class="eyebrow">Appellate Division</div><h3>Appeal by the ${roleOf(ap.by)}, ${esc(byName)}</h3><div class="stmtbox">${esc(ap.argument)}</div>`;
  if (ap.responded) h += ap.waived ? `<p class="muted">The respondent waived a response.</p>` : `<label>Response of the ${roleOf(ap.by === 'a' ? 'b' : 'a')}</label><div class="stmtbox">${esc(ap.response)}</div>`;
  else if (!iAmAppellant) h += `<form id="rf"><label>Your response to the appeal</label><textarea name="response" maxlength="6000" placeholder="Why the judgment should stand…"></textarea><div id="rer"></div>
      <button class="btn gold">File Response</button><button class="btn ghost" type="button" id="waive">Waive Response</button></form>`;
  else h += `<p class="muted">Awaiting the response of ${esc(c[ap.by === 'a' ? 'b' : 'a'].name)}. This page updates automatically.</p>`;
  return h + '</div>';
}
function record(c) {
  let h = `<div class="card"><h3>The Record</h3>`;
  for (const s of ['a', 'b']) if (c[s].statement) h += `<details><summary>Statement of the ${roleOf(s)}, ${esc(c[s].name)}</summary><div class="stmtbox" style="margin-top:8px">${esc(c[s].statement)}</div></details>`;
  if (c.examination) for (const s of ['a', 'b']) h += `<details><summary>Cross-examination of the ${roleOf(s)}</summary>${c.examination[s].q.map((q, i) => `<div class="q"><strong>Q${i + 1}.</strong> ${esc(q)}</div><div class="stmtbox">${esc(c.examination[s].a[i])}</div>`).join('')}</details>`;
  h += `<details ${c.ruling ? '' : 'open'}><summary>Exhibits (${c.exhibits.length})</summary>${exhibitsHTML(c.exhibits)}</details></div>`;
  return h;
}

async function caseView(id, seq) {
  clearTimeout(pollTimer);
  if (!B.mine(id)) { $app.innerHTML = `<div class="card"><h2>Access restricted</h2><p class="muted">Only the two parties can view this case file. Open it on the device you used to file or join it, or use your private link.</p><a class="btn" href="#/">Home</a></div>`; return; }
  if (!$app.querySelector('.parties')) loading('Opening the case file…');
  let c; try { c = await B.getCase(id); } catch (e) { if (seq !== routeSeq) return; $app.innerHTML = `<div class="card"><h2>Unable to open case</h2><p class="muted">${esc(e.message)}</p><button class="btn" id="again">Try again</button></div>`; document.getElementById('again').onclick = () => caseView(id, seq); return; }
  if (seq !== routeSeq) return;
  const me = c[c.you], ot = c[c.you === 'a' ? 'b' : 'a'];
  let h = header(c), poll = true, pollMs = 6000;
  const working = { exam: ['The Court Is Reviewing the Filings', 'The judge is preparing cross-examination questions for both parties. This usually takes under a minute.'], ruling: ['The Court Is Deliberating', 'The judge is weighing the record and drafting the judgment. This usually takes about a minute.'], appeal: ['The Appellate Division Is Deliberating', 'The appeal is under review.'] }[c.working];
  if (c.error) { h += `<div class="card"><div class="err">${esc(c.error)}</div><button class="btn" id="retry">Retry</button></div>`; poll = false; }
  else if (working) h += waiting(...working);
  else if (c.phase === 'pleadings') {
    if (!me.submitted) { h += shareCard(c) + fileForm(c); poll = false; }
    else if (c.waiting_reveal) h += waiting('Both Sides Have Filed', `Your filing is unsealed. The court is waiting for ${esc(ot.name)} to open the case, which unseals their side. Then cross-examination begins. This page updates automatically.`);
    else h += shareCard(c) + waiting('Your Side Is Filed', `The court is awaiting the filing of ${esc(ot.name)}. Come back any time; this page also updates automatically.`);
  } else if (c.phase === 'examination') {
    if (!c.i_answered) { h += examForm(c); poll = false; } else h += waiting('Cross-Examination in Progress', `Your answers are on the record. The court is awaiting the answers of ${esc(ot.name)}.`);
  }
  if (c.ruling && !working) {
    if (c.appeal_ruling) h += appellateHTML(c.appeal_ruling, c.a.name, c.b.name, c.appeal.by, c.appeal_ruled_at);
    const su = link(c.share_url);
    h += `<div class="card ruling">${c.appeal_ruling && c.appeal_ruling.disposition === 'overturned' ? '<div class="notice" style="margin:0 0 10px">This trial judgment was <strong>overturned on appeal</strong>. See the Ruling on Appeal above.</div>' : ''}${judgmentHTML(c.ruling, c.a.name, c.b.name, c.ruled_at)}${NOTICE}
      <div class="row"><a class="btn ghost" href="${c.share_url}">Formal Judgment</a><button class="btn" data-share="${esc(su)}" data-text="Judgment in Case No. ${esc(c.case_number)}:">Share</button></div>
      <button class="btn ghost" id="explain">✨ Explain this judgment in plain words</button></div>`;
    h += appealStatus(c) + appealCard(c) + juryCard(c);
    poll = c.phase === 'appeal_response' || (c.phase === 'judgment' && !c.appeal && !c.can_appeal) || !!c.appeal && !c.appeal_ruling;
    pollMs = 12000;
  }
  if (c.a.statement || c.b.statement) h += record(c);
  h += privCard(c);
  $app.innerHTML = h;
  window.__courtCase = c;

  const sf = document.getElementById('sf');
  if (sf) { bindFiles(sf); sf.onsubmit = async e => { e.preventDefault(); const b = sf.querySelector('button.gold'); b.disabled = true;
    try { const images = await collectImages(sf, b); b.textContent = 'Filing…'; await B.submit(id, { statement: sf.elements.statement.value, evidence_text: sf.elements.evidence_text.value, jury: sf.elements.jury.checked, images }); caseView(id, seq); }
    catch (err) { showErr('er', err); b.disabled = false; b.textContent = 'File My Side'; } }; }
  const qf = document.getElementById('qf');
  if (qf) qf.onsubmit = async e => { e.preventDefault(); const b = qf.querySelector('button'); b.disabled = true; b.textContent = 'Submitting…';
    try { await B.answer(id, c.my_questions.map((_, i) => qf.elements['a' + i].value)); caseView(id, seq); } catch (err) { showErr('er', err); b.disabled = false; b.textContent = 'Submit Answers'; } };
  const apf = document.getElementById('apf');
  if (apf) { bindFiles(apf); apf.onsubmit = async e => { e.preventDefault(); const b = apf.querySelector('button.gold'); b.disabled = true;
    try { const images = await collectImages(apf, b); b.textContent = 'Filing…'; await B.fileAppeal(id, { argument: apf.elements.argument.value, evidence_text: apf.elements.evidence_text.value, images }); caseView(id, seq); } catch (err) { showErr('aer', err); b.disabled = false; b.textContent = 'File Appeal'; } }; }
  const rf = document.getElementById('rf');
  if (rf) { const send = async body => { try { await B.respondAppeal(id, body); caseView(id, seq); } catch (err) { showErr('rer', err); } };
    rf.onsubmit = e => { e.preventDefault(); send({ response: rf.elements.response.value }); };
    document.getElementById('waive').onclick = () => { if (confirm('Waive your response? The appeal will be decided without it.')) send({ waive: true }); }; }
  const jo = document.getElementById('jo');
  if (jo) jo.onchange = async () => { jo.disabled = true; await B.setJury(id, jo.checked).catch(() => {}); caseView(id, seq); };
  const rt = document.getElementById('retry');
  if (rt) rt.onclick = async () => { rt.disabled = true; rt.textContent = 'Retrying…'; B.clearError(id); await B.advance(id, true).catch(() => {}); caseView(id, seq); };
  const ex = document.getElementById('explain');
  if (ex) ex.onclick = () => window.AIHelper && AIHelper.open(`Explain this judgment to me in plain, simple words, and what my options are next. The verdict: ${verdictName((c.appeal_ruling || c.ruling).verdict, c.a.name, c.b.name)}. ${c.ruling.verdict_statement} Order: ${(c.appeal_ruling || c.ruling).order}`);
  // Move the case forward from this device if it can (unseal, or run the AI judge).
  if (!c.error && seq === routeSeq) {
    B.advance(id).then(changed => { if (changed && seq === routeSeq) caseView(id, seq); }).catch(() => {});
  }
  if (poll) pollTimer = setTimeout(async () => {
    if (seq !== routeSeq) return;
    if (B.isWorking(id)) { pollTimer = setTimeout(() => caseView(id, seq), 4000); return; }
    caseView(id, seq);
  }, pollMs);
}
async function judgmentPage(share) {
  loading('Fetching the judgment…');
  let j; try { j = await B.judgment(share); } catch (e) { $app.innerHTML = `<div class="card"><h2>Judgment not found</h2><p class="muted">The link may be wrong, or the network is slow. Try again in a moment.</p><a class="btn" href="#/">Home</a></div>`; return; }
  const ex = (j.exhibits || []).map(e => `<li><span class="cite">${esc(e.label)}</span> ${e.kind === 'text' ? 'Written evidence' : 'Image'} tendered by the ${roleOf(e.side)}${e.stage === 'appeal' ? ' on appeal' : ''}</li>`).join('');
  $app.innerHTML = `<div class="card ruling">${caption({ case_number: j.case_number, title: j.title, a: j.a_name, b: j.b_name, sub: 'Copy of judgment · read-only' })}</div>
    ${j.appeal_ruling ? appellateHTML(j.appeal_ruling, j.a_name, j.b_name, j.appeal.by, j.appeal_ruled_at) : ''}
    <div class="card ruling">${judgmentHTML(j.ruling, j.a_name, j.b_name, j.ruled_at)}<section><h3>Index of Exhibits</h3><ul>${ex || '<li>None</li>'}</ul></section>${NOTICE}</div>
    <div class="row"><button class="btn gold" data-share="${esc(location.href)}" data-text="Judgment in Case No. ${esc(j.case_number)}:">Share</button><button class="btn ghost" style="background:var(--paper)" id="pr">Print</button></div>`;
  document.getElementById('pr').onclick = () => window.print();
}
async function juryPage(pub) {
  loading('Fetching the case…');
  let j; try { j = await B.juryCase(pub); } catch (e) { $app.innerHTML = `<div class="card"><h2>Not on the docket</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="#/docket">Public Docket</a></div>`; return; }
  const exam = xs => (xs || []).map((x, i) => `<div class="q"><strong>Q${i + 1}.</strong> ${esc(x.q)}</div><div class="stmtbox">${esc(x.a)}</div>`).join('');
  const fv = j.appeal_ruling ? j.appeal_ruling.verdict : j.ruling.verdict;
  const tallyHTML = t => { const p = n => (t.total ? Math.round(100 * n / t.total) : 0);
    return `<div class="compare"><div><div class="k">The Judge</div><div class="val">${esc(verdictName(fv, 'Plaintiff', 'Defendant').replace(/, .*/, ''))}</div></div><div><div class="k">The Public (${t.total})</div><div class="val">${t.total ? esc(verdictName(topOf(t), 'P', 'D').replace(/, .*/, '')) : 'No votes yet'}</div></div></div>
      ${[['Plaintiff', t.A], ['Defendant', t.B], ['Split', t.split]].map(([k, n]) => `<div class="muted" style="font-size:13px">${k}: ${p(n)}% (${n})</div><div class="bar"><i style="width:${p(n)}%"></i></div>`).join('')}`; };
  const juryBox = () => j.is_party ? `<p class="muted" style="margin-top:0">You are a party to this case, so you can't vote. Share it so others can.</p>${tallyHTML(j.tally)}`
    : j.my_vote ? `<p class="muted" style="margin-top:0">You voted: <strong>${esc(verdictName(j.my_vote, 'Plaintiff', 'Defendant').replace(/, .*/, ''))}</strong>.</p>${tallyHTML(j.tally)}`
    : `<p class="muted" style="margin-top:0">Read the record below, then cast your vote. Results, and the judge's verdict, are revealed after you vote.</p><div class="vote3"><button class="btn" data-v="A">Plaintiff</button><button class="btn" data-v="split">Split</button><button class="btn" data-v="B">Defendant</button></div><div id="ver"></div>`;
  const render = () => {
    const shown = j.my_vote || j.is_party;
    $app.innerHTML = `<div class="card">${caption({ case_number: j.case_number, title: j.title, a: 'Plaintiff', b: 'Defendant', anon: true, sub: 'Public jury · names anonymised · image exhibits withheld' })}</div>
    <div class="card" id="jury"><div class="eyebrow">You are the jury</div><h2>Who was right?</h2>${juryBox()}</div>
    <div class="card"><h3>Statement of the Plaintiff</h3><div class="stmtbox">${esc(j.plaintiff.statement)}</div><details><summary>Cross-examination of the Plaintiff</summary>${exam(j.plaintiff.exam)}</details></div>
    <div class="card"><h3>Statement of the Defendant</h3><div class="stmtbox">${esc(j.defendant.statement)}</div><details><summary>Cross-examination of the Defendant</summary>${exam(j.defendant.exam)}</details></div>
    <div class="card"><h3>Exhibits</h3>${exhibitsHTML(j.exhibits || [], { withheld: true })}</div>
    ${shown ? `${j.appeal_ruling ? appellateHTML(j.appeal_ruling, 'Plaintiff', 'Defendant', j.appeal_by, null) : ''}<div class="card ruling">${judgmentHTML(j.ruling, 'Plaintiff', 'Defendant', j.ruled_at)}${NOTICE}</div>` : ''}
    <div class="navlinks"><a href="#/docket">← Public Docket</a></div>`;
    document.querySelectorAll('[data-v]').forEach(b => b.onclick = async () => {
      document.querySelectorAll('[data-v]').forEach(x => x.disabled = true);
      try { j.tally = await B.vote(pub, b.dataset.v, j.parties); j.my_vote = b.dataset.v; render(); document.getElementById('jury').scrollIntoView(); }
      catch (e) { showErr('ver', e); document.querySelectorAll('[data-v]').forEach(x => x.disabled = false); }
    });
  };
  render();
}
async function docketPage() {
  loading('Loading the public docket…');
  let rows = [], failed = false; try { rows = await B.docket(); } catch (e) { failed = true; }
  $app.innerHTML = `<div class="hero" style="padding-bottom:10px"><div class="eyebrow">Open to the public</div><h1>The Public Docket</h1><p>Cases whose parties both consented to a public jury. Names are anonymised. Read the record and cast your vote.</p></div>
    <div class="card docket">${rows.length ? rows.map(r => `<a href="#/jury/${esc(r.public_id)}"><div class="cn">Case No. ${esc(r.case_number)}</div><div class="tt">${esc(r.title)}</div>
      <div class="muted" style="font-size:13px">${r.appealed ? `Appeal ${esc(r.disposition)} · ` : ''}${r.tally.total} jury vote${r.tally.total === 1 ? '' : 's'} · ${esc(fmtDate(r.ruled_at))}</div></a>`).join('') : `<p class="muted">${failed ? 'Could not reach the network. Check your internet and try again.' : 'No public cases yet. When two parties both opt in to the public jury, their case will appear here.'}</p>`}</div>
    <a class="btn gold" href="#/new">File a New Case</a>`;
}
route();
