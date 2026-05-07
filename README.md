# Recovery Compass

Local-first WHOOP dashboard and coaching surface. No mock health metrics are shown: the app either connects to WHOOP through OAuth or tells you it is not connected.

## Features

- Real WHOOP OAuth flow with server-side client secret handling
- Recovery, sleep, strain, cycle, workout, profile, and body-measurement API calls
- Local token storage in `data/tokens.json`
- Daily train / maintain / recover recommendation
- AI-style operating brief computed locally from WHOOP signals
- Manual habit tags for late caffeine, alcohol, late meals, travel, stress, and soreness
- Recovery impact hints from tagged days
- Desktop and mobile dashboard layout

## Run

```bash
node server.js
```

Open:

```text
http://127.0.0.1:3000
```

## WHOOP Dashboard Setup

Register this redirect URL in the WHOOP Developer Dashboard:

```text
http://127.0.0.1:3000/callback
```

If your WHOOP app was registered with a different redirect URL, update `WHOOP_REDIRECT_URI` in `.env` to match it exactly.

Secrets live only in `.env`. Tokens are written to `data/tokens.json`, which is gitignored.
