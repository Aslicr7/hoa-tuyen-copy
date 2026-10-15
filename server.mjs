// Hỏa Tuyến: máy chủ tự dựng (trang web + chơi online) trên một cổng duy nhất.
//   node server.mjs            → http://<ip>:8787  (đổi cổng: PORT=9000 node server.mjs)
// Tuỳ chọn: MAX_PLAYERS, MAX_ROOMS.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import './server/shim.mjs';

const { MatchServer, MAP_BUILDERS, ROOM_MAPS, TEAM, ROUNDS, ONLINE } = await import('./server/core.mjs');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 64;
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 16;
const PROTOCOL = 17;
const TICK_MS = 1000 / 60;
const ROOM_MAX = 10; // số người tối đa trong một phòng (không tính bot)
const BOTS_MAX = 8; // số bot tối đa mỗi bên

// ---------------------------------------------------------------- web page
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};
const gzCache = new Map();

const web = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404'); return; }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'content-type': TYPES[ext] || 'application/octet-stream',
      // Tên file js/css/font có mã băm nên giữ lâu được; index.html luôn lấy bản mới.
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    };
    const zip = /\.(html|js|css|svg|json)$/.test(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (zip) {
      let hit = gzCache.get(file);
      if (!hit || hit.mtime !== st.mtimeMs) {
        hit = { mtime: st.mtimeMs, body: zlib.gzipSync(fs.readFileSync(file)) };
        gzCache.set(file, hit);
      }
      res.writeHead(200, { ...headers, 'content-encoding': 'gzip', vary: 'Accept-Encoding' }).end(req.method === 'HEAD' ? undefined : hit.body);
      return;
    }
    res.writeHead(200, { ...headers, 'content-length': st.size });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  });
});

// ---------------------------------------------------------------- lobby
const clients = new Set(); // mọi kết nối
const rooms = new Map(); // id → room
let nextClientId = 1;
let nextRoomId = 1;
const maps = new Map();
const mapOf = (id) => {
  if (!maps.has(id)) maps.set(id, MAP_BUILDERS[id]());
  return maps.get(id);
};

const send = (c, msg) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); };
const refuse = (c, reason) => send(c, { type: 'refused', reason });

function roomSummary(r) {
  return {
    id: r.id, name: r.settings.name, mode: r.settings.mode, mapId: r.settings.mapId,
    players: r.members.length, capacity: ROOM_MAX, playing: !!r.match,
    locked: r.password !== '', midJoin: r.settings.midJoin,
  };
}
const lobbyList = () => [...rooms.values()].map(roomSummary);

function roomView(r, you) {
  return {
    id: r.id,
    settings: { ...r.settings, locked: r.password !== '' },
    members: r.members.map((m) => ({ id: m.id, name: m.name, team: m.team, host: m.id === r.host, ready: m.ready, inMatch: m.inMatch })),
    bots: r.bots,
    maxMembers: ROOM_MAX,
    maxBots: BOTS_MAX,
    you,
    playing: !!r.match,
  };
}

function pushLobby() {
  const msg = { type: 'lobby', rooms: lobbyList() };
  for (const c of clients) if (c.name && !c.room) send(c, msg);
}
function pushRoom(r) {
  for (const m of r.members) send(m, { type: 'room', room: roomView(r, m.id) });
}

function cleanSettings(s, old) {
  if (!s || typeof s !== 'object') return null;
  const mode = s.mode === 'elimination' ? 'elimination' : s.mode === 'team' ? 'team' : null;
  if (!mode || !ROOM_MAPS.includes(s.mapId)) return null;
  const targets = mode === 'elimination' ? ROUNDS.winOptions : TEAM.scoreOptions;
  if (!targets.includes(s.target)) return null;
  const name = String(s.name ?? '').replace(/\s+/g, ' ').trim().slice(0, ONLINE.nameMax) || old?.name || 'Phòng';
  let password = old ? old.password : '';
  if (typeof s.password === 'string') password = s.password.slice(0, ONLINE.passwordMax);
  return { settings: { name, mode, mapId: s.mapId, target: s.target, midJoin: !!s.midJoin }, password };
}

