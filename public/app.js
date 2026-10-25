const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tokKey = id => 'court:' + id;
let pollTimer = null;
const fmtDate = d => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';

function nav(p) { history.pushState({}, '', p); route(); window.scrollTo(0, 0); }
window.addEventListener('popstate', route);
document.addEventListener('click', e => { const a = e.target.closest('a[data-nav]'); if (a) { e.preventDefault(); nav(a.getAttribute('href')); } });

async function api(url, opts = {}, token) {
  const headers = opts.headers || {};
  if (token) headers['x-case-token'] = token;
  if (opts.json) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
  const r = await fetch(url, { ...opts, headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(r.status === 402 ? `Payment required${j.price && j.price !== '0' ? ' (' + j.price + ')' : ''}. Payments are not yet available.` : j.error || 'Something went wrong.'), { data: j, status: r.status });
  return j;
}
const showErr = (id, e) => { const el = document.getElementById(id); if (el) el.innerHTML = `<div class="err">${esc(e.message || e)}</div>`; };

async function route() {
  clearInterval(pollTimer);
  const p = location.pathname; let m;
  if ((m = p.match(/^\/case\/(\w+)/))) {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('t')) { localStorage.setItem(tokKey(m[1]), h.get('t')); history.replaceState({}, '', p); }
    return caseView(m[1]);
  }
  if ((m = p.match(/^\/join\/(\w+)/))) return joinView(m[1].toUpperCase());
  if ((m = p.match(/^\/judgment\/(\w+)/))) return judgmentPage(m[1]);
  if ((m = p.match(/^\/jury\/(\w+)/))) return juryPage(m[1]);
  if (p === '/docket') return docketPage();
  if (p === '/new') return newView();
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
  return `${r.engine === 'demo' ? '<div class="demo"><strong>Demo judge.</strong> This judgment came from a placeholder rule, not AI. It does not weigh what either side actually said.</div>' : ''}
    <div class="eyebrow" style="text-align:center">Judgment of the Court${when ? ' · ' + esc(fmtDate(when)) : ''}</div>
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
    ${ar.engine === 'demo' ? '<div class="demo"><strong>Demo appellate court.</strong> Placeholder rule, not AI.</div>' : ''}
    <div class="eyebrow" style="text-align:center">Appellate Division${when ? ' · ' + esc(fmtDate(when)) : ''}</div>
    <h2>Ruling on Appeal</h2>
    <p class="muted" style="text-align:center;margin:0">Appeal brought by the ${roleOf(by)}, ${esc(by === 'a' ? a : b)}</p>
    <div style="text-align:center;margin:12px 0"><span class="disp ${ar.disposition}">JUDGMENT ${ar.disposition.toUpperCase()}</span></div>
    <div class="verdict"><div class="lbl">Final Outcome</div><div class="res">${esc(verdictName(ar.verdict, a, b))}</div></div>
    <section><h3>Summary</h3>${paras(ar.summary)}</section>
    <section class="reasoning"><h3>Reasoning</h3>${paras(ar.reasoning)}</section>
    <section><h3>Order</h3><div class="order"><div class="lbl">IT IS SO ORDERED</div>${paras(ar.order)}</div></section></div>`;
}
function exhibitsHTML(list, token, opts = {}) {
  if (!list.length) return '<p class="muted">No exhibits were tendered.</p>';
  return list.map(e => `<div class="ex"><span class="tag">${esc(e.label)}</span>${e.url && token ? `<a href="${e.url}?t=${token}" target="_blank"><img src="${e.url}?t=${token}" alt="Exhibit ${esc(e.label)}"></a>` : ''}
    <div class="tx">${e.kind === 'text' ? esc(e.text || '(written evidence)') : e.url && token ? '<span class="muted">Image</span>' : `<span class="muted">Image exhibit${opts.withheld ? ' (withheld from public view)' : ''}</span>`}${e.stage === 'appeal' ? ' <span class="badge">On appeal</span>' : ''}</div></div>`).join('');
}
const NOTICE = '<div class="notice">This judgment is a neutral opinion offered to help the parties resolve their disagreement. It is not legally binding and is not legal advice.</div>';
const waiting = (t, m) => `<div class="card center"><div class="gavel">🔨</div><h2>${t}</h2><p class="muted">${m}</p></div>`;

