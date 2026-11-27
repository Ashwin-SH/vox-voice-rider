# VOX — Hands-free voice operating layer for India's gig riders

VOX lets delivery partners, quick-commerce riders and bike-taxi captains run their
whole job by voice — accept an order, navigate, mark pickup, call the customer,
complete delivery and record cash — **hands-free, in their own language**
(Kannada, Hindi, English and code-switching between them).

Theme: *Livelihoods and small business* · Scaler × Wispr Flow "India Runs on Voice".

## Run it (one command)

```bash
docker compose up --build
```

Then open **http://localhost:3000**.

> If port 3000 is busy on your machine, start it on another:
> `VOX_WEB_PORT=3200 docker compose up --build` and open that port.

The app **starts and shows its main screen with no keys at all.** In this keyless mode
it uses the browser's built-in Web Speech API for voice.

## Optional: smarter understanding (free)

For smarter natural-language understanding of free, mixed-language speech
(Google Gemini), add a **free** Google AI Studio key — get one at https://aistudio.google.com (no card):

```bash
cp .env.example .env
# edit .env and set GEMINI_API_KEY=...
docker compose up --build
```

Without a key the app still runs and uses the keyless rule interpreter. No feature crashes for lack of a key.

## Stack

- **Next.js 16** (App Router) — UI + server API routes (keeps any API key server-side)
- **PostgreSQL** — rider, order, task-state and transaction data
- **Web Speech API** for voice (both modes); **Gemini** for understanding when a key is set
- **Deterministic validation layer** — the AI interprets; the app decides what is allowed

## How it's built (architecture)

```
Voice → Intent → Context → Validation → Action → Feedback
        (AI interprets)   (our code decides permission)
```

The AI is responsible for *understanding*. Our code is responsible for *execution*:
a deterministic state machine checks task state, GPS geofence, confirmations and
duplicate actions before anything is recorded. Voice can replace a tap — never the proof.

## API (mock backend)

```bash
curl localhost:3000/api/health            # {"ok":true,"db":"connected"}
curl localhost:3000/api/health?strict=1   # 503 if the DB is down (probe mode)
curl localhost:3000/api/orders            # seeded orders (no customer phone)
curl localhost:3000/api/orders/current    # the rider's active / next order
```

## Voice

Tap the **VOX** button and speak a command — English, Hindi or Kannada (pick the
language with the 🎙 selector). Natural phrasing works, not fixed commands:
"accept", "haan le lo", "howdu swikarishu" all accept; "delivered", "pahuncha
diya" all mark delivered. VOX speaks its reply back and runs the cash read-back
by voice ("say yes to confirm").

- **Keyless (default):** the browser's built-in Web Speech API for listening and
  speaking, and a multilingual rule interpreter on the server. No keys, works on
  any machine.
- **With `SARVAM_API_KEY` (Indian-language speech):** Sarvam **Saarika** listens
  and **Bulbul** speaks in a natural Hindi/Kannada voice — a real speech model,
  not the browser. Key stays on the server; any failure falls back to Web Speech.
- **With `GEMINI_API_KEY`:** the server also uses Gemini to *understand* the
  speech by meaning (free, mixed-language phrasing). Key stays on the server.

> The microphone needs **localhost or HTTPS** (browsers block mic access on plain
> `http://` that isn't localhost) — fine for `docker compose up` on localhost.