function sideCount(r, team) { return r.members.filter((m) => m.team === team).length; }
// Phòng không chia chỗ theo bên: còn chỗ là vào, người mới sang bên ít người hơn (tính cả bot).
function freeSide(r) {
  if (r.members.length >= ROOM_MAX) return -1;
  return sideCount(r, 0) + r.bots[0] <= sideCount(r, 1) + r.bots[1] ? 0 : 1;
}

function enterRoom(c, r) {
  const team = freeSide(r);
  if (team < 0) return refuse(c, 'full');
  c.room = r;
  c.team = team;
  c.ready = false;
  c.inMatch = false;
  r.members.push(c);
  pushRoom(r);
  pushLobby();
}

function leaveRoom(c, quiet = false) {
  const r = c.room;
  if (!r) return;
  leaveMatch(c);
  r.members.splice(r.members.indexOf(c), 1);
  c.room = null;
  c.ready = false;
  if (!quiet) send(c, { type: 'room', room: null });
  if (r.members.length === 0) {
    stopMatch(r);
    rooms.delete(r.id);
  } else {
    if (r.host === c.id) r.host = r.members[0].id;
    pushRoom(r);
  }
  pushLobby();
}

// ---------------------------------------------------------------- match
// Giữ đúng số bot chủ phòng chọn cho mỗi bên, dù người vào hay ra giữa trận
// (thay cho botFill của game, vốn lấp bot cho đủ một cỡ đội cố định).
function keepBots(server, bots) {
  for (const team of [0, 1]) {
    let extra = server.bots.filter((b) => server.game.players.get(b.id)?.team === team).length - bots[team];
    for (let i = server.bots.length - 1; i >= 0 && extra > 0; i--) {
      if (server.game.players.get(server.bots[i].id)?.team === team) { server.removeBot(i); extra--; }
    }
  }
  const humans = server.humanCount();
  server.fillWithBots(humans[0] + bots[0], humans[1] + bots[1]);
}

function startMatch(r) {
  const s = r.settings;
  const opts = { seed: Math.floor(Math.random() * 1e6), mode: s.mode, ...(s.mode === 'elimination' ? { roundsToWin: s.target } : { scoreLimit: s.target }) };
  const server = new MatchServer(mapOf(s.mapId), opts);
  server.sendEvery = ONLINE.snapshotEvery;
  server.deltas = true;
  server.inputsAsTheyCome = true;
  const bots = [...r.bots];
  server.balanceBots = () => keepBots(server, bots);
  server.balanceBots();
  const match = { server, bots, forfeit: null, timer: null, endedAt: 0, next: performance.now() };
  // Kết thúc sớm (xem endIfSideEmpty) phải xảy ra trong một nhịp của trận như lúc hết giờ:
  // gọi endMatch giữa hai nhịp thì sự kiện kết thúc bị xoá ở đầu nhịp sau, máy người chơi không nhận được.
  const game = server.game, step = game.step.bind(game);
  game.step = (inputs) => {
    const events = step(inputs);
    if (match.forfeit !== null && game.match.phase !== 'ended') game.endMatch(match.forfeit);
    return events;
  };
  r.match = match;
  for (const m of r.members) { m.ready = false; joinMatch(m); }
  match.timer = setInterval(() => tickMatch(r), 4);
  pushRoom(r);
  for (const m of r.members) send(m, { type: 'match' });
  pushLobby();
}

function tickMatch(r) {
  const match = r.match;
  if (!match) return;
  const now = performance.now();
  let steps = 0;
  while (match.next <= now && steps < 10) {
    try { match.server.step(); } catch (err) { console.error('[match]', err); }
    match.next += TICK_MS;
    steps++;
  }
  if (now - match.next > 250) match.next = now; // máy chủ bị nghẽn: bỏ qua thay vì đuổi theo
  if (match.server.game.match.phase === 'ended') {
    // Trận đã xong thì nhịp đứng yên; nếu dừng ở nhịp lẻ thì lịch gửi 2 nhịp một lần không bao giờ tới
    // và người chơi không thấy bảng kết quả. Gửi mỗi nhịp cho chắc.
    match.server.sendEvery = 1;
    match.endedAt ||= now;
    if (now - match.endedAt > ONLINE.resultSeconds * 1000) finishMatch(r);
  }
}