// ---------- pages ----------
function home() {
  $app.innerHTML = `<div class="hero"><div class="eyebrow">A neutral forum</div><h1>Have a disagreement?<br>Take it to Court.</h1>
    <p>Each side files a statement and numbered exhibits. The judge cross-examines both parties, then issues a formal written judgment. One appeal is allowed.</p></div>
  <div class="card"><h3>How it works</h3><ol class="steps">
    <li>The Plaintiff opens a case and summons the Defendant with a link.</li>
    <li>Each side files privately. Evidence becomes exhibits (P-1, D-1…).</li>
    <li>The judge cross-examines both parties (1–3 questions each).</li>
    <li>A formal judgment is entered: findings, conclusions, verdict and order.</li>
    <li>The losing party may appeal once. Both may opt in to a public jury.</li></ol>
    <a class="btn gold" href="/new" data-nav>File a New Case</a></div>
  <div class="card"><h3>Were you summoned?</h3><p class="muted" style="margin:0">Enter the case code you were sent.</p>
    <form id="jf"><input type="text" id="code" placeholder="e.g. K7Q2MX" autocapitalize="characters" maxlength="6" style="text-transform:uppercase;letter-spacing:.2em;margin-top:10px"><button class="btn">Go to Case</button></form></div>
  <div class="navlinks"><a href="/docket" data-nav>Browse the Public Docket →</a></div>`;
  document.getElementById('jf').onsubmit = e => { e.preventDefault(); const c = document.getElementById('code').value.trim(); if (c) nav('/join/' + c.toUpperCase()); };
}

function newView() {
  $app.innerHTML = `<div class="card"><div class="eyebrow">New matter</div><h2>File a Case</h2>
    <form id="nf"><label>What is the dispute about?</label><input type="text" name="title" maxlength="120" placeholder="e.g. Payment for a broken lamp" required>
      <label>Your name <span class="opt">(Plaintiff)</span></label><input type="text" name="a_name" maxlength="60" required>
      <label>The other party's name <span class="opt">(Defendant)</span></label><input type="text" name="b_name" maxlength="60" required>
      <div id="er"></div><button class="btn gold">Open Case</button></form></div>`;
  document.getElementById('nf').onsubmit = async e => {
    e.preventDefault(); const b = e.target.querySelector('button'); b.disabled = true;
    try { const r = await api('/api/cases', { method: 'POST', json: Object.fromEntries(new FormData(e.target)) }); localStorage.setItem(tokKey(r.id), r.token); nav('/case/' + r.id); }
    catch (err) { showErr('er', err); b.disabled = false; }
  };
}

async function joinView(code) {
  let info;
  try { info = await api('/api/join/' + code); } catch (e) { $app.innerHTML = `<div class="card"><h2>Case not found</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="/" data-nav>Back</a></div>`; return; }
  if (localStorage.getItem(tokKey(info.id))) return nav('/case/' + info.id);
  if (info.b_joined) { $app.innerHTML = `<div class="card">${caption({ ...info, a: info.a_name, b: info.b_name })}<p class="muted">The Defendant has already joined this case from another device. Please open it on the device you joined with.</p></div>`; return; }
  $app.innerHTML = `<div class="card"><div class="eyebrow" style="text-align:center">Summons</div>${caption({ ...info, a: info.a_name, b: info.b_name })}
    <p>${esc(info.a_name)} has brought this matter before the court and named you, <strong>${esc(info.b_name)}</strong>, as Defendant. You will file your side privately; the Plaintiff will not see it until both sides have filed.</p>
    <div id="er"></div><button class="btn gold" id="jb">I am ${esc(info.b_name)}. Enter Court</button></div>`;
  document.getElementById('jb').onclick = async e => {
    e.target.disabled = true;
    try { const r = await api('/api/join/' + code, { method: 'POST' }); localStorage.setItem(tokKey(r.id), r.token); nav('/case/' + r.id); } catch (err) { showErr('er', err); }
  };
}

function partyChip(c, s) {
  const p = c[s], st = p.submitted ? '<span class="ok">✓ Filed</span>' : s === 'b' && !c.b_joined ? '<span class="wait">Not yet summoned</span>' : '<span class="wait">Preparing</span>';
  return `<div class="party"><div class="who">${roleOf(s)} ${c.you === s ? '<span class="you">(YOU)</span>' : ''}</div><div class="nm">${esc(p.name)}</div><div class="st">${st}</div></div>`;
}
const header = c => `<div class="card">${caption({ case_number: c.case_number, title: c.title, a: c.a.name, b: c.b.name })}<div class="parties">${partyChip(c, 'a')}<div class="vs">v.</div>${partyChip(c, 'b')}</div></div>`;

