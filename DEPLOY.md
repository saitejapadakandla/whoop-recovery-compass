# Private Hosting

This app needs a Node host because WHOOP OAuth uses a client secret and token exchange. Do not deploy it as a static GitHub Pages site.

## Required Environment Variables

Set these on the host:

```text
WHOOP_CLIENT_ID=...
WHOOP_CLIENT_SECRET=...
WHOOP_REDIRECT_URI=https://your-host.example.com/callback
WHOOP_SCOPES=read:profile read:body_measurement read:workout read:recovery read:sleep read:cycles offline
APP_PASSWORD=<private password you choose>
APP_SESSION_SECRET=<long random string>
HOST=0.0.0.0
LOCAL_HTTPS=false
```

`APP_PASSWORD` is the private access gate. Anyone without it gets stopped before the WHOOP dashboard loads.

## WHOOP Dashboard

After deployment, add the hosted redirect URL:

```text
https://your-host.example.com/callback
```

Keep the local redirect if you still want local development:

```text
https://127.0.0.1:3000/callback
```

## Start Command

```bash
node server.js
```

The included `Dockerfile` works on hosts that accept Docker deployments.