function joinMatch(c) {
  const r = c.room;
  if (!r?.match || c.inMatch) return;
  let onMsg = null, onClose = null;
  const link = {
    send: (msg) => send(c, msg),
    onMessage: (f) => { onMsg = f; },
    onClose: (f) => { onClose = f; },
    backlogged: () => c.ws.bufferedAmount > 256 * 1024,
  };
  r.match.server.connect(link, c.team);
  c.link = { deliver: (m) => onMsg?.(m), close: () => onClose?.() };
  c.inMatch = true;
}

function leaveMatch(c) {
  if (!c.inMatch) return;
  c.inMatch = false;
  c.link?.close();
  c.link = null;
  const r = c.room;
  if (r?.match && !r.members.some((m) => m.inMatch)) finishMatch(r);
  else if (r?.match) endIfSideEmpty(r);
}

// Một bên không còn ai trong trận (cả người lẫn bot): bên còn lại thắng, trận kết thúc sớm.
// Mọi người vẫn thấy bảng kết quả như thường rồi tự về phòng.
function endIfSideEmpty(r) {
  const match = r.match;
  if (match.forfeit !== null || match.server.game.match.phase === 'ended') return;
  const left = [0, 1].map((t) => match.bots[t] > 0 || r.members.some((m) => m.inMatch && m.team === t));
  if (left[0] !== left[1]) match.forfeit = left[0] ? 0 : 1; // nhịp kế tiếp sẽ kết thúc trận
}

function stopMatch(r) {
  if (!r.match) return;
  clearInterval(r.match.timer);
  r.match = null;
}

function finishMatch(r) {
  stopMatch(r);
  for (const m of r.members) {
    if (m.inMatch) { m.inMatch = false; m.link?.close(); m.link = null; }
    m.ready = false;
  }
  pushRoom(r);
  pushLobby();
}

// ---------------------------------------------------------------- messages
// Lệnh điều khiển từ máy người chơi: chỉ nhận số hợp lệ để một gói hỏng không làm hỏng cả trận.
const SIGHTS = ['iron', 'reflex', 'scope'];
const num = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);
function cleanInput(cmd) {
  if (!cmd || typeof cmd !== 'object' || !Number.isInteger(cmd.seq)) return null;
  return {
    seq: cmd.seq,
    moveX: num(cmd.moveX, -1, 1),
    moveZ: num(cmd.moveZ, -1, 1),
    yaw: num(cmd.yaw, -1e6, 1e6),
    pitch: num(cmd.pitch, -Math.PI / 2, Math.PI / 2),
    buttons: Number.isInteger(cmd.buttons) ? cmd.buttons : 0,
    slot: Number.isInteger(cmd.slot) && cmd.slot >= -1 && cmd.slot <= 2 ? cmd.slot : -1,
    sight: SIGHTS.includes(cmd.sight) ? cmd.sight : null,
  };
}

function onHello(c, msg) {
  if (msg.version !== PROTOCOL) return refuse(c, 'version');
  const name = String(msg.name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > ONLINE.playerNameMax) return refuse(c, 'name-invalid');
  const lower = name.toLowerCase();
  for (const o of clients) {
    if (o === c || !o.name || o.name.toLowerCase() !== lower) continue;
    if (msg.id && o.uid === msg.id) { o.ws.close(); continue; } // cùng máy vào lại: đá phiên cũ
    return refuse(c, 'name-taken');
  }
  if ([...clients].filter((o) => o.name).length >= MAX_PLAYERS) return refuse(c, 'server-full');
  c.name = name;
  c.uid = String(msg.id ?? '');
  send(c, { type: 'hi', name });
  send(c, { type: 'lobby', rooms: lobbyList() });
}

