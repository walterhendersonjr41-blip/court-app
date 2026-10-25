# Court: AI judge for everyday disputes

**Live, free, no account:** https://walterhendersonjr41-blip.github.io/court-app/

Court is a mobile-first website. The Plaintiff opens a case (Case No. YYYY-NNNNNN) and summons the Defendant with a private case code or link. Each side files privately, and evidence becomes numbered exhibits (P-1, D-1…).
- The AI judge cross-examines each side with 1–3 required questions, then enters a formal judgment: findings of fact with exhibit citations, conclusions, a verdict and an order.
- The judgment has a read-only share link (`#/judgment/<id>`).
- The losing party may appeal once (either party, if the verdict is split). The respondent can reply or waive, and then the Appellate Division upholds or overturns.
- **Public jury (optional):** if both parties opt in, an anonymised page (`#/jury/<id>`, with names redacted and images withheld) takes visitor votes, one per browser. It is listed on `#/docket`.

## How the GitHub Pages version works (no server, no cost)
- **Storage:** free public Nostr relays (nos.lol, relay.primal.net, nostr.mom, offchain.pub, relay.nostr.net), using kind-30078 events.
  - Case files are **end-to-end encrypted** (AES-GCM). The key comes from the case code, which only the two parties hold.
  - Each side's filing is sealed with its own key and revealed only after **both** sides have filed (commit-reveal), so neither side sees the other's statement first.
  - Your own cases and keys are kept in this browser (localStorage). "Copy My Private Link" reopens a case on another device.
- **AI judge:** the free, keyless Pollinations text API, with no key needed. It cannot see images, so photo exhibits are read with on-device OCR (tesseract.js) and the party's caption.
- Rulings are a neutral AI opinion. They are **not legally binding, not a real court and not legal advice**. For real help, see [LawHelp.org](https://www.lawhelp.org), [LSC free legal aid](https://www.lsc.gov/about-lsc/what-legal-aid/get-legal-help), or call 211.
- Add `?ns=test` to the URL to use a separate test namespace.

Files for Pages: `index.html`, `style.css`, `app.js` (UI), `backend.js` (case logic and AI judge), `store.js` (Nostr and crypto), `nostr.bundle.js`, `ai-helper.js` (free AI chat), `sw.js` and `manifest.webmanifest` (PWA).

## Optional self-hosted server version (not used by the live site)
The older Node.js server (`server.js`, `public/`, `judge.js`, `paywall.js`) is still in the repo. No database, uploads, `.env` or API keys are included.

### Run
```
npm install
PORT=3300 node server.js        # http://localhost:3300
node tests/e2e.js http://localhost:3300   # two-party end-to-end test, saves screenshots to screenshots/
```
`run-server.sh` keeps the server running in an auto-restart loop (logs to `server.log`).

### AI judge (Grok)
Default provider is Grok via the xAI API (`https://api.x.ai/v1`, model `grok-4.7`). To go live, put `XAI_API_KEY=xai-...` in `.env` and run `./start.sh`.
Optional: `JUDGE_MODEL`, `JUDGE_PROVIDER=xai|openai|anthropic|demo`. With no key, a clearly labelled DEMO judge (not AI) is used.

### Paywall hook (off)
`paywall.js`: set `PAYWALL_ENABLED=1` and implement `isPaid()`. Gates in `server.js`: `paywall.gate('open_case')` on `POST /api/cases` and `paywall.gate('appeal')` on `POST /api/cases/:id/appeal` (runs before uploads are stored). Prices: `PRICE_OPEN_CASE`, `PRICE_APPEAL`. When it's on and the user hasn't paid, it returns HTTP 402 `{paywall:true}`.

### Data
SQLite at `data/court2.db`, and the uploaded images go in `uploads/`.


Created by Walter Henderson Jr.