function shareCard(c) {
  if (c.you !== 'a' || c.b_joined) return '';
  return `<div class="card"><h3>Summon ${esc(c.b.name)}</h3><p class="muted" style="margin:0">Send this link or code so ${esc(c.b.name)} can file their side.</p>
    <div class="code">${esc(c.code)}</div><div class="linkbox">${esc(location.origin + '/join/' + c.code)}</div>
    <div class="row"><button class="btn" data-share="${esc(location.origin + '/join/' + c.code)}" data-text="${esc(`${c.a.name} has filed "${c.title}" in Court (Case No. ${c.case_number}) and named you as Defendant. File your side here:`)}">Share Link</button><button class="btn ghost" data-copy="${esc(location.origin + '/join/' + c.code)}">Copy</button></div></div>`;
}
document.addEventListener('click', async e => {
  const cp = e.target.closest('[data-copy]'), sh = e.target.closest('[data-share]');
  if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); cp.textContent = 'Copied'; } catch { cp.textContent = 'Copy failed'; } }
  if (sh) { if (navigator.share) { try { await navigator.share({ title: 'Court', text: sh.dataset.text || '', url: sh.dataset.share }); } catch {} } else { try { await navigator.clipboard.writeText((sh.dataset.text ? sh.dataset.text + ' ' : '') + sh.dataset.share); sh.textContent = 'Copied'; } catch {} } }
});

function fileForm(c) {
  const pre = c.you === 'a' ? 'P' : 'D';
  return `<div class="card"><div class="eyebrow">Your filing as ${roleOf(c.you)}</div><h2>State Your Case</h2>
    <p class="muted" style="margin-top:0">Be factual and specific: dates, amounts, what was said. ${esc(c[c.you === 'a' ? 'b' : 'a'].name)} won't see this until both sides have filed.</p>
    <form id="sf"><label>Your statement</label><textarea name="statement" maxlength="6000" required placeholder="What happened, and why you believe you are in the right…"></textarea>
      <label>Written evidence <span class="opt">(optional, becomes Exhibit ${pre}-1)</span></label>
      <textarea name="evidence_text" maxlength="4000" style="min-height:90px" placeholder="Paste messages, a timeline, amounts, witness names…"></textarea>
      <label>Photos &amp; screenshots <span class="opt">(optional, up to 6, numbered as exhibits)</span></label>
      <label class="file" id="fl"><input type="file" name="images" accept="image/*" multiple><span>📎 Tap to add screenshots, receipts or photos</span></label><div class="thumbs" id="th"></div>
      <label class="check"><input type="checkbox" name="jury"><span><strong>Opt in to the public jury.</strong> If both parties agree, an anonymised version of this case (names removed, images withheld) appears on the public docket, where visitors can vote.</span></label>
      <div id="er"></div><button class="btn gold">File My Side</button><p class="muted" style="font-size:12px;text-align:center">Once filed, your statement cannot be edited.</p></form></div>`;
}
function bindFiles(form) {
  const inp = form.querySelector('input[type=file]'), th = form.querySelector('.thumbs'), lab = form.querySelector('.file span');
  if (inp) inp.onchange = () => { const f = [...inp.files].slice(0, 6); th.innerHTML = f.map(x => `<img src="${URL.createObjectURL(x)}" alt="">`).join(''); lab.textContent = f.length ? `${f.length} image(s) selected. Tap to change` : '📎 Tap to add screenshots, receipts or photos'; };
}

function examForm(c) {
  return `<div class="card"><div class="eyebrow">From the bench</div><h2>Cross-Examination</h2>
    <p class="muted" style="margin-top:0">The court puts the following questions to you, ${esc(c[c.you].name)}. Answers are required and become part of the record.</p>
    <form id="qf">${c.my_questions.map((q, i) => `<div class="q"><strong>Q${i + 1}.</strong> ${esc(q)}</div><textarea name="a${i}" maxlength="2000" style="min-height:90px" required></textarea>`).join('')}
    <div id="er"></div><button class="btn gold">Submit Answers</button></form></div>`;
}

