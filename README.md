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

The app **starts and shows its main screen with no keys at all.** In this keyless mode
it uses the browser's built-in Web Speech API for voice.

## Optional: natural human voice (free)

For the premium real-time human voice (Google Gemini native audio), add a **free**
Google AI Studio key — get one at https://aistudio.google.com (no card):

```bash
cp .env.example .env
# edit .env and set GEMINI_API_KEY=...
docker compose up --build
```

Without a key, the app still runs — it just shows a "key not set" note and uses the
keyless voice engine. No feature crashes for lack of a key.

## Stack

- **Next.js 16** (App Router) — UI + server API routes (keeps any API key server-side)
- **PostgreSQL** — rider, order, task-state and transaction data
- **Web Speech API** (keyless) / **Gemini native audio** (with free key) for voice
- **Deterministic validation layer** — the AI interprets; the app decides what is allowed

## How it's built (architecture)

```
Voice → Intent → Context → Validation → Action → Feedback
        (AI interprets)   (our code decides permission)
```

The AI is responsible for *understanding*. Our code is responsible for *execution*:
a deterministic state machine checks task state, GPS geofence, confirmations and
duplicate actions before anything is recorded. Voice can replace a tap — never the proof.