function onMessage(c, msg) {
  if (msg.type === 'ping') return send(c, { type: 'pong', t: msg.t });
  if (msg.type === 'hello') return onHello(c, msg);
  if (!c.name) return;
  const r = c.room;
  const isHost = r && r.host === c.id;
  switch (msg.type) {
    case 'join':
      c.link?.deliver({ type: 'join', version: msg.version, name: c.name, gloves: !!msg.gloves });
      return;
    case 'input': {
      const cmd = cleanInput(msg.cmd);
      if (cmd) c.link?.deliver({ type: 'input', cmd });
      return;
    }
    case 'createRoom': {
      if (r) leaveRoom(c, true);
      if (rooms.size >= MAX_ROOMS) return refuse(c, 'too-many-rooms');
      const clean = cleanSettings(msg.settings, null);
      if (!clean) return refuse(c, 'bad-settings');
      const room = { id: nextRoomId++, ...clean, bots: [0, 0], members: [], host: c.id, match: null };
      rooms.set(room.id, room);
      return enterRoom(c, room);
    }
    case 'joinRoom': {
      const room = rooms.get(Number(msg.id));
      if (!room) return refuse(c, 'no-room');
      if (room === r) return pushRoom(r);
      if (room.password && String(msg.password ?? '') !== room.password) return refuse(c, 'password');
      if (room.match && !room.settings.midJoin) return refuse(c, 'playing');
      if (freeSide(room) < 0) return refuse(c, 'full');
      if (r) leaveRoom(c, true);
      return enterRoom(c, room);
    }
    case 'quickJoin': {
      const pick = [...rooms.values()]
        .filter((x) => x !== r && !x.password && (!x.match || x.settings.midJoin) && freeSide(x) >= 0)
        .sort((a, b) => b.members.length - a.members.length)[0];
      if (!pick) return refuse(c, 'no-quick');
      if (r) leaveRoom(c, true);
      return enterRoom(c, pick);
    }
    case 'leaveRoom':
      return leaveRoom(c);
    case 'roomSettings': {
      if (!r) return refuse(c, 'no-room');
      if (!isHost) return refuse(c, 'not-host');
      if (r.match) return refuse(c, 'playing');
      const clean = cleanSettings(msg.settings, { name: r.settings.name, password: r.password });
      if (!clean) return refuse(c, 'bad-settings');
      r.settings = clean.settings;
      r.password = clean.password;
      pushRoom(r);
      return pushLobby();
    }
    case 'pickSide': {
      if (!r) return refuse(c, 'no-room');
      const team = msg.team === 1 ? 1 : 0;
      if (c.inMatch || team === c.team) return;
      c.team = team;
      return pushRoom(r);
    }
    case 'bots': {
      if (!r) return refuse(c, 'no-room');
      if (!isHost) return refuse(c, 'not-host');
      if (r.match) return refuse(c, 'playing');
      const count = Math.floor(Number(msg.count));
      if (!(count >= 0 && count <= BOTS_MAX)) return refuse(c, 'bad-settings');
      r.bots[msg.team === 1 ? 1 : 0] = count;
      return pushRoom(r);
    }
    case 'ready':
      if (!r || r.match) return;
      c.ready = !!msg.ready;
      return pushRoom(r);
    case 'kick': {
      if (!r) return refuse(c, 'no-room');
      if (!isHost) return refuse(c, 'not-host');
      const who = r.members.find((m) => m.id === msg.member);
      if (!who || who === c || who.inMatch) return;
      leaveRoom(who);
      return refuse(who, 'kicked');
    }
    case 'start': {
      if (!r) return refuse(c, 'no-room');
      if (!isHost) return refuse(c, 'not-host');
      if (r.match) return;
      if (r.members.some((m) => m.id !== r.host && !m.ready)) return refuse(c, 'not-ready');
      if ([0, 1].some((t) => sideCount(r, t) + r.bots[t] === 0)) return refuse(c, 'empty-side');
      return startMatch(r);
    }
    case 'joinMatch': {
      if (!r?.match || c.inMatch) return;
      if (!r.settings.midJoin) return refuse(c, 'playing');
      joinMatch(c);
      pushRoom(r);
      return send(c, { type: 'match' });
    }
  }
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
web.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://x').pathname !== '/play') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  const c = { id: nextClientId++, ws, name: '', uid: '', room: null, team: 0, ready: false, inMatch: false, link: null, alive: true };
  clients.add(c);
  ws.on('message', (data, binary) => {
    if (binary) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    try { onMessage(c, msg); } catch (err) { console.error('[msg]', msg.type, err); }
  });
  ws.on('pong', () => { c.alive = true; });
  ws.on('error', (err) => console.error('[ws]', c.name || c.id, err.message)); // không để một kết nối hỏng làm sập máy chủ
  ws.on('close', () => {
    clients.delete(c);
    leaveRoom(c, true);
  });
});

// Dọn kết nối chết (mất mạng mà không đóng).
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false;
    c.ws.ping();
  }
}, 15000);

web.listen(PORT, HOST, () => {
  console.log(`Hỏa Tuyến đang chạy: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (online: /play)`);
});