function juryCard(c) {
  const me = c[c.you], ot = c[c.you === 'a' ? 'b' : 'a'];
  let body = `<label class="check"><input type="checkbox" id="jo" ${me.jury ? 'checked' : ''}><span>I consent to an anonymised public jury for this case.</span></label>
    <p class="muted" style="font-size:13px;margin:8px 0 0">${esc(ot.name)}: ${ot.jury ? '<span class="ok">consented</span>' : 'has not consented'}. The case goes public only if both consent.</p>`;
  if (c.jury) {
    const t = c.jury.tally, pct = n => (t.total ? Math.round(100 * n / t.total) : 0), fv = c.appeal_ruling ? c.appeal_ruling.verdict : c.ruling.verdict;
    body = `<div class="compare"><div><div class="k">Judge</div><div class="val">${esc(verdictName(fv, 'Plaintiff', 'Defendant').replace(/, .*/, ''))}</div></div><div><div class="k">Public jury (${t.total})</div><div class="val">${t.total ? esc(verdictName(['A', 'B', 'split'].sort((x, y) => t[y] - t[x])[0], 'P', 'D').replace(/, .*/, '')) : 'No votes yet'}</div></div></div>
      <p class="muted" style="font-size:13px">Plaintiff ${pct(t.A)}% · Defendant ${pct(t.B)}% · Split ${pct(t.split)}%</p>
      <div class="row"><a class="btn ghost" href="${c.jury.url}" data-nav>View Public Page</a><button class="btn" data-share="${esc(location.origin + c.jury.url)}" data-text="Be the jury on Case No. ${esc(c.case_number)}:">Share</button></div>` + body;
  }
  return `<div class="card"><h3>Public Jury</h3>${body}</div>`;
}

function appealCard(c) {
  if (c.appeal || !c.ruling) return '';
  if (!c.can_appeal) return `<div class="card"><h3>Appeal</h3><p class="muted" style="margin:0">Only the losing party may appeal, once. ${c.ruling.verdict === (c.you === 'a' ? 'A' : 'B') ? 'The judgment was entered in your favour.' : ''}</p></div>`;
  return `<div class="card"><div class="eyebrow">Right of appeal</div><h2>File an Appeal</h2>
    <p class="muted" style="margin-top:0">You may appeal once to the Appellate Division. Set out where you believe the court went wrong and add any new evidence. ${esc(c[c.you === 'a' ? 'b' : 'a'].name)} may respond before the appeal is decided.${c.paywall ? ' <strong>A fee applies.</strong>' : ''}</p>
    <form id="apf"><label>Grounds of appeal</label><textarea name="argument" maxlength="6000" required placeholder="The court erred because…"></textarea>
      <label>New written evidence <span class="opt">(optional)</span></label><textarea name="evidence_text" maxlength="4000" style="min-height:80px"></textarea>
      <label>New images <span class="opt">(optional)</span></label><label class="file"><input type="file" name="images" accept="image/*" multiple><span>📎 Tap to add new exhibits</span></label><div class="thumbs"></div>
      <div id="aer"></div><button class="btn gold">File Appeal</button></form></div>`;
}
function appealStatus(c) {
  const ap = c.appeal; if (!ap) return '';
  const byName = c[ap.by].name, iAmAppellant = ap.by === c.you;
  let h = `<div class="card"><div class="eyebrow">Appellate Division</div><h3>Appeal by the ${roleOf(ap.by)}, ${esc(byName)}</h3><div class="stmtbox">${esc(ap.argument)}</div>`;
  if (ap.responded) h += ap.waived ? `<p class="muted">The respondent waived a response.</p>` : `<label>Response of the ${roleOf(ap.by === 'a' ? 'b' : 'a')}</label><div class="stmtbox">${esc(ap.response)}</div>`;
  else if (!iAmAppellant) h += `<form id="rf"><label>Your response to the appeal</label><textarea name="response" maxlength="6000" placeholder="Why the judgment should stand…"></textarea><div id="rer"></div>
      <button class="btn gold">File Response</button><button class="btn ghost" type="button" id="waive">Waive Response</button></form>`;
  else h += `<p class="muted">Awaiting the response of ${esc(c[ap.by === 'a' ? 'b' : 'a'].name)}.</p>`;
  return h + '</div>';
}

