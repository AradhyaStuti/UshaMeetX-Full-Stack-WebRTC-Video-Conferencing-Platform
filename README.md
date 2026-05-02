
# NexusMeet

NexusMeet is a self-hosted meeting app I built while trying to understand how real-time communication systems actually work — not just using WebRTC, but dealing with signalling, media routing, and basic room logic.

It started as a simple peer-to-peer setup, but I later added a mediasoup-based SFU so it doesn’t fall apart once more people join. Chat is handled in the browser and encrypted with AES-GCM, with the key passed through the URL hash so the server never sees it.

## Stack

* **Frontend:** React 18, WebRTC, socket.io-client, Web Crypto, MUI
* **Backend:** Node + Express, socket.io, mediasoup, MongoDB
* **Optional:** Redis (for shared state if running multiple instances)
* **Tests:** Node test runner (backend), Jest + RTL (frontend), Playwright (e2e)

## Project structure

```
backend/   Express API, socket.io, mediasoup workers, Mongo models
frontend/  React app — landing, auth, home, history, /:room
e2e/       Playwright smoke tests
```

## Running locally

You’ll need MongoDB running and a `.env` file in `backend/` based on the example. Redis is optional — if it’s not there, the app just keeps state in memory.

```bash
cd backend  && npm install && npm run dev
cd frontend && npm install && npm start
```

The frontend points to `http://localhost:8000` by default (see `frontend/src/environment.js` if you want to change it).

## Tests

From the root:

```bash
npm run test:backend
npm run test:frontend
npm run test:e2e   # requires both backend and frontend running
```

## How it works (roughly)

* The first person to join a room becomes the host
* Others wait in a basic waiting room until admitted
* The client checks `/api/v1/sfu-status`

  * if SFU is available → uses mediasoup
  * otherwise → falls back to plain WebRTC peer connections
* Chat encryption key lives in the URL hash

  * shared via invite links
  * joining by room code generates a new key on the client
* If the host leaves, someone else in the room is promoted automatically

## Notes / tradeoffs

* P2P vs SFU is decided once at join time based on whether the SFU is up — there's no mid-call switching or load balancing
* No TURN server bundled — you’ll need to configure one if users are behind stricter NATs
* Rooms expire after ~24h of inactivity; nothing is persisted across that
* If mediasoup fails to build/run on a machine, the app just continues in P2P mode

## Deployment

There’s a `render.yaml` for quick deployment on Render (backend + static frontend + Mongo).
The backend Dockerfile is in `backend/` and is what gets built during deploy.