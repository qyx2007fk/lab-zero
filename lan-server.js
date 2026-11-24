#!/usr/bin/env node
/*
 * LAB ZERO // zero-dependency LAN server
 * Serves the game and relays multiplayer lobby / host-authoritative traffic
 * over Server-Sent Events + regular HTTP POST requests.
 *
 * Start:
 *   node lab-zero/lan-server.js
 *   PORT=8765 node lab-zero/lan-server.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Match } = require('./server-authority');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || process.argv[2] || 8765);
const MAX_BODY = 2 * 1024 * 1024;
const rooms = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

function id(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function roomPayload(room) {
  return {
    room: room.id,
    hostId: room.hostId,
    started: room.started,
    config: room.config,
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      character: player.character,
      online: player.online,
      ready: player.ready,
      host: player.id === room.hostId,
    })),
  };
}

function broadcast(room, type, payload, exceptId = null) {
  if (!room) return;
  const packet = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const player of room.players.values()) {
    if (player.id === exceptId) continue;
    if (!player.res || player.res.writableEnded) continue;
    if (type === 'snapshot' && player.res.writableLength > 256 * 1024) continue;
    try {
      player.res.write(packet);
    } catch (_) {
      player.online = false;
    }
  }
}

function broadcastLobby(room) {
  broadcast(room, 'lobby', roomPayload(room));
}

function sendToHost(room, type, payload, exceptId = null) {
  if (!room) return;
  const host = room.players.get(room.hostId);
  if (!host || !host.res || host.res.writableEnded) return;
  if (host.id === exceptId) return;
  try {
    host.res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
  } catch (_) {
    host.online = false;
  }
}

function leaveRoom(room, playerId, reason = 'left') {
  if (!room) return;
  const player = room.players.get(playerId);
  if (!player) return;
  room.players.delete(playerId);
  if (player.res && !player.res.writableEnded) {
    try { player.res.end(); } catch (_) { /* noop */ }
  }
  if (room.hostId === playerId) {
    const next = [...room.players.values()].find((entry) => entry.online);
    if (next) {
      room.hostId = next.id;
      broadcast(room, 'host-changed', { hostId: next.id });
    }
  }
  if (room.match) room.match.removePlayer(playerId);
  if (room.players.size === 0) {
    stopMatch(room);
    rooms.delete(room.id);
    return;
  }
  broadcast(room, 'player-left', { id: playerId, name: player.name, reason });
  broadcastLobby(room);
}

function cleanupRoom(room) {
  if (!room) return;
  for (const player of [...room.players.values()]) {
    if (!player.online && Date.now() - player.lastSeen > 30000) {
      leaveRoom(room, player.id, 'offline');
    }
  }
  if (room.players.size === 0) stopMatch(room);
}

function stopMatch(room) {
  if (!room) return;
  if (room.matchTimer) clearInterval(room.matchTimer);
  room.matchTimer = null;
  room.match = null;
}

function startMatch(room) {
  stopMatch(room);
  const entries = [...room.players.values()].filter((entry) => entry.online).map((entry) => ({
    id: entry.id, name: entry.name, character: entry.character,
  }));
  room.match = new Match(room.id, room.config, entries);
  const interval = 1000 / 30;
  room.matchTimer = setInterval(() => {
    if (!room.match) return;
    try {
      room.match.update(interval / 1000);
      const snap = room.match.snapshot();
      broadcast(room, 'snapshot', snap);
      if (room.match.result && !room.resultSent) {
        room.resultSent = true;
      }
    } catch (error) {
      console.error('[LAB ZERO authority]', room.id, error);
    }
  }, interval);
  room.resultSent = false;
}

function normalizeConfig(input = {}) {
  const mode = input.mode === 'pvp' ? 'pvp' : 'pve';
  return {
    mode,
    pveMode: input.pveMode === 'boss' ? 'boss' : 'normal',
    rounds: Math.max(1, Math.min(10, Number(input.rounds) || 5)),
  };
}

async function handleJoin(req, res) {
  const body = await readBody(req);
  const roomId = String(body.room || 'LABZERO').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20) || 'LABZERO';
  const name = String(body.name || '干员').trim().slice(0, 20) || '干员';
  const character = String(body.character || 'alan').slice(0, 24);
  let room = rooms.get(roomId);
  if (!room) {
    room = { id: roomId, hostId: null, started: false, config: normalizeConfig(), players: new Map(), match: null, matchTimer: null };
    rooms.set(roomId, room);
  }
  if (room.started) return json(res, 409, { error: 'ROOM_IN_PROGRESS', message: '该房间正在战斗中' });
  if (room.players.size >= 8) return json(res, 409, { error: 'ROOM_FULL', message: '房间已满（最多8人）' });
  const playerId = id('p_');
  const isHost = !room.hostId || !room.players.has(room.hostId);
  const player = {
    id: playerId,
    name,
    character,
    online: true,
    ready: false,
    lastSeen: Date.now(),
    res: null,
  };
  room.players.set(playerId, player);
  if (isHost) room.hostId = playerId;
  json(res, 200, { id: playerId, room: roomId, host: isHost, hostId: room.hostId, config: room.config });
  broadcastLobby(room);
}