function record(c, token) {
  let h = `<div class="card"><h3>The Record</h3>`;
  for (const s of ['a', 'b']) if (c[s].statement) h += `<details><summary>Statement of the ${roleOf(s)}, ${esc(c[s].name)}</summary><div class="stmtbox" style="margin-top:8px">${esc(c[s].statement)}</div></details>`;
  if (c.examination) for (const s of ['a', 'b']) h += `<details><summary>Cross-examination of the ${roleOf(s)}</summary>${c.examination[s].q.map((q, i) => `<div class="q"><strong>Q${i + 1}.</strong> ${esc(q)}</div><div class="stmtbox">${esc(c.examination[s].a[i])}</div>`).join('')}</details>`;
  h += `<details ${c.ruling ? '' : 'open'}><summary>Exhibits (${c.exhibits.length})</summary>${exhibitsHTML(c.exhibits, token)}</details></div>`;
  return h;
}

async function caseView(id) {
  clearInterval(pollTimer);
  const token = localStorage.getItem(tokKey(id));
  if (!token) { $app.innerHTML = `<div class="card"><h2>Access restricted</h2><p class="muted">Only the two parties can view this case file. Open it on the device you used to file or join it.</p><a class="btn" href="/" data-nav>Home</a></div>`; return; }
  let c; try { c = await api('/api/cases/' + id, {}, token); } catch (e) { $app.innerHTML = `<div class="card"><h2>Unable to open case</h2><p class="muted">${esc(e.message)}</p></div>`; return; }
  const me = c[c.you], ot = c[c.you === 'a' ? 'b' : 'a'];
  let h = header(c), poll = true;
  const working = { exam: ['The Court Is Reviewing the Filings', 'The judge is preparing cross-examination questions for both parties.'], ruling: ['The Court Is Deliberating', 'The judge is weighing the record and drafting the judgment.'], appeal: ['The Appellate Division Is Deliberating', 'The appeal is under review.'] }[c.working];
  if (c.error) { h += `<div class="card"><div class="err">${esc(c.error)}</div><button class="btn" id="retry">Retry</button></div>`; poll = false; }
  else if (working) h += waiting(...working);
  else if (c.phase === 'pleadings') {
    if (!me.submitted) { h += shareCard(c) + fileForm(c); poll = false; }
    else h += shareCard(c) + waiting('Your Side Is Filed', `The court is awaiting the filing of ${esc(ot.name)}. This page updates automatically.`) + (c.you === 'a' ? `<div class="card"><h3>Your private link</h3><p class="muted" style="margin:0">Reopen this case on another device. Don't share it; it lets anyone act as you.</p><button class="btn ghost" data-copy="${esc(location.origin + '/case/' + id + '#t=' + token)}">Copy My Private Link</button></div>` : '');
  } else if (c.phase === 'examination') {
    if (!c.i_answered) { h += examForm(c); poll = false; } else h += waiting('Cross-Examination in Progress', `Your answers are on the record. The court is awaiting the answers of ${esc(ot.name)}.`);
  }
  if (c.ruling && !working) {
    if (c.appeal_ruling) h += appellateHTML(c.appeal_ruling, c.a.name, c.b.name, c.appeal.by, c.appeal_ruled_at);
    h += `<div class="card ruling">${c.appeal_ruling && c.appeal_ruling.disposition === 'overturned' ? '<div class="notice" style="margin:0 0 10px">This trial judgment was <strong>overturned on appeal</strong>. See the Ruling on Appeal above.</div>' : ''}${judgmentHTML(c.ruling, c.a.name, c.b.name, c.ruled_at)}${NOTICE}
      <div class="row"><a class="btn ghost" href="${c.share_url}" data-nav>Formal Judgment</a><button class="btn" data-share="${esc(location.origin + c.share_url)}" data-text="Judgment in Case No. ${esc(c.case_number)}:">Share</button></div></div>`;
    h += appealStatus(c) + appealCard(c) + juryCard(c);
    poll = c.phase === 'appeal_response' && c.appeal && c.appeal.by === c.you;
  }
  if (c.a.statement || c.b.statement) h += record(c, token);
  if (!c.judge_live) h += `<div class="demo">Demo mode: no AI judge (Grok) is configured on this server, so rulings come from a placeholder rule.</div>`;
  $app.innerHTML = h;

  const sf = document.getElementById('sf');
  if (sf) { bindFiles(sf); sf.onsubmit = async e => { e.preventDefault(); const b = sf.querySelector('button.gold'); b.disabled = true; b.textContent = 'Filing…';
    try { await api(`/api/cases/${id}/submit`, { method: 'POST', body: new FormData(sf) }, token); caseView(id); } catch (err) { showErr('er', err); b.disabled = false; b.textContent = 'File My Side'; } }; }
  const qf = document.getElementById('qf');
  if (qf) qf.onsubmit = async e => { e.preventDefault(); const b = qf.querySelector('button'); b.disabled = true;
    try { await api(`/api/cases/${id}/answer`, { method: 'POST', json: { answers: c.my_questions.map((_, i) => qf.elements['a' + i].value) } }, token); caseView(id); } catch (err) { showErr('er', err); b.disabled = false; } };
  const apf = document.getElementById('apf');
  if (apf) { bindFiles(apf); apf.onsubmit = async e => { e.preventDefault(); const b = apf.querySelector('button.gold'); b.disabled = true;
    try { await api(`/api/cases/${id}/appeal`, { method: 'POST', body: new FormData(apf) }, token); caseView(id); } catch (err) { showErr('aer', err); b.disabled = false; } }; }
  const rf = document.getElementById('rf');
  if (rf) { const send = async body => { try { await api(`/api/cases/${id}/appeal/respond`, { method: 'POST', json: body }, token); caseView(id); } catch (err) { showErr('rer', err); } };
    rf.onsubmit = e => { e.preventDefault(); send({ response: rf.elements.response.value }); };
    document.getElementById('waive').onclick = () => { if (confirm('Waive your response? The appeal will be decided without it.')) send({ waive: true }); }; }
  const jo = document.getElementById('jo');
  if (jo) jo.onchange = async () => { await api(`/api/cases/${id}/jury`, { method: 'POST', json: { optin: jo.checked } }, token).catch(() => {}); caseView(id); };
  const rt = document.getElementById('retry');
  if (rt) rt.onclick = async () => { rt.disabled = true; await api(`/api/cases/${id}/retry`, { method: 'POST' }, token).catch(() => {}); setTimeout(() => caseView(id), 400); };
  if (poll) pollTimer = setInterval(async () => {
    try { const n = await api('/api/cases/' + id, {}, token);
      const sig = x => [x.phase, x.working, x.error, x.a.submitted, x.b.submitted, x.b_joined, x.other_answered, !!x.ruling, x.appeal && x.appeal.responded, !!x.appeal_ruling].join('|');
      if (sig(n) !== sig(c)) caseView(id); } catch {}
  }, 4000);
}

