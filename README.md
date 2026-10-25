# Court: AI judge for everyday disputes 

> **GitHub Pages:** `index.html` at the repo root is an overview page with screenshots (demo data). The real app is the Node.js server (`server.js`) plus the front end in `public/`; it needs the server to run, so it isn't live on Pages. No database, uploads, logs, `.env` or API keys are included; copy `.env.example` (where present) and add your own.

Mobile-first website, no accounts or installs. Flow: the Plaintiff files a case (Case No. YYYY-NNNNNN) and summons the Defendant by link/code. Both file privately, and evidence becomes numbered exhibits (P-1, D-1…). The court cross-examines each side with 1–3 required questions, then enters a formal judgment (findings of fact with exhibit citations, conclusions, verdict, order).
- The judgment has a read-only share link: `/judgment/<id>`.
- The losing party may appeal once (either party if the verdict is split). The respondent can reply or waive, then the Appellate Division upholds or overturns.
- Public jury (optional): if both parties opt in, an anonymised page `/jury/<id>` (names redacted, images withheld) takes visitor votes, one per browser. The votes are shown next to the judge's verdict. Listed on `/docket`.

## Run
```
npm install
PORT=3300 node server.js        # http://localhost:3300
node tests/e2e.js http://localhost:3300   # two-party end-to-end test, saves screenshots to screenshots/
```
`run-server.sh` keeps the server running in an auto-restart loop (logs to `server.log`).

## AI judge (Grok)
Default provider is Grok via the xAI API (`https://api.x.ai/v1`, model `grok-4.7`). To go live, put `XAI_API_KEY=xai-...` in `.env` and run `./start.sh`.
Optional: `JUDGE_MODEL`, `JUDGE_PROVIDER=xai|openai|anthropic|demo`. With no key, a clearly labelled DEMO judge (not AI) is used.

## Paywall hook (off)
`paywall.js`: set `PAYWALL_ENABLED=1` and implement `isPaid()`. Gates in `server.js`: `paywall.gate('open_case')` on `POST /api/cases` and `paywall.gate('appeal')` on `POST /api/cases/:id/appeal` (runs before uploads are stored). Prices: `PRICE_OPEN_CASE`, `PRICE_APPEAL`. When it's on and the user hasn't paid, it returns HTTP 402 `{paywall:true}`.

## Data
SQLite at `data/court2.db`, and the uploaded images go in `uploads/`.


Created by Walter Henderson Jr.
