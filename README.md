# VOX — Hands-free voice operating layer for India's gig riders

VOX sits **on top of** a rider's app (Rapido, Zomato, …) and lets them run the whole
job by voice — go online, accept a ride, navigate, confirm pickup, call the customer,
complete the drop and record cash — **hands-free, in their own language** (Kannada,
Hindi, English, and code-switching between them).

When you open it, **you are the rider.** No onboarding, no slideshow — you go online,
a ride request arrives, and you operate the whole journey by voice.

Theme: *Livelihoods and small business* · Scaler × Wispr Flow "India Runs on Voice".

## Run it (one command)

```bash
docker compose up --build
```

Then open **http://localhost:3000**.

> If port 3000 is busy, start it elsewhere:
> `VOX_WEB_PORT=3200 docker compose up --build` → open that port.

The app **boots and is fully usable with no API keys.** In this **keyless demo mode**
it uses the browser's built-in Web Speech API for listening/speaking and a
multilingual rule interpreter on the server. The UI clearly labels this mode so it's
never mistaken for live AI.

> The mic needs **localhost or HTTPS** (browsers block mic on plain `http://` that
> isn't localhost) — fine for `docker compose up` on localhost.

## Optional: real Indian-language voice + smarter understanding

Keys are **optional** and strictly server-side (never shipped to the browser, never
committed — `.env` is gitignored and excluded from the Docker image). No feature
crashes for lack of a key; each one just upgrades a capability:

```bash
cp .env.example .env
# SARVAM_API_KEY=...   → Sarvam Saarika (STT) + Bulbul (TTS): natural Hindi/Kannada
#                         voice + sarvam-105b understanding + translation
# GEMINI_API_KEY=...   → Google Gemini understanding (free key at aistudio.google.com)
docker compose up --build
```

Priority when a key is present: **Sarvam → Gemini → rules** (Sarvam is India-tuned).
Any model failure falls back to the next, so the voice path never dies.

## The judge demo script (≈90 seconds)

1. **Open** the app — you're in the rider cockpit (Ravi, Jayanagar, Bengaluru).
2. **Go online** — tap *Go Online* or say *"go online"*. VOX activates.
3. **A request arrives on its own** — a chime, VOX reads it out, a countdown starts.
4. **Say "accept"** — the ride is accepted; the map marker starts moving to pickup.
5. **Navigate** — distance/ETA tick down as the rider moves.
6. **Say "pickup done"** at the pickup — navigation switches to the drop.
7. **Code-switch** mid-ride — *"drop kitna door hai?"*, *"how much have I earned?"* —
   VOX keeps ride context and answers.
8. **Safety test** — while still en route, say *"delivered"*. VOX **refuses**:
   *"You're still N metres away."* Open **📊 VOX Trace**: GPS/geofence `FAILED`,
   validation `BLOCKED`, state change `NONE` — a real rejection, not a warning.
9. **Recover** — say *"no, call the customer"* — VOX calls, ride intact.
10. **Arrive & complete** — reach the drop (or use the dev panel), say *"delivered"* →
    it passes; then *"cash collected, three twenty"* → read-back → *"yes"* → **PAID**.
11. **Earnings update** (real DB) — the header total goes up.
12. **Next ride arrives** — the loop continues.

**Reset** anytime from the dev panel to restore the exact same deterministic demo.

## Simulation & developer controls (collapsible, bottom of screen)

Tucked away so the rider UI stays clean, easy to find for a judge:

- **Scenario:** Reset demo · Trigger request
- **Movement:** speed 2/4/8× · pause/resume · jump to pickup/drop · **180 m away**
  (forces the geofence block on demand)
- **Scenario testing (recovery demos):**
  - *Simulate noisy / unclear input* → injects a low-confidence utterance through the
    **same** pipeline → VOX asks to repeat, ride context preserved (shown in the trace)
  - *STT fail* → the next voice capture fails once, then recovers (retry or manual)
  - *Network fail* → the next engine call fails **before** any write, so the ride is
    provably unchanged; recovers on the next attempt
- **Manual actions:** the same engine path as voice — never a validation bypass.

## Architecture

```
Voice → Intent → Context → Validation → Execution → Feedback
        (AI interprets)    (our deterministic engine decides & writes)
```

The AI is responsible only for **understanding** speech. A deterministic state machine
(`lib/stateMachine.ts`) decides what is **allowed** — task state, GPS geofence,
read-back confirmations, duplicate prevention, cash-amount sanity — and every state
change is a compare-and-swap write in PostgreSQL (`lib/engine.ts`). Voice can replace a
tap; it can never replace the proof. The same engine validates voice **and** manual
actions.

## What's genuinely functional vs simulated

**Functional (real):**
- Deterministic validation engine + PostgreSQL state (CAS writes, audit trail).
- GPS **geofence enforcement** — the rider's live simulated coordinates are checked
  server-side; an out-of-zone delivery is genuinely blocked.
- Real STT/TTS/understanding/translation when `SARVAM_API_KEY` is set; browser Web
  Speech + rule interpreter when keyless. Multilingual + code-switching.
- Earnings/rides totals read from real PAID orders.
- VOX Trace, metrics and taps-saved — read from actual engine responses, nothing
  scripted.

**Simulated (for the demo, by design):**
- The **map** is a schematic SVG (no paid maps API) with a projected route + moving
  marker. Rider movement is a sim clock (speed-adjustable); ETA is a realistic estimate.
- Ride **requests** arrive from a seeded, deterministic scenario (repeatable).
- **Emergency / road-hazard** actions surface a clearly-labelled *simulated* alert.

## API

```bash
curl localhost:3000/api/health            # {"ok":true,"db":"connected"}
curl localhost:3000/api/health?strict=1   # 503 if the DB is down (probe mode)
curl localhost:3000/api/orders?status=AVAILABLE   # the offer queue
curl localhost:3000/api/orders/current    # the rider's active / next order
curl localhost:3000/api/stats             # {"earnings":N,"rides":N} from PAID orders
curl -X POST localhost:3000/api/orders/reset      # restore the deterministic demo
# POST /api/interpret  {transcript,status,awaitingConfirm} → structured intent
# POST /api/intent     {intent,orderId,riderLat,riderLng,...} → engine Decision
```

## Stack

- **Next.js 16** (App Router) — UI + server API routes (keeps any key server-side)
- **PostgreSQL** — rider, order, task-state and transaction data
- **Sarvam AI** (keyed) / **Web Speech API** (keyless) for voice; **Gemini** optional
- **Deterministic validation engine** — the AI interprets; the app decides
