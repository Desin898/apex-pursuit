// Apex Pursuit relay server.
//
// Serves the game (dist/index.html) and relays each player's state to the others in the same
// room over WebSocket. It holds no game logic: players simulate their own cars and the first
// player in a room hosts the AI. Run it on your PC for LAN play, or on any Node host for
// internet play, then share the link it prints.
//
//   npm run build && npm run serve          → http://localhost:8080
//   PORT=3000 node server/relay.mjs
//   share  http://<your-address>:8080/?room=friends   (any room name; default is "main")
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8080;
const MAX_PER_ROOM = 8;
const MAX_MESSAGE = 8 * 1024;
/** must match the game's online protocol (4C.2 = 2): older copies are told to update */
const PROTOCOL = '2';
// the fresh build if there is one, otherwise the prebuilt copy that ships in the repository
// (so friends can host from the downloaded ZIP without building anything)
const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'dist', 'index.html');
const root = existsSync(built) ? built : join(here, '..', 'play', 'ApexPursuit.html');

function page() {
  if (!existsSync(root)) return null;
  // tell the page it was served by a relay, so it connects back here for online play
  return readFileSync(root, 'utf8').replace('</head>', '<script>window.__APEX_RELAY__=true</script></head>');
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = page();
    if (!html) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('The game file is missing: play/ApexPursuit.html (or run "npm run build").');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  } else if (url.pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
  } else if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

/** room name → Map(id → socket) */
const rooms = new Map();
let nextId = 1;
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE });

/** room name → password key set by the first player in (4C.2) */
const roomKeys = new Map();

wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const name = (q.get('room') || 'main').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'main';
  const key = (q.get('k') || '').replace(/[^a-f0-9]/g, '').slice(0, 32);
  const ver = q.get('v') || '1';
  if (ver !== PROTOCOL) {
    ws.close(4005, 'version');
    return;
  }
  let room = rooms.get(name);
  if (!room) rooms.set(name, (room = new Map()));
  if (room.size === 0) roomKeys.set(name, key); // the first one in sets the password (or none)
  else if ((roomKeys.get(name) || '') !== key) {
    ws.close(4003, 'password');
    return;
  }
  if (room.size >= MAX_PER_ROOM) {
    ws.close(4004, 'room full');
    return;
  }
  const id = 'p' + (nextId++).toString(36) + Math.random().toString(36).slice(2, 6);
  room.set(id, ws);
  ws.send(JSON.stringify({ t: 'hi', id }));
  // rate limit: a game sends 20 states a second; anything far above that is dropped
  let budget = 60;
  const refill = setInterval(() => (budget = 60), 1000);
  ws.on('message', (raw) => {
    if (--budget < 0) return;
    let m;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m && m.t === 'ping' && typeof m.ts === 'number') {
      ws.send(JSON.stringify({ t: 'pong', ts: m.ts }));
      return;
    }
    if (!m || m.t !== 's' || typeof m.d !== 'object' || m.d === null) return;
    const out = JSON.stringify({ t: 's', id, d: m.d });
    for (const [other, sock] of room) if (other !== id && sock.readyState === 1) sock.send(out);
  });
  ws.on('close', () => {
    clearInterval(refill);
    room.delete(id);
    const out = JSON.stringify({ t: 'bye', id });
    for (const sock of room.values()) if (sock.readyState === 1) sock.send(out);
    if (room.size === 0) {
      rooms.delete(name);
      roomKeys.delete(name);
    }
  });
  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`Apex Pursuit relay running.`);
  console.log(`  This PC:      http://localhost:${PORT}/?room=friends`);
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  Same network: http://${n.address}:${PORT}/?room=friends`);
  }
});
