// End-to-end test: two mock parties + a public juror, mobile viewport. Usage: node tests/e2e.js [baseURL]
const { chromium } = require('/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://localhost:3300';
const SS = __dirname + '/../screenshots/';
const ok = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const opts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const page = async () => { const p = await (await browser.newContext(opts)).newPage(); p.on('dialog', d => d.accept()); return p; };
  const A = await page(), B = await page(), J = await page();
  const shot = (p, n, full = true) => p.screenshot({ path: SS + n + '.png', fullPage: full });

  await A.goto(BASE); await shot(A, '01-home');
  await A.click('text=File a New Case');
  await A.fill('[name=title]', 'Payment for a broken lamp');
  await A.fill('[name=a_name]', 'Jordan Reyes'); await A.fill('[name=b_name]', 'Sam Okafor');
  await A.click('button:has-text("Open Case")'); await A.waitForSelector('.code');
  const code = (await A.textContent('.code')).trim();
  const cno = (await A.textContent('.cno')).trim(); ok(/^Case No\. \d{4}-\d{6}$/.test(cno), 'formal case number ' + cno);
  ok((await A.textContent('.caption-block')).includes('Plaintiff'), 'caption shows Plaintiff v. Defendant');
  await A.fill('[name=statement]', 'On October 5 Sam was visiting my apartment and knocked over my brass floor lamp while playing with my dog. The lamp shattered. I bought it on October 2 for $120. Sam texted me afterwards admitting it. I want Sam to pay the full $120.');
  await A.fill('[name=evidence_text]', 'Text from Sam, Oct 5 9:14pm: "so sorry I bumped the lamp, I will pay half"');
  await A.setInputFiles('input[type=file]', ['/tmp/receipt.png', '/tmp/text.png']);
  await A.check('input[name=jury]');
  await shot(A, '02-file-side');
  await A.click('button:has-text("File My Side")'); await A.waitForSelector('text=Your Side Is Filed');
  await shot(A, '03-waiting-summons');

  await B.goto(BASE + '/join/' + code); await shot(B, '04-summons');
  await B.click('button:has-text("Enter Court")'); await B.waitForSelector('[name=statement]');
  ok(!(await B.content()).includes('brass floor lamp'), 'fairness: Defendant cannot see Plaintiff statement before filing');
  const caseId = new URL(B.url()).pathname.split('/')[2];
  const tokB = await B.evaluate(id => localStorage.getItem('court:' + id), caseId);
  const imgs = await (await fetch(`${BASE}/api/cases/${caseId}`, { headers: { 'x-case-token': tokB } })).json();
  ok(imgs.exhibits.length === 0 && imgs.a.statement === null, 'fairness: API hides Plaintiff exhibits/statement from Defendant');
  await B.fill('[name=statement]', "The lamp was placed right next to the doorway where anyone could hit it, and Jordan's dog jumped on me. It was an accident. I offered to pay half because the placement was partly Jordan's fault. $60 is fair.");
  await B.check('input[name=jury]');
  await B.click('button:has-text("File My Side")');

  for (const P of [A, B]) await P.waitForSelector('text=Cross-Examination', { timeout: 60000 });
  const nq = await B.locator('#qf .q').count(); ok(nq >= 1 && nq <= 3, `cross-examination required: ${nq} question(s) for Defendant`);
  await shot(B, '05-cross-examination');
  await B.click('button:has-text("Submit Answers")');
  ok(await B.locator('#qf').count() === 1, 'empty answers rejected (required)');
  for (const P of [[A, 'Yes. Exhibit P-2 is the receipt and P-3 is Sam\'s text. My neighbour Pat saw it.'], [B, 'The lamp was in a walkway. I have no photos.']]) {
    const n = await P[0].locator('#qf textarea').count();
    for (let i = 0; i < n; i++) await P[0].fill(`textarea[name=a${i}]`, P[1]);
    await P[0].click('button:has-text("Submit Answers")');
  }
  for (const P of [A, B]) await P.waitForSelector('text=Judgment of the Court', { timeout: 120000 });
  await A.waitForTimeout(500); await shot(A, '06-judgment');
  ok(await A.locator('.cite').count() > 0, 'judgment cites numbered exhibits');
  ok((await A.textContent('main')).includes('IT IS SO ORDERED'), 'judgment has an Order');
  const verdict = (await A.textContent('.verdict .res')).trim(); console.log('  verdict:', verdict);
  ok(await A.locator('#apf').count() === 0, 'winning party cannot appeal');

  // read-only judgment link
  const share = await A.getAttribute('a:has-text("Formal Judgment")', 'href');
  await J.goto(BASE + share); await J.waitForSelector('text=Certified copy');
  ok(await J.locator('textarea, input, #apf').count() === 0, 'read-only judgment page has no inputs');
  await shot(J, '07-formal-judgment-readonly');

  // public jury (both opted in)
  const juryUrl = await B.getAttribute('a:has-text("View Public Page")', 'href'); ok(!!juryUrl, 'public jury page exists (both opted in)');
  await J.goto(BASE + juryUrl); await J.waitForSelector('text=Who was right?');
  const pub = await J.textContent('main'); ok(!/Jordan|Sam|Reyes|Okafor/.test(pub), 'public page is anonymised');
  await shot(J, '08-public-jury-vote');
  await J.click('[data-v=B]'); await J.waitForSelector('text=You voted');
  await J.locator('#jury').screenshot({ path: SS + '09-jury-vs-judge.png' });
  const tokA = await A.evaluate(id => localStorage.getItem('court:' + id), caseId);
  const pv = await fetch(`${BASE}/api/jury/${juryUrl.split('/')[2]}/vote`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-case-token': tokA }, body: '{"vote":"A"}' });
  ok(pv.status === 403, 'a party cannot vote on its own jury');
  await J.goto(BASE + '/docket'); await J.waitForSelector('.docket a');
  ok((await J.textContent('.docket')).includes(cno.replace('Case No. ', '')), 'case listed on public docket');
  await shot(J, '10-public-docket');

  // appeal by losing party
  const loser = verdict.includes('Plaintiff') ? B : A, winner = loser === A ? B : A;
  await loser.reload(); await loser.waitForSelector('#apf');
  await loser.fill('[name=argument]', 'The court erred: the lamp was placed in a walkway contrary to the building rules, and the photos now attached show the lamp blocking the door. Responsibility should be shared.');
  await loser.setInputFiles('#apf input[type=file]', ['/tmp/receipt.png', '/tmp/text.png']);
  await shot(loser, '11-appeal-form');
  await loser.click('button:has-text("File Appeal")'); await loser.waitForSelector('text=Awaiting the response');
  await winner.reload(); await winner.waitForSelector('#rf');
  await winner.fill('[name=response]', 'The building rules do not prohibit lamps by the door, and Sam admitted fault in writing (Exhibit P-3).');
  await winner.click('button:has-text("File Response")');
  for (const P of [A, B]) await P.waitForSelector('text=Ruling on Appeal', { timeout: 120000 });
  console.log('  appeal:', (await A.textContent('.disp')).trim());
  ok(await loser.locator('#apf').count() === 0, 'only one appeal allowed');
  await A.waitForTimeout(500); await shot(A, '12-appellate-ruling');
  await browser.close(); console.log('E2E PASS');
})().catch(e => { console.error('E2E FAIL', e); process.exit(1); });