async function judgmentPage(share) {
  let j; try { j = await api('/api/judgment/' + share); } catch (e) { $app.innerHTML = `<div class="card"><h2>Judgment not found</h2></div>`; return; }
  const ex = j.exhibits.map(e => `<li><span class="cite">${esc(e.label)}</span> ${e.kind === 'text' ? 'Written evidence' : 'Image'} tendered by the ${roleOf(e.side)}${e.stage === 'appeal' ? ' on appeal' : ''}</li>`).join('');
  $app.innerHTML = `<div class="card ruling">${caption({ case_number: j.case_number, title: j.title, a: j.a_name, b: j.b_name, sub: 'Certified copy · read-only' })}</div>
    ${j.appeal_ruling ? appellateHTML(j.appeal_ruling, j.a_name, j.b_name, j.appeal.by, j.appeal_ruled_at) : ''}
    <div class="card ruling">${judgmentHTML(j.ruling, j.a_name, j.b_name, j.ruled_at)}<section><h3>Index of Exhibits</h3><ul>${ex || '<li>None</li>'}</ul></section>${NOTICE}</div>
    <div class="row"><button class="btn gold" data-share="${esc(location.href)}" data-text="Judgment in Case No. ${esc(j.case_number)}:">Share</button><button class="btn ghost" style="background:var(--paper)" onclick="window.print()">Print</button></div>`;
}

