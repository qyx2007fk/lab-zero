/* LAB ZERO // LAN client for the server-authoritative match engine.
 * This file only handles lobby, input and rendering. All gameplay state,
 * movement, damage, enemy AI and round logic live in server-authority.js.
 */
(() => {
  'use strict';
  const API = '/api/mp';
  const ZOOM = 1.32;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const lerp = (a, b, t) => a + (b - a) * t;
  const pad2 = (v) => String(v).padStart(2, '0');
  const formatInt = (v) => Math.round(Number(v) || 0).toLocaleString('en-US');
  const WEAPON_ORDER = ['pistol', 'smg', 'ar', 'lmg', 'rocket'];
  const CHARACTER_NAMES = { alan: '阿兰', lifeline: '命脉', newcastle: '纽卡斯尔', caustic: '凯瑟克', valkyrie: '瓦尔基里' };
  const PLAYER_COLORS = ['#67ecdd', '#ffd278', '#ff9d7b', '#b49aff', '#7fc7ff', '#a8f28a', '#ff8fc3', '#e9e3a4'];

  const dom = {
    menuButton: $('btn-multiplayer'), lobby: $('mp-lobby-overlay'), close: $('btn-mp-close'),
    status: $('mp-server-status'), name: $('mp-name'), room: $('mp-room'),
    connect: $('btn-mp-connect'), leave: $('btn-mp-leave'), hint: $('mp-connect-hint'),
    playerList: $('mp-player-list'), playerCount: $('mp-player-count'),
    ready: $('btn-mp-ready'), start: $('btn-mp-start'),
    modeButtons: [...document.querySelectorAll('[data-mp-mode]')],
    pveOptions: $('mp-pve-options'), pvpOptions: $('mp-pvp-options'),
    pveButtons: [...document.querySelectorAll('[data-mp-pve]')],
    roundButtons: [...document.querySelectorAll('[data-mp-rounds]')],
    roundCount: $('mp-round-count'), configHint: $('mp-config-hint'), lobbyTip: $('mp-lobby-tip'),
    game: $('mp-game-overlay'), canvas: $('mp-canvas'),
    netHud: $('net-hud'), teamList: $('net-team-list'), teamDamage: $('net-team-damage'),
    engineStatus: $('net-engine-status'), netRound: $('net-round'), netCenter: $('net-center'),
    result: $('net-result-overlay'), resultTitle: $('net-result-title'),
    resultSubtitle: $('net-result-subtitle'), resultTable: $('net-result-table'),
    resultReturn: $('net-result-return'), resultLeave: $('net-result-leave'),
    resultWait: $('net-result-wait'),
  };

  const state = {
    connected: false, id: null, room: '', host: false, ownerId: null,
    players: [], config: { mode: 'pve', pveMode: 'normal', rounds: 5 },
    ready: false, started: false, inGame: false,
    eventSource: null, snap: null, snapBuffer: [], predicted: null, predictedKey: '',
    keys: new Set(), mouse: { x: 0, y: 0, down: false },
    reloadPressed: false, strugglePressed: false, skillPressed: false, upgrade: null, pendingWeapon: null,
    lastInputSent: 0, localName: '干员', localView: null,
    center: null, lastHudAt: 0, lastTime: 0, resultShown: false,
    seenEffects: new Set(), remoteViews: new Map(), weapon: 'pistol', muzzleCd: 0,
  };

  function setText(node, text) {
    if (node && node.textContent !== String(text)) node.textContent = String(text);
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function playerColor(i) { return PLAYER_COLORS[i % PLAYER_COLORS.length]; }
  function charDef(id) {
    try { return window.LabZero?.getCharacterDef?.(id) || { name: CHARACTER_NAMES[id] || '干员', speedMult: 1, bodyScale: 1 }; } catch (_) { return { name: '干员', speedMult: 1, bodyScale: 1 }; }
  }
  function selectedCharacter() {
    try { return window.LabZero?.game?.selectedCharacter || 'alan'; } catch (_) { return 'alan'; }
  }
  function labGame() { return window.LabZero?.game || null; }

  async function request(path, options = {}) {
    const response = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    return data;
  }
  function sendAction(action, payload = {}) {
    if (!state.connected) return Promise.resolve(null);
    return fetch(`${API}/action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: state.room, id: state.id, action, payload }),
    }).catch(() => null);
  }

  async function checkHealth() {
    try {
      await request('/health');
      setText(dom.status, 'LAN 在线');
      dom.status?.classList.add('is-online'); dom.status?.classList.remove('is-offline');
      if (dom.hint) dom.hint.textContent = '服务器已连接。加入后由服务器权威运行战斗。';
      return true;
    } catch (_) {
      setText(dom.status, '服务器未启动');
      dom.status?.classList.add('is-offline'); dom.status?.classList.remove('is-online');
      if (dom.hint) dom.hint.textContent = '未检测到 LAN 服务器。请先运行 node lab-zero/lan-server.js。';
      return false;
    }
  }

  function openLobby() {
    if (!dom.lobby) return;
    dom.lobby.classList.remove('is-hidden');
    document.body.classList.add('mp-lobby-open');
    checkHealth();
    renderLobby();
  }
  function closeLobby() {
    dom.lobby.classList.add('is-hidden');
    document.body.classList.remove('mp-lobby-open');
    if (state.connected) leaveRoom();
  }

  async function connect() {
    if (state.connected) return;
    const name = (dom.name?.value || '干员').trim().slice(0, 20) || '干员';
    const room = (dom.room?.value || 'LABZERO').trim().toUpperCase().slice(0, 20) || 'LABZERO';
    state.localName = name;
    if (dom.connect) { dom.connect.disabled = true; dom.connect.textContent = '连接中…'; }
    try {
      const data = await request('/join', { method: 'POST', body: JSON.stringify({ room, name, character: selectedCharacter() }) });
      state.connected = true; state.id = data.id; state.room = data.room;
      state.ownerId = data.hostId; state.host = data.hostId === data.id;
      state.config = data.config || state.config; state.ready = false;
      setText(dom.status, 'LAN 在线'); dom.status?.classList.add('is-online'); dom.status?.classList.remove('is-offline');
      if (dom.connect) { dom.connect.disabled = true; dom.connect.textContent = '已加入'; }
      if (dom.leave) dom.leave.disabled = false;
      if (dom.name) dom.name.disabled = true;
      if (dom.room) dom.room.disabled = true;
      if (dom.hint) dom.hint.textContent = `已加入频道 ${state.room}。服务器权威运行。`;
      connectEvents(); renderLobby();
    } catch (error) {
      state.connected = false;
      setText(dom.status, '连接失败');
      if (dom.hint) dom.hint.textContent = `加入失败：${error.message || error}`;
      if (dom.connect) { dom.connect.disabled = false; dom.connect.textContent = '加入频道'; }
    }
  }

  function connectEvents() {
    state.eventSource?.close();
    const es = new EventSource(`${API}/events?room=${encodeURIComponent(state.room)}&id=${encodeURIComponent(state.id)}`);
    state.eventSource = es;
    es.addEventListener('hello', (e) => applyLobby(JSON.parse(e.data).room));
    es.addEventListener('lobby', (e) => applyLobby(JSON.parse(e.data)));
    es.addEventListener('host-changed', (e) => {
      const data = JSON.parse(e.data);
      state.ownerId = data.hostId; state.host = data.hostId === state.id;
      if (state.resultShown) {
        dom.resultReturn?.classList.toggle('is-hidden', !state.host);
        dom.resultWait?.classList.toggle('is-hidden', state.host);
      }
      renderLobby();
    });
    es.addEventListener('start', (e) => {
      if (state.inGame) return;
      beginMatch(JSON.parse(e.data));
    });
    es.addEventListener('snapshot', (e) => {
      if (!state.inGame) return;
      const snap = JSON.parse(e.data); snap._at = performance.now();
      state.snap = snap; state.snapBuffer.push(snap);
      if (state.snapBuffer.length > 10) state.snapBuffer.shift();
      reconcilePrediction(snap);
    });
    es.addEventListener('end', () => returnToLobby('本场作战已结束'));
    es.addEventListener('player-left', (e) => {
      const data = JSON.parse(e.data);
      if (state.inGame) setCenter(`${data.name || '队友'} 已离线`, 2200);
    });
    es.onerror = () => { if (state.connected) setText(dom.status, '重连中…'); };
  }

  function applyLobby(payload) {
    if (!payload) return;
    state.ownerId = payload.hostId; state.host = payload.hostId === state.id;
    state.started = !!payload.started; state.players = payload.players || [];
    if (payload.config) state.config = payload.config;
    const me = state.players.find((p) => p.id === state.id);
    if (me) state.ready = !!me.ready;
    renderLobby();
  }

  function renderLobby() {
    if (!dom.lobby) return;
    const connected = state.connected;
    if (dom.connect) dom.connect.disabled = connected;
    if (dom.leave) dom.leave.disabled = !connected;
    if (dom.name) dom.name.disabled = connected;
    if (dom.room) dom.room.disabled = connected;
    if (dom.ready) {
      dom.ready.disabled = !connected || state.started;
      dom.ready.textContent = state.ready ? '取消准备' : '准备就绪';
      dom.ready.classList.toggle('is-ready', state.ready);
    }
    const online = state.players.filter((p) => p.online);
    const readyCount = online.filter((p) => p.ready).length;
    const allReady = online.length > 0 && readyCount === online.length;
    if (dom.start) {
      dom.start.disabled = !connected || !state.host || state.started || !allReady;
      dom.start.textContent = state.host ? (allReady ? '开始作战' : '等待准备') : '等待房主';
    }
    if (dom.playerCount) setText(dom.playerCount, `${online.length} / 8`);
    if (dom.playerList) {
      dom.playerList.innerHTML = online.length ? online.map((p, i) => {
        const self = p.id === state.id;
        const tag = p.host ? '房主' : p.ready ? '已准备' : '在线';
        const cls = p.host ? 'is-host' : p.ready ? 'is-ready' : '';
        return `<div class="mp-player-row"><span class="mp-player-avatar" style="color:${playerColor(i)}">${escapeHtml((p.name || '?').slice(0, 1))}</span><div class="mp-player-info"><b>${escapeHtml(p.name)}${self ? ' · 你' : ''}</b><small>${CHARACTER_NAMES[p.character] || p.character || '干员'}</small></div><span class="mp-player-state ${cls}">${tag}</span></div>`;
      }).join('') : '<div class="mp-empty">等待玩家加入频道。</div>';
    }
    if (dom.lobbyTip) setText(dom.lobbyTip, !connected ? '输入代号与频道后加入房间。' : state.host ? `你是房主 · ${online.length} 人在线 · ${readyCount} 人已准备` : '等待房主开始作战…');
    dom.modeButtons?.forEach((b) => {
      b.classList.toggle('is-active', b.dataset.mpMode === state.config.mode);
      b.disabled = !state.host || state.started;
    });
    dom.pveOptions?.classList.toggle('is-offline', state.config.mode !== 'pve');
    dom.pvpOptions?.classList.toggle('is-offline', state.config.mode !== 'pvp');
    dom.pveButtons?.forEach((b) => {
      b.classList.toggle('is-active', b.dataset.mpPve === state.config.pveMode);
      b.disabled = !state.host || state.started;
    });
    dom.roundButtons?.forEach((b) => { b.disabled = !state.host || state.started; });
    if (dom.roundCount) setText(dom.roundCount, state.config.rounds || 5);
    if (dom.configHint) setText(dom.configHint, state.host ? '服务器权威模式 · 难度随玩家数量自动调整' : '房主设置规则，服务器运行战斗');
  }

  async function leaveRoom() {
    if (!state.connected) return;
    await sendAction('leave', {});
    state.eventSource?.close(); state.eventSource = null;
    state.connected = false; state.id = null; state.room = '';
    state.inGame = false; state.players = []; state.ready = false; state.started = false;
    if (dom.name) dom.name.disabled = false;
    if (dom.room) dom.room.disabled = false;
    if (dom.connect) { dom.connect.disabled = false; dom.connect.textContent = '加入频道'; }
    setText(dom.status, '未加入'); dom.status?.classList.remove('is-online');
    if (dom.hint) dom.hint.textContent = '已离开房间。输入代号与频道重新加入。';
    renderLobby();
  }

  function setCenter(text, ttl = 2200) {
    state.center = text ? { text, until: performance.now() + ttl } : null;
  }

  function beginMatch(payload) {
    if (state.inGame) return;
    state.inGame = true; state.started = true;
    state.ownerId = payload.hostId; state.host = payload.hostId === state.id;
    state.config = payload.config || state.config;
    state.snap = null; state.snapBuffer = []; state.predicted = null; state.predictedKey = '';
    state.localView = null; state.resultShown = false; state.seenEffects.clear();
    state.keys.clear(); state.mouse.down = false; state.ready = false; state.remoteViews = new Map();
    dom.lobby.classList.add('is-hidden');
    dom.game.classList.add('is-hidden');
    dom.netHud.classList.remove('is-hidden');
    dom.result.classList.add('is-hidden');
    document.body.classList.add('mp-in-game');
    const game = labGame();
    if (!game) return;
    game.player = null;
    game.networkPlayers = [];
    game.enemies = [];
    game.bullets = [];
    game.enemyBullets = [];
    game.networkBarrels = [];
    game.networkMedkits = [];
    game.networkPvp = state.config.mode === 'pvp';
    game.networkRound = 1;
    game.networkRounds = state.config.rounds;
    game.networkPhase = 'countdown';
    game.networkAliveCount = 0;
    game.networkResult = null;
    LabZero.startNetworkView({
      pvp: state.config.mode === 'pvp', biome: 'lab', wave: 1,
      tick: networkTick, onEscape: () => leaveBattle(),
    });
    state.lastTime = performance.now();
    state.lastHudAt = 0;
    setCenter('服务器正在同步战场…', 1800);
    sendInput(true);
  }

  function returnToLobby(reason) {
    if (!state.inGame) return;
    state.inGame = false;
    state.started = false; state.ready = false;
    state.snap = null; state.snapBuffer = []; state.predicted = null; state.predictedKey = '';
    state.localView = null; state.remoteViews = new Map();
    state.keys.clear(); state.mouse.down = false;
    dom.netHud.classList.add('is-hidden');
    dom.result.classList.add('is-hidden');
    document.body.classList.remove('mp-in-game');
    LabZero.stopNetworkView();
    dom.lobby.classList.remove('is-hidden');
    if (reason && dom.hint) dom.hint.textContent = reason;
    renderLobby();
  }

  async function leaveBattle() {
    if (!state.inGame) return;
    await sendAction('leave', {});
    state.eventSource?.close(); state.eventSource = null; state.connected = false;
    state.inGame = false; state.started = false; state.ready = false; state.players = [];
    dom.netHud.classList.add('is-hidden'); dom.result.classList.add('is-hidden');
    document.body.classList.remove('mp-in-game');
    LabZero.stopNetworkView();
    if (dom.connect) { dom.connect.disabled = false; dom.connect.textContent = '加入频道'; }
    if (dom.name) dom.name.disabled = false;
    if (dom.room) dom.room.disabled = false;
    if (dom.hint) dom.hint.textContent = '已离开战斗。';
    setText(dom.status, '未加入'); dom.status?.classList.remove('is-online');
    renderLobby();
  }

  function reconcilePrediction(snap) {
    const local = snap?.players?.find((p) => p.id === state.id);
    if (!local) { state.predicted = null; return; }
    const key = `${snap.mode}:${snap.phase}:${snap.round}:${snap.wave}`;
    if (!state.predicted || state.predictedKey !== key || !local.alive || local.downed) {
      state.predicted = { x: local.x, y: local.y, angle: local.angle, r: local.r || 16 };
      state.predictedKey = key;
      return;
    }
    const error = dist(state.predicted.x, state.predicted.y, local.x, local.y);
    if (error > 96) { state.predicted.x = local.x; state.predicted.y = local.y; }
  }

  function updatePrediction(dt) {
    const snap = state.snap; const local = snap?.players?.find((p) => p.id === state.id);
    if (!local) return;
    if (!state.predicted) state.predicted = { x: local.x, y: local.y, angle: local.angle, r: local.r || 16 };
    const p = state.predicted;
    p.r = local.r || 16;
    const camera = labGame()?.camera || { x: 0, y: 0 };
    const aimX = camera.x + state.mouse.x / ZOOM;
    const aimY = camera.y + state.mouse.y / ZOOM;
    p.angle = Math.atan2(aimY - p.y, aimX - p.x);
    if (!local.alive || local.downed || local.entangled || local.paralyzed > 0 || local.reviveLocked || snap.phase !== 'active') {
      p.x = local.x; p.y = local.y;
      return;
    }
    const up = state.keys.has('KeyW') || state.keys.has('ArrowUp');
    const down = state.keys.has('KeyS') || state.keys.has('ArrowDown');
    const left = state.keys.has('KeyA') || state.keys.has('ArrowLeft');
    const right = state.keys.has('KeyD') || state.keys.has('ArrowRight');
    let dx = (right ? 1 : 0) - (left ? 1 : 0);
    let dy = (down ? 1 : 0) - (up ? 1 : 0);
    const len = Math.hypot(dx, dy);
    if (len) {
      dx /= len; dy /= len;
      const speed = (local.speedBase || 225) * (local.weaponMobility || 1);
      const block = window.LabZero?.isPositionBlocked;
      const nx = p.x + dx * speed * dt;
      if (!block || !block(nx, p.y, p.r)) p.x = nx;
      const ny = p.y + dy * speed * dt;
      if (!block || !block(p.x, ny, p.r)) p.y = ny;
    }
    if (dist(p.x, p.y, local.x, local.y) > 96) { p.x = local.x; p.y = local.y; }
  }

  function lerpAngle(a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return a + d * t;
  }
  function snapshotMeta(s) { return `${s.mode}:${s.phase}:${s.round}:${s.wave}`; }

  function interpolateSnapshot(a, b, alpha) {
    const out = { ...b };
    out.players = (b.players || []).map((p) => {
      const old = a.players?.find((x) => x.id === p.id);
      return old ? { ...p, x: lerp(old.x, p.x, alpha), y: lerp(old.y, p.y, alpha), angle: lerpAngle(old.angle, p.angle, alpha) } : p;
    });
    out.enemies = (b.enemies || []).map((e) => {
      const old = a.enemies?.find((x) => x.id === e.id);
      return old ? { ...e, x: lerp(old.x, e.x, alpha), y: lerp(old.y, e.y, alpha), aimAngle: lerpAngle(old.aimAngle || 0, e.aimAngle || 0, alpha) } : e;
    });
    out.bullets = (b.bullets || []).map((x) => {
      const old = a.bullets?.find((v) => v.id === x.id);
      return old ? { ...x, x: lerp(old.x, x.x, alpha), y: lerp(old.y, x.y, alpha) } : x;
    });
    out.enemyBullets = (b.enemyBullets || []).map((x) => {
      const old = a.enemyBullets?.find((v) => v.id === x.id);
      return old ? { ...x, x: lerp(old.x, x.x, alpha), y: lerp(old.y, x.y, alpha) } : x;
    });
    return out;
  }

  function renderSnapshot() {
    const buffer = state.snapBuffer;
    if (!buffer.length) return state.snap;
    if (buffer.length < 2) return buffer[buffer.length - 1];
    const target = performance.now() - 70;
    let older = buffer[0]; let newer = buffer[1];
    for (let i = 0; i < buffer.length - 1; i += 1) {
      if (buffer[i]._at <= target && target <= buffer[i + 1]._at) { older = buffer[i]; newer = buffer[i + 1]; break; }
    }
    if (target <= buffer[0]._at) return buffer[0];
    if (target >= buffer[buffer.length - 1]._at) return buffer[buffer.length - 1];
    if (snapshotMeta(older) !== snapshotMeta(newer)) return newer;
    return interpolateSnapshot(older, newer, clamp((target - older._at) / Math.max(1, newer._at - older._at), 0, 1));
  }

  function normalizeRemote(p, dt) {
    const old = state.remoteViews?.get(p.id);
    const view = old || { walkPhase: 0, moving: false };
    view.walkPhase += (p.moving ? dt * 9 : 0);
    Object.assign(view, p, {
      characterId: p.characterId || p.character,
      angle: p.angle, aimAngle: p.angle,
      r: p.r || 16, radius: p.r || 16,
      mods: p.mods || { pistol: { mag: 0, barrel: 0, scope: 0, stock: 0 } },
      owned: p.owned || { pistol: true }, ammo: p.ammo || { pistol: 12 },
      weapon: p.weapon || 'pistol', moving: !!p.moving,
      grenades: p.grenades || { frag: 0, flash: 0, incen: 0 },
      talents: p.talents || {}, talentPoints: 0, reviving: false,
      invuln: p.invuln || 0, hitFlash: p.hitFlash || 0,
      downed: !!p.downed, alive: !!p.alive,
      entangleEnemy: null,
    });
    state.remoteViews.set(p.id, view);
    return view;
  }

  function normalizeEnemy(e) {
    return {
      ...e, radius: e.r, r: e.r, aimAngle: e.aimAngle || e.angle || 0,
      angle: e.aimAngle || e.angle || 0, dead: false, maxHp: e.maxHp,
      spawnMax: e.spawnMax || 0.9, attackAnim: e.attackAnim || 0,
      hitFlash: e.hitFlash || 0, windup: e.windup || 0,
      telegraph: e.telegraph || 0.3, hasLOS: !!e.hasLOS,
      phase2: !!e.phase2, stunTimer: 0, poisoned: 0,
      faction: e.faction || 'lab', vx: e.vx || 0, vy: e.vy || 0,
    };
  }

  function normalizeBoss(b, enemies) {
    if (!b) return null;
    return enemies.find((e) => e.id === b.id) || {
      ...b, type: 'boss', radius: b.r, r: b.r, aimAngle: b.aimAngle || 0,
      angle: b.aimAngle || 0, dead: false, phase2: false,
    };
  }

  function applyEffects(effects) {
    const game = labGame(); if (!game) return;
    for (const fx of effects || []) {
      if (!fx.id || state.seenEffects.has(fx.id)) continue;
      state.seenEffects.add(fx.id);
      if (state.seenEffects.size > 300) state.seenEffects.clear();
      const life = fx.life || 0.35;
      const maxLife = fx.maxLife || life;
      if (fx.type === 'explosion') {
        game.particles.push({ type: 'flash', x: fx.x, y: fx.y, vx: 0, vy: 0, life: 0.42, maxLife: 0.42, size: 80, color: '255, 179, 110', alpha: 0.6, rot: 0, spin: 0 });
        game.particles.push({ type: 'ring', x: fx.x, y: fx.y, vx: 0, vy: 0, life: 0.38, maxLife: 0.38, size: 95, color: '255, 179, 110', alpha: 0.45, rot: 0, spin: 0 });
      } else if (fx.type === 'muzzle') {
        game.particles.push({ type: 'muzzleFlash', x: fx.x, y: fx.y, vx: 0, vy: 0, life: 0.07, maxLife: 0.07, size: 15, angle: 0, color: '255, 230, 170', alpha: 0.8, rot: 0, spin: 0 });
      } else if (fx.type === 'spark') {
        game.particles.push({ type: 'spark', x: fx.x, y: fx.y, vx: 0, vy: 0, life: 0.15, maxLife: 0.15, size: 2, color: '255, 210, 140', alpha: 0.7, rot: 0, spin: 0 });
      } else if (fx.type === 'death' || fx.type === 'down') {
        for (let i = 0; i < 5; i += 1) game.particles.push({ type: 'smoke', x: fx.x + (Math.random() - 0.5) * 24, y: fx.y + (Math.random() - 0.5) * 18, vx: 0, vy: 0, life: 0.5, maxLife: 0.5, size: 12, color: '120, 72, 54', alpha: 0.3, rot: 0, spin: 0 });
      }
    }
    const cap = 260;
    if (game.particles.length > cap) game.particles.splice(0, game.particles.length - cap);
  }

  function syncGame(dt) {
    const game = labGame(); if (!game) return;
    const data = renderSnapshot(); if (!data) return;
    const local = data.players?.find((p) => p.id === state.id);
    if (!local) return;
    const view = state.localView || {};
    state.localView = view;
    Object.assign(view, local, {
      characterId: local.characterId || local.character,
      r: local.r || 16, radius: local.r || 16,
      aimAngle: local.angle, angle: local.angle,
      mods: local.mods || { pistol: { mag: 0, barrel: 0, scope: 0, stock: 0 } },
      owned: local.owned || { pistol: true }, ammo: local.ammo || { pistol: 12 },
      weapon: local.weapon || 'pistol', moving: !!(local.moving || state.keys.size),
      speedBase: local.speedBase || 225, weaponMobility: local.weaponMobility || 1,
      level: local.level || 1, xp: local.xp || 0, xpNext: local.xpNext || 80,
      talentPoints: 0, talents: {},
      grenades: { frag: 0, flash: 0, incen: 0 },
      selectedGrenade: 'frag', reviving: false, offhand: null,
      dashCooldown: 0, turretCooldown: 0, reviveCooldown: 0,
      entangleEnemy: null, downed: !!local.downed, alive: !!local.alive,
    });
    view.walkPhase = (view.walkPhase || 0) + (view.moving ? dt * 9 : 0);
    if (state.predicted) {
      view.x = state.predicted.x; view.y = state.predicted.y;
      view.angle = state.predicted.angle; view.aimAngle = state.predicted.angle;
    }
    game.player = view;
    game.networkPlayers = (data.players || []).filter((p) => p.id !== state.id).map((p) => normalizeRemote(p, dt));
    const enemies = (data.enemies || []).map(normalizeEnemy);
    game.enemies = enemies;
    game.bossRef = normalizeBoss(data.boss, enemies);
    game.bullets = (data.bullets || []).map((b) => ({ ...b, x: b.x, y: b.y, vx: b.vx, vy: b.vy, color: b.color, friendly: true }));
    game.enemyBullets = (data.enemyBullets || []).map((b) => ({ ...b, x: b.x, y: b.y, vx: b.vx, vy: b.vy, color: b.color, r: b.radius || 4, radius: b.radius || 4, hostile: true }));
    game.networkBarrels = data.barrels || [];
    game.playerPoisonZones = (data.zones || []).map((z) => ({ ...z, radius: z.r || z.radius || 105 }));
    game.zones = [];
    game.networkMedkits = data.medkits || [];
    game.networkPvp = data.mode === 'pvp';
    game.networkPhase = data.phase;
    game.networkRound = data.round || 1;
    game.networkRounds = data.rounds || state.config.rounds;
    game.networkAliveCount = (data.players || []).filter((p) => p.alive).length;
    game.networkResult = data.result || null;
    game.players = data.players || [];
    game.wave = data.wave || 1;
    game.waveActive = data.phase === 'active';
    game.waveTotal = Math.max(1, enemies.length);
    game.intermission = false;
    game.endlessBiome = data.biome || 'lab';
    game.bossRef = game.bossRef;
    game.shake = Math.max(0, (game.shake || 0) * Math.exp(-5 * dt));
    game.hitFlash = Math.max(game.hitFlash || 0, local.hitFlash || 0);
    LabZero.centerNetworkCamera();
    applyEffects(data.effects);
    for (const p of game.particles) { p.life -= dt; }
    game.particles = game.particles.filter((p) => p.life > 0);
    for (const tracer of game.networkTracers || []) tracer.life -= dt;
    game.networkTracers = (game.networkTracers || []).filter((t) => t.life > 0);
    state.lastData = data;
    state.lastHudAt += dt;
    if (state.lastHudAt >= 1 / 30) {
      state.lastHudAt = 0;
      LabZero.updateHUD?.();
      updateNetHud(data);
    }
    renderResult(data);
  }

  function updateNetHud(data) {
    const players = data.players || [];
    const local = players.find((p) => p.id === state.id);
    if (dom.teamList) {
      dom.teamList.innerHTML = players.map((p) => {
        const cls = !p.alive && !p.downed ? 'is-dead' : p.downed ? 'is-down' : '';
        return `<div class="net-team-row ${cls}"><i style="background:${p.color || '#67ecdd'};color:${p.color || '#67ecdd'}"></i><span>${escapeHtml(p.name)}</span><b>${p.downed ? 'DOW' : Math.max(0, Math.ceil(p.hp))}</b></div>`;
      }).join('');
    }
    setText(dom.teamDamage, formatInt(data.teamDamage || 0));
    setText(dom.engineStatus, state.host ? 'SERVER · 房主' : 'SERVER AUTHORITY');
    if (dom.netRound) {
      if (data.mode === 'pvp') {
        dom.netRound.classList.remove('is-hidden');
        dom.netRound.innerHTML = `回合 <b>${data.round || 1} / ${data.rounds || 1}</b> · 存活 ${players.filter((p) => p.alive).length}/${players.length}<br>Z / X / C 强化`;
      } else {
        dom.netRound.classList.add('is-hidden');
      }
    }
    let center = '';
    if (state.center && performance.now() < state.center.until) center = `<b>${escapeHtml(state.center.text)}</b>`;
    if (!center && data.phase === 'countdown' && data.countdown > 0) center = `<b>${data.mode === 'pvp' ? `回合 ${data.round || 1}` : '作战准备'}</b>${Math.ceil(data.countdown)}`;
    if (!center && local?.entangled) center = `<b>快速连按 F 挣脱</b>${Math.max(0, local.entangleTimer || 0).toFixed(1)}s`;
    if (!center && local?.downed) center = '<b>你已阵亡</b>等待队友按住 E 救援';
    if (!center && local?.alive && data.mode === 'pve') {
      const downed = players.find((p) => p.id !== local.id && p.downed && dist(local.x, local.y, p.x, p.y) < 76);
      if (downed) center = `<b>按住 E 救援 ${escapeHtml(downed.name)}</b>${local.character === 'lifeline' ? '浮游无人机可在移动中救援' : '救援期间无法移动'}`;
    }
    if (!center && data.phase === 'roundSummary' && data.roundSummary) center = `<b>回合 ${data.roundSummary.round} 结算</b>下一回合即将开始`;
    if (!center && data.phase === 'result') center = '<b>作战结束</b>查看结算';
    if (dom.netCenter) {
      dom.netCenter.classList.toggle('is-hidden', !center);
      if (center && dom.netCenter.innerHTML !== center) dom.netCenter.innerHTML = center;
    }
  }

  function renderResult(data) {
    const result = data.result;
    if (!result) {
      if (state.resultShown) { dom.result.classList.add('is-hidden'); state.resultShown = false; }
      return;
    }
    if (state.resultShown) return;
    state.resultShown = true;
    setText(dom.resultTitle, result.title || '作战结束');
    setText(dom.resultSubtitle, result.subtitle || '');
    const rows = result.rows || [];
    const pvp = result.type === 'pvp';
    const head = pvp
      ? '<tr><th>排名</th><th>干员</th><th>击杀</th><th>阵亡</th><th>伤害</th><th>积分</th><th>CR</th><th>TP</th></tr>'
      : '<tr><th>干员</th><th>伤害</th><th>击杀</th><th>阵亡</th><th>救援</th></tr>';
    const body = rows.map((r) => pvp
      ? `<tr><td>#${r.rank}</td><td>${escapeHtml(r.name)}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${formatInt(r.damage)}</td><td>${r.score}</td><td>${formatInt(r.credits)}</td><td>${r.tech}</td></tr>`
      : `<tr><td>${escapeHtml(r.name)}</td><td>${formatInt(r.damage)}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.revives}</td></tr>`).join('');
    dom.resultTable.innerHTML = `<table>${head}${body}</table>`;
    dom.resultReturn.classList.toggle('is-hidden', !state.host);
    dom.resultWait.classList.toggle('is-hidden', state.host);
    dom.result.classList.remove('is-hidden');
    dom.netCenter.classList.add('is-hidden');
  }

  function sendInput(force = false) {
    if (!state.inGame || !state.connected) return;
    const now = performance.now();
    if (!force && now - state.lastInputSent < 1000 / 30) return;
    state.lastInputSent = now;
    const camera = labGame()?.camera || { x: 0, y: 0 };
    const aim = Math.atan2((camera.y + state.mouse.y / ZOOM) - (state.predicted?.y || 0), (camera.x + state.mouse.x / ZOOM) - (state.predicted?.x || 0));
    const input = {
      up: state.keys.has('KeyW') || state.keys.has('ArrowUp'),
      down: state.keys.has('KeyS') || state.keys.has('ArrowDown'),
      left: state.keys.has('KeyA') || state.keys.has('ArrowLeft'),
      right: state.keys.has('KeyD') || state.keys.has('ArrowRight'),
      fire: state.mouse.down,
      reload: state.reloadPressed,
      revive: state.keys.has('KeyE'),
      struggle: state.strugglePressed,
      skill: state.skillPressed,
      upgrade: state.upgrade,
      weapon: state.pendingWeapon,
      aim,
    };
    state.reloadPressed = false; state.strugglePressed = false; state.skillPressed = false; state.upgrade = null; state.pendingWeapon = null;
    if (input.fire && state.snap?.phase === 'active' && state.localView?.alive && !state.localView?.downed) {
      const nowMs = performance.now();
      if (nowMs - (state.muzzleCd || 0) > 80) {
        state.muzzleCd = nowMs;
        const g = labGame();
        if (g) {
          const x = state.predicted?.x || state.localView.x;
          const y = state.predicted?.y || state.localView.y;
          g.particles.push({
            type: 'muzzleFlash', x: x + Math.cos(aim) * 19, y: y + Math.sin(aim) * 19,
            vx: 0, vy: 0, life: 0.07, maxLife: 0.07, size: 17, angle: aim,
            color: '255, 221, 145', alpha: 0.9, rot: 0, spin: 0,
          });
          if (g.particles.length > 300) g.particles.splice(0, g.particles.length - 300);
          g.networkTracers = g.networkTracers || [];
          g.networkTracers.push({
            x: x + Math.cos(aim) * 22, y: y + Math.sin(aim) * 22,
            angle: aim, life: 0.14, maxLife: 0.14,
            color: '255, 234, 181', length: 90 + Math.random() * 50,
          });
          if (g.networkTracers.length > 24) g.networkTracers.splice(0, g.networkTracers.length - 24);
        }
      }
    }
    sendAction('input', input);
  }

  function networkTick(dt) {
    if (!state.inGame) return;
    if (!state.snap) return;
    updatePrediction(dt);
    syncGame(dt);
    sendInput();
  }

  function updateMousePosition(event) {
    if (!state.inGame) return;
    const target = event.target;
    if (target?.closest?.('button, a, input, textarea, select, .mp-lobby-shell, .net-result-card')) return;
    const canvas = $('game');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    state.mouse.x = clamp(event.clientX - rect.left, 0, rect.width);
    state.mouse.y = clamp(event.clientY - rect.top, 0, rect.height);
  }

  function setupInput() {
    window.addEventListener('keydown', (event) => {
      if (!state.inGame) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '')) return;
      const code = event.code;
      if (code === 'Escape') { event.preventDefault(); leaveBattle(); return; }
      state.keys.add(code);
      if (code === 'KeyR') state.reloadPressed = true;
      if (code === 'KeyF') state.strugglePressed = true;
      if (code === 'Space') state.skillPressed = true;
      if (/^Digit[1-5]$/.test(code)) {
        const wid = WEAPON_ORDER[Number(code.slice(5)) - 1];
        if (wid) state.pendingWeapon = wid;
      }
      if (state.config.mode === 'pvp') {
        if (code === 'KeyZ') state.upgrade = 'damage';
        if (code === 'KeyX') state.upgrade = 'armor';
        if (code === 'KeyC') state.upgrade = 'rate';
      }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(code)) event.preventDefault();
      sendInput(true);
    });
    window.addEventListener('keyup', (event) => {
      state.keys.delete(event.code);
      if (state.inGame) sendInput(true);
    });
    const canvas = $('game');
    const beginFire = (event) => {
      if (!state.inGame || event.button !== 0) return;
      const target = event.target;
      if (target?.closest?.('button, a, input, textarea, select, .net-result-card, .mp-lobby-shell')) return;
      updateMousePosition(event);
      state.mouse.down = true;
      sendInput(true);
    };
    // Capture on window as well: HUD panels can overlap the canvas and
    // previously swallowed clicks, making the weapon appear dead.
    window.addEventListener('pointerdown', beginFire, true);
    window.addEventListener('pointerup', (event) => {
      if (event.button === 0) { state.mouse.down = false; if (state.inGame) sendInput(true); }
    }, true);
    window.addEventListener('pointermove', updateMousePosition, true);
    canvas?.addEventListener('pointerdown', beginFire);
    canvas?.addEventListener('pointermove', updateMousePosition);
    canvas?.addEventListener('contextmenu', (event) => event.preventDefault());
    $('weapon-slots')?.addEventListener('click', (event) => {
      if (!state.inGame) return;
      const slot = event.target.closest('.weapon-slot');
      if (!slot) return;
      const wid = slot.dataset.weapon;
      if (WEAPON_ORDER.includes(wid)) { state.pendingWeapon = wid; sendInput(true); }
    });
  }

  function setupLobby() {
    dom.menuButton?.addEventListener('click', openLobby);
    dom.close?.addEventListener('click', closeLobby);
    dom.connect?.addEventListener('click', connect);
    dom.leave?.addEventListener('click', () => { if (state.inGame) leaveBattle(); else leaveRoom(); });
    dom.ready?.addEventListener('click', () => {
      if (!state.connected || state.started) return;
      sendAction('lobby', { ready: !state.ready });
      state.ready = !state.ready; renderLobby();
    });
    dom.start?.addEventListener('click', () => sendAction('start', { config: state.config }));
    dom.modeButtons.forEach((button) => button.addEventListener('click', () => {
      if (!state.host || state.started) return;
      state.config = { ...state.config, mode: button.dataset.mpMode };
      sendAction('lobby', { config: state.config }); renderLobby();
    }));
    dom.pveButtons.forEach((button) => button.addEventListener('click', () => {
      if (!state.host || state.started) return;
      state.config = { ...state.config, pveMode: button.dataset.mpPve };
      sendAction('lobby', { config: state.config }); renderLobby();
    }));
    dom.roundButtons.forEach((button) => button.addEventListener('click', () => {
      if (!state.host || state.started) return;
      const delta = Number(button.dataset.mpRounds) || 0;
      state.config = { ...state.config, rounds: clamp((state.config.rounds || 5) + delta, 1, 10) };
      sendAction('lobby', { config: state.config }); renderLobby();
    }));
    dom.resultReturn?.addEventListener('click', () => { if (state.host) sendAction('end', { reason: '房主结束了本场作战' }); });
    dom.resultLeave?.addEventListener('click', leaveBattle);
    window.addEventListener('beforeunload', () => { if (state.connected) fetch(`${API}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: state.room, id: state.id, action: 'leave', payload: {} }), keepalive: true }).catch(() => {}); });
  }

  setupLobby();
  setupInput();
  window.LabZeroMP = { state, openLobby, beginMatch, returnToLobby, leaveBattle };
})();