function handleEvents(req, res, url) {
  const roomId = String(url.searchParams.get('room') || '').toUpperCase();
  const playerId = String(url.searchParams.get('id') || '');
  const room = rooms.get(roomId);
  const player = room?.players.get(playerId);
  if (!room || !player) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('room or player not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.socket?.setNoDelay(true);
  res.socket?.setKeepAlive(true, 15000);
  res.flushHeaders?.();
  res.write('retry: 1200\n\n');
  player.res = res;
  player.online = true;
  player.lastSeen = Date.now();
  res.write(`event: hello\ndata: ${JSON.stringify({ id: playerId, room: roomPayload(room) })}\n\n`);
  broadcastLobby(room);
  const heartbeat = setInterval(() => {
    player.lastSeen = Date.now();
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    player.online = false;
    player.res = null;
    leaveRoom(room, playerId, 'offline');
  });
}

async function handleAction(req, res) {
  const body = await readBody(req);
  const roomId = String(body.room || '').toUpperCase();
  const playerId = String(body.id || '');
  const action = String(body.action || '');
  const payload = body.payload || {};
  const room = rooms.get(roomId);
  const player = room?.players.get(playerId);
  if (!room || !player) return json(res, 404, { error: 'NOT_IN_ROOM' });
  player.lastSeen = Date.now();
  player.online = true;
  if (action === 'lobby') {
    if (payload.name !== undefined) player.name = String(payload.name).trim().slice(0, 20) || player.name;
    if (payload.character !== undefined) player.character = String(payload.character).slice(0, 24);
    if (payload.ready !== undefined) player.ready = !!payload.ready;
    if (room.hostId === playerId && payload.config) room.config = normalizeConfig(payload.config);
    broadcastLobby(room);
    return json(res, 200, { ok: true });
  }
  if (action === 'start') {
    if (room.hostId !== playerId) return json(res, 403, { error: 'NOT_HOST' });
    if (room.started) return json(res, 409, { error: 'ALREADY_STARTED' });
    const online = [...room.players.values()].filter((entry) => entry.online);
    if (online.length < 1) return json(res, 409, { error: 'NO_PLAYERS' });
    room.started = true;
    room.config = normalizeConfig(payload.config || room.config);
    const start = {
      ...roomPayload(room),
      startedAt: Date.now(),
      config: room.config,
      players: online.map((entry) => ({
        id: entry.id, name: entry.name, character: entry.character, host: entry.id === room.hostId,
      })),
    };
    startMatch(room);
    broadcast(room, 'start', start);
    return json(res, 200, { ok: true });
  }
  if (action === 'input') {
    if (room.match) room.match.applyInput(playerId, payload || {});
    return json(res, 200, { ok: true });
  }
  if (action === 'snapshot' || action === 'event') {
    return json(res, 410, { error: 'SERVER_AUTHORITATIVE' });
  }
  if (action === 'end') {
    if (room.hostId !== playerId) return json(res, 403, { error: 'NOT_HOST' });
    room.started = false;
    for (const entry of room.players.values()) entry.ready = false;
    stopMatch(room);
    broadcast(room, 'end', payload || {});
    broadcastLobby(room);
    return json(res, 200, { ok: true });
  }
  if (action === 'leave') {
    leaveRoom(room, playerId, 'left');
    return json(res, 200, { ok: true });
  }
  return json(res, 400, { error: 'UNKNOWN_ACTION' });
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const resolved = path.resolve(ROOT, `.${pathname}`);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== path.join(ROOT, 'index.html')) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.stat(resolved, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=120',
      'Content-Length': stat.size,
    });
    fs.createReadStream(resolved).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  req.socket?.setNoDelay(true);
  req.socket?.setKeepAlive(true, 15000);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/mp/health') return json(res, 200, { ok: true, rooms: rooms.size, uptime: process.uptime() });
    if (url.pathname === '/api/mp/join' && req.method === 'POST') return handleJoin(req, res);
    if (url.pathname === '/api/mp/events' && req.method === 'GET') return handleEvents(req, res, url);
    if (url.pathname === '/api/mp/action' && req.method === 'POST') return handleAction(req, res);
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'NOT_FOUND' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405); res.end('method not allowed'); return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    json(res, 500, { error: 'SERVER_ERROR', message: String(error.message || error) });
  }
});

setInterval(() => {
  for (const room of [...rooms.values()]) {
    cleanupRoom(room);
    if (room.players.size === 0) rooms.delete(room.id);
  }
}, 10000);

function localAddresses() {
  const list = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) list.push(entry.address);
    }
  }
  return list;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LAB ZERO LAN server: http://localhost:${PORT}/`);
  for (const address of localAddresses()) console.log(`  LAN: http://${address}:${PORT}/`);
  console.log('PVE / PVP rooms are kept in memory; close the server to reset all rooms.');
});