async function juryPage(pub) {
  let j; try { j = await api('/api/jury/' + pub); } catch (e) { $app.innerHTML = `<div class="card"><h2>Not on the docket</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="/docket" data-nav>Public Docket</a></div>`; return; }
  const exam = xs => xs.map((x, i) => `<div class="q"><strong>Q${i + 1}.</strong> ${esc(x.q)}</div><div class="stmtbox">${esc(x.a)}</div>`).join('');
  const fv = j.appeal_ruling ? j.appeal_ruling.verdict : j.ruling.verdict;
  const tallyHTML = t => { const p = n => (t.total ? Math.round(100 * n / t.total) : 0);
    return `<div class="compare"><div><div class="k">The Judge</div><div class="val">${esc(verdictName(fv, 'Plaintiff', 'Defendant').replace(/, .*/, ''))}</div></div><div><div class="k">The Public (${t.total})</div><div class="val">${esc(verdictName(['A', 'B', 'split'].sort((x, y) => t[y] - t[x])[0], 'P', 'D').replace(/, .*/, ''))}</div></div></div>
      ${[['Plaintiff', t.A], ['Defendant', t.B], ['Split', t.split]].map(([k, n]) => `<div class="muted" style="font-size:13px">${k}: ${p(n)}% (${n})</div><div class="bar"><i style="width:${p(n)}%"></i></div>`).join('')}`; };
  const juryBox = () => j.my_vote ? `<p class="muted" style="margin-top:0">You voted: <strong>${esc(verdictName(j.my_vote, 'Plaintiff', 'Defendant').replace(/, .*/, ''))}</strong>.</p>${tallyHTML(j.tally)}`
    : `<p class="muted" style="margin-top:0">Read the record below, then cast your vote. Results, and the judge's verdict, are revealed after you vote.</p><div class="vote3"><button class="btn" data-v="A">Plaintiff</button><button class="btn" data-v="split">Split</button><button class="btn" data-v="B">Defendant</button></div><div id="ver"></div>`;
  const render = () => {
    $app.innerHTML = `<div class="card">${caption({ case_number: j.case_number, title: j.title, a: 'Plaintiff', b: 'Defendant', anon: true, sub: 'Public jury · names anonymised · image exhibits withheld' })}</div>
    <div class="card" id="jury"><div class="eyebrow">You are the jury</div><h2>Who was right?</h2>${juryBox()}</div>
    <div class="card"><h3>Statement of the Plaintiff</h3><div class="stmtbox">${esc(j.plaintiff.statement)}</div><details><summary>Cross-examination of the Plaintiff</summary>${exam(j.plaintiff.exam)}</details></div>
    <div class="card"><h3>Statement of the Defendant</h3><div class="stmtbox">${esc(j.defendant.statement)}</div><details><summary>Cross-examination of the Defendant</summary>${exam(j.defendant.exam)}</details></div>
    <div class="card"><h3>Exhibits</h3>${exhibitsHTML(j.exhibits, null, { withheld: true })}</div>
    ${j.my_vote ? `${j.appeal_ruling ? appellateHTML(j.appeal_ruling, 'Plaintiff', 'Defendant', j.appeal_by, null) : ''}<div class="card ruling">${judgmentHTML(j.ruling, 'Plaintiff', 'Defendant', j.ruled_at)}${NOTICE}</div>` : ''}
    <div class="navlinks"><a href="/docket" data-nav>← Public Docket</a></div>`;
    document.querySelectorAll('[data-v]').forEach(b => b.onclick = async () => {
      const tokens = Object.keys(localStorage).filter(k => k.startsWith('court:')).map(k => localStorage.getItem(k));
      try { let r; for (const t of tokens.length ? tokens : [null]) r = await api(`/api/jury/${pub}/vote`, { method: 'POST', json: { vote: b.dataset.v } }, t);
        j.my_vote = b.dataset.v; j.tally = r.tally; render(); document.getElementById('jury').scrollIntoView(); } catch (e) { showErr('ver', e); }
    });
  };
  render();
}

async function docketPage() {
  const rows = await api('/api/docket').catch(() => []);
  $app.innerHTML = `<div class="hero" style="padding-bottom:10px"><div class="eyebrow">Open to the public</div><h1>The Public Docket</h1><p>Cases whose parties both consented to a public jury. Names are anonymised. Read the record and cast your vote.</p></div>
    <div class="card docket">${rows.length ? rows.map(r => `<a href="/jury/${r.public_id}" data-nav><div class="cn">Case No. ${esc(r.case_number)}</div><div class="tt">${esc(r.title)}</div>
      <div class="muted" style="font-size:13px">${r.appealed ? `Appeal ${esc(r.disposition)} · ` : ''}${r.tally.total} jury vote${r.tally.total === 1 ? '' : 's'} · ${esc(fmtDate(r.ruled_at))}</div></a>`).join('') : '<p class="muted">No public cases yet.</p>'}</div>`;
}

route();
