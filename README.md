
# NexusMeet

Built this to wrap my head around WebRTC, mediasoup SFU routing, and how to do AES-GCM end-to-end chat in the browser. The chat key lives in the URL hash so the server only ever sees ciphertext.

It started as a simple peer-to-peer setup, but I later added a mediasoup-based SFU so it scales past a few participants. There's a waiting room, screen share, and a P2P fallback when the SFU isn't up.

## Stack

Frontend is React 18 with socket.io-client, Web Crypto for encryption, and MUI for the UI bits. Backend is Node + Express with socket.io and mediasoup, talking to MongoDB. Redis is optional — only needed if you're running more than one backend instance and want them to share state. Tests use the built-in Node test runner on the backend, Jest + RTL on the frontend, and Playwright for the browser-level e2e.

## Project structure

```
backend/   Express API, socket.io, mediasoup workers, Mongo models
frontend/  React app — landing, auth, home, history, /:room
e2e/       Playwright smoke tests
```

## Running locally

Make sure MongoDB is running, then copy `backend/.env.example` to `backend/.env` and fill in the connection string. Redis is optional; without it the server just keeps room state in memory.

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

There's a `render.yaml` in here so Render can spin up the whole thing — backend service, static frontend, and a Mongo instance — from one Blueprint deploy. The backend builds from `backend/Dockerfile`.