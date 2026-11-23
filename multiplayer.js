/* LAB ZERO // LAN multiplayer
 * Standalone host-authoritative PVE/PVP client. The static game remains
 * untouched; this layer is only active when the player opens the LAN lobby.
 * Requires lan-server.js for SSE + HTTP relay.
 */
(() => {
  'use strict';

  const API = '/api/mp';
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pad2 = (v) => String(v).padStart(2, '0');
  const formatInt = (v) => Math.round(Number(v) || 0).toLocaleString('en-US');

  const dom = {
    menuButton: $('btn-multiplayer'),
    lobby: $('mp-lobby-overlay'),
    close: $('btn-mp-close'),
    status: $('mp-server-status'),
    name: $('mp-name'),
    room: $('mp-room'),
    connect: $('btn-mp-connect'),
    leave: $('btn-mp-leave'),
    hint: $('mp-connect-hint'),
    playerList: $('mp-player-list'),
    playerCount: $('mp-player-count'),
    ready: $('btn-mp-ready'),
    start: $('btn-mp-start'),
    modeButtons: [...document.querySelectorAll('[data-mp-mode]')],
    pveOptions: $('mp-pve-options'),
    pvpOptions: $('mp-pvp-options'),
    pveButtons: [...document.querySelectorAll('[data-mp-pve]')],
    roundButtons: [...document.querySelectorAll('[data-mp-rounds]')],
    roundCount: $('mp-round-count'),
    configHint: $('mp-config-hint'),
    lobbyTip: $('mp-lobby-tip'),
    game: $('mp-game-overlay'),
    canvas: $('mp-canvas'),
    missionKicker: $('mp-mission-kicker'),
    missionTitle: $('mp-mission-title'),
    missionState: $('mp-mission-state'),
    teamDamage: $('mp-team-damage'),
    localName: $('mp-local-name'),
    localCharacter: $('mp-local-character'),
    localHpFill: $('mp-local-hp-fill'),
    localHp: $('mp-local-hp'),
    localAmmo: $('mp-local-ammo'),
    localCredits: $('mp-local-credits'),
    localTech: $('mp-local-tech'),
    upDamage: $('mp-up-damage'),
    upArmor: $('mp-up-armor'),
    upRate: $('mp-up-rate'),
    alive: $('mp-alive-count'),
    roster: $('mp-game-roster'),
    teamDamageBig: $('mp-team-damage-big'),
    bossBar: $('mp-boss-bar'),
    bossName: $('mp-boss-name'),
    bossFill: $('mp-boss-fill'),
    bossHp: $('mp-boss-hp'),
    net: $('mp-net-status'),
    message: $('mp-center-message'),
    result: $('mp-result-panel'),
  };

  const state = {
    connected: false,
    id: null,
    room: '',
    host: false,
    hostId: null,
    players: [],
    config: { mode: 'pve', pveMode: 'normal', rounds: 5 },
    ready: false,
    started: false,
    inGame: false,
    role: 'client',
    eventSource: null,
    lastHealth: 0,
    remoteInputs: {},
    keys: new Set(),
    mouse: { x: 0, y: 0, down: false },
    pendingUpgrade: null,
    camera: { x: 0, y: 0 },
    sim: null,
    snap: null,
    lastInputSent: 0,
    lastSnapshotSent: 0,
    lastLobbySent: 0,
    raf: 0,
    lastTime: 0,
    localName: '干员',
    chatNotice: '',
  };

  const PLAYER_COLORS = ['#67ecdd', '#ffd278', '#ff9d7b', '#b49aff', '#7fc7ff', '#a8f28a', '#ff8fc3', '#e9e3a4'];
  const CHARACTER_NAMES = { alan: '阿兰', lifeline: '命脉', newcastle: '纽卡斯尔', caustic: '凯瑟克', valkyrie: '瓦尔基里' };

  function setText(node, text) {
    if (node && node.textContent !== String(text)) node.textContent = String(text);
  }

  function charDef(id) {
    try {
      if (window.LabZero?.getCharacterDef) return window.LabZero.getCharacterDef(id);
    } catch (_) { /* noop */ }
    return { id: id || 'alan', name: CHARACTER_NAMES[id] || '干员', hpMult: 1, speedMult: 1 };
  }

  function localCharacter() {
    try { return window.LabZero?.game?.selectedCharacter || 'alan'; } catch (_) { return 'alan'; }
  }

  function playerColor(index) {
    return PLAYER_COLORS[index % PLAYER_COLORS.length];
  }

  function setServerStatus(text, mode) {
    if (!dom.status) return;
    setText(dom.status, text);
    dom.status.classList.toggle('is-online', mode === 'online');
    dom.status.classList.toggle('is-offline', mode !== 'online');
  }

  async function request(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    return data;
  }

  function sendAction(action, payload = {}) {
    if (!state.connected) return Promise.resolve(null);
    return fetch(`${API}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: state.room, id: state.id, action, payload }),
    }).catch(() => null);
  }

  async function checkHealth() {
    try {
      const data = await request('/health');
      state.lastHealth = Date.now();
      setServerStatus('LAN 在线', 'online');
      if (dom.hint) dom.hint.textContent = '服务器已连接。输入代号和房间频道后加入。';
      return true;
    } catch (error) {
      setServerStatus('服务器未启动', 'offline');
      if (dom.hint) dom.hint.textContent = '未检测到 LAN 服务器。请用 node lab-zero/lan-server.js 启动，并通过 http://房主IP:端口 打开游戏。';
      return false;
    }
  }

  function openLobby() {
    if (!dom.lobby) return;
    dom.lobby.classList.remove('is-hidden');
    document.body.classList.add('mp-lobby-open');
    if (window.LabZero?.game) window.LabZero.game.lastFrame = 0;
    checkHealth();
    state.pendingUpgrade = null;
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
      const data = await request('/join', {
        method: 'POST',
        body: JSON.stringify({ room, name, character: localCharacter() }),
      });
      state.connected = true;
      state.id = data.id;
      state.room = data.room;
      state.host = !!data.host;
      state.hostId = data.hostId;
      state.config = data.config || state.config;
      state.ready = false;
      setServerStatus('LAN 在线', 'online');
      if (dom.connect) { dom.connect.disabled = true; dom.connect.textContent = '已加入'; }
      if (dom.leave) dom.leave.disabled = false;
      if (dom.name) dom.name.disabled = true;
      if (dom.room) dom.room.disabled = true;
      if (dom.hint) dom.hint.textContent = `已加入频道 ${state.room}。等待房主开始。`;
      connectEvents();
      renderLobby();
    } catch (error) {
      state.connected = false;
      setServerStatus('连接失败', 'offline');
      if (dom.hint) dom.hint.textContent = `加入失败：${error.message || error}`;
      if (dom.connect) { dom.connect.disabled = false; dom.connect.textContent = '加入频道'; }
    }
  }

  function connectEvents() {
    if (state.eventSource) state.eventSource.close();
    const es = new EventSource(`${API}/events?room=${encodeURIComponent(state.room)}&id=${encodeURIComponent(state.id)}`);
    state.eventSource = es;
    es.addEventListener('hello', (event) => {
      const data = JSON.parse(event.data);
      if (data.room) applyLobby(data.room);
    });
    es.addEventListener('lobby', (event) => applyLobby(JSON.parse(event.data)));
    es.addEventListener('host-changed', (event) => {
      const data = JSON.parse(event.data);
      state.hostId = data.hostId;
      state.host = data.hostId === state.id;
      renderLobby();
    });
    es.addEventListener('start', (event) => {
      const data = JSON.parse(event.data);
      if (state.inGame) return;
      beginMatch(data);
    });
    es.addEventListener('snapshot', (event) => {
      if (state.role !== 'client' || !state.inGame) return;
      state.snap = JSON.parse(event.data);
    });
    es.addEventListener('input', (event) => {
      if (state.role !== 'host' || !state.inGame) return;
      const data = JSON.parse(event.data);
      state.remoteInputs[data.id] = data.input || {};
    });
    es.addEventListener('end', (event) => {
      const data = JSON.parse(event.data);
      endMatchFromServer(data);
    });
    es.addEventListener('host-lost', (event) => {
      if (!state.inGame) return;
      showCenter('房主已离开，正在返回大厅…', 5000);
      window.setTimeout(() => returnToLobbyLocal('房主已离线'), 900);
    });
    es.addEventListener('player-left', (event) => {
      const data = JSON.parse(event.data);
      if (state.inGame) showCenter(`${data.name || '队友'} 已离线`, 2200);
      if (state.role === 'host' && state.sim) {
        const player = state.sim.players.find((entry) => entry.id === data.id);
        if (player) {
          player.disconnected = true;
          player.alive = false;
          player.downed = true;
          player.reviveProgress = 0;
        }
      }
    });
    es.onerror = () => {
      if (state.connected) setServerStatus('重连中…', 'offline');
    };
  }

  function applyLobby(payload) {
    if (!payload) return;
    state.hostId = payload.hostId;
    state.host = payload.hostId === state.id;
    state.started = !!payload.started;
    state.players = payload.players || [];
    if (payload.config) state.config = payload.config;
    const me = state.players.find((player) => player.id === state.id);
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
    const online = state.players.filter((player) => player.online);
    const readyCount = online.filter((player) => player.ready).length;
    const allReady = online.length > 0 && readyCount === online.length;
    if (dom.start) {
      dom.start.disabled = !connected || !state.host || state.started || !allReady;
      dom.start.textContent = state.host ? (allReady ? '开始作战' : '等待准备') : '等待房主';
    }
    if (dom.playerCount) setText(dom.playerCount, `${online.length} / 8`);
    if (dom.playerList) {
      dom.playerList.innerHTML = online.length
        ? online.map((player, index) => {
          const isSelf = player.id === state.id;
          const tag = player.host ? '房主' : player.ready ? '已准备' : '在线';
          const tagClass = player.host ? 'is-host' : player.ready ? 'is-ready' : '';
          return `<div class="mp-player-row"><span class="mp-player-avatar" style="color:${playerColor(index)}">${(player.name || '?').slice(0, 1)}</span><div class="mp-player-info"><b>${escapeHtml(player.name)}${isSelf ? ' · 你' : ''}</b><small>${CHARACTER_NAMES[player.character] || player.character || '干员'}</small></div><span class="mp-player-state ${tagClass}">${tag}</span></div>`;
        }).join('')
        : '<div class="mp-empty">还没有玩家加入该频道。</div>';
    }
    if (dom.lobbyTip) {
      setText(dom.lobbyTip, !connected ? '输入代号与频道后加入房间。' : state.host ? `你是房主 · ${online.length} 名在线玩家 · ${readyCount} 人已准备` : '等待房主开始作战…');
    }
    if (dom.modeButtons) {
      dom.modeButtons.forEach((button) => {
        button.classList.toggle('is-active', button.dataset.mpMode === state.config.mode);
        button.disabled = !state.host;
      });
    }
    if (dom.pveOptions) dom.pveOptions.classList.toggle('is-offline', state.config.mode !== 'pve');
    if (dom.pvpOptions) dom.pvpOptions.classList.toggle('is-offline', state.config.mode !== 'pvp');
    if (dom.pveButtons) dom.pveButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.mpPve === state.config.pveMode);
      button.disabled = !state.host;
    });
    if (dom.roundButtons) dom.roundButtons.forEach((button) => { button.disabled = !state.host; });
    setText(dom.roundCount, state.config.rounds || 5);
    if (dom.configHint) {
      dom.configHint.textContent = state.config.mode === 'pvp'
        ? 'PVP：掩体、可爆炸油桶与随机血包。按排名发放信用点 / 科技点。'
        : state.config.pveMode === 'boss'
          ? 'Boss 战：单个大型房间，三名 Boss 循环登场，属性与机制逐轮增强。'
          : '普通：无尽波次；2 人时敌人属性与数量 +50%，3 人及以上 +100%。';
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function toggleReady() {
    if (!state.connected) return;
    state.ready = !state.ready;
    sendAction('lobby', { ready: state.ready });
    renderLobby();
  }

  function startMatch() {
    if (!state.connected || !state.host) return;
    sendAction('start', { config: state.config });
  }

  function leaveRoom() {
    if (!state.connected) return;
    sendAction('leave', {});
    state.connected = false;
    state.eventSource?.close();
    state.eventSource = null;
    state.players = [];
    state.ready = false;
    if (dom.connect) { dom.connect.disabled = false; dom.connect.textContent = '加入频道'; }
    if (dom.leave) dom.leave.disabled = true;
    if (dom.name) dom.name.disabled = false;
    if (dom.room) dom.room.disabled = false;
    setServerStatus('未连接', 'offline');
    renderLobby();
  }

  // Menu / lobby event wiring.
  dom.menuButton?.addEventListener('click', openLobby);
  dom.close?.addEventListener('click', closeLobby);
  dom.connect?.addEventListener('click', connect);
  dom.leave?.addEventListener('click', leaveRoom);
  dom.ready?.addEventListener('click', toggleReady);
  dom.start?.addEventListener('click', startMatch);
  dom.modeButtons?.forEach((button) => button.addEventListener('click', () => {
    if (!state.host) return;
    state.config.mode = button.dataset.mpMode === 'pvp' ? 'pvp' : 'pve';
    sendAction('lobby', { config: state.config });
    renderLobby();
  }));
  dom.pveButtons?.forEach((button) => button.addEventListener('click', () => {
    if (!state.host) return;
    state.config.pveMode = button.dataset.mpPve === 'boss' ? 'boss' : 'normal';
    sendAction('lobby', { config: state.config });
    renderLobby();
  }));
  dom.roundButtons?.forEach((button) => button.addEventListener('click', () => {
    if (!state.host) return;
    state.config.rounds = clamp((state.config.rounds || 5) + Number(button.dataset.mpRounds || 0), 1, 10);
    sendAction('lobby', { config: state.config });
    renderLobby();
  }));

  window.addEventListener('beforeunload', () => {
    if (state.connected) {
      try {
        navigator.sendBeacon?.(`${API}/action`, new Blob([JSON.stringify({ room: state.room, id: state.id, action: 'leave', payload: {} })], { type: 'application/json' }));
      } catch (_) { /* noop */ }
    }
  });

  // -------------------------------------------------------------------------
  // Match simulation
  // -------------------------------------------------------------------------
  const ARENA = { w: 1900, h: 1250 };
  const PLAYER_R = 16;
  const PLAYER_SPEED = 245;
  const WEAPON = { damage: 13, fireDelay: 0.115, bulletSpeed: 930, ammo: 30, reload: 1.45, range: 1.5 };
  const PVP_START_CREDITS = 1145;
  const PVP_START_TECH = 5;
  const PVP_REWARD_CREDITS = [300, 220, 160, 120, 90, 70, 50, 40];
  const PVP_REWARD_TECH = [3, 3, 2, 2, 1, 1, 1, 0];
  const UPGRADE_COST = { damage: [250, 300, 360, 430, 520], armor: [300, 360, 430, 520], rate: [3, 4, 5, 6, 8] };
  let ctx = null;
  let lastFrame = 0;

  function teamScale() {
    const count = Math.max(1, state.sim?.players?.length || state.players.length || 1);
    return count >= 3 ? 2 : count === 2 ? 1.5 : 1;
  }

  function arenaSpawn(index, count) {
    const cx = ARENA.w / 2;
    const cy = ARENA.h / 2;
    const angle = (index / Math.max(1, count)) * TAU + (state.config.mode === 'pvp' ? Math.PI / 4 : 0);
    const radius = state.config.mode === 'pvp' ? 470 : 150 + (index % 2) * 90;
    return { x: clamp(cx + Math.cos(angle) * radius, 80, ARENA.w - 80), y: clamp(cy + Math.sin(angle) * radius, 80, ARENA.h - 80) };
  }

  function createMapLayout(mode, pveMode) {
    const obstacles = [];
    const barrels = [];
    if (mode === 'pvp') {
      const rects = [
        [420, 260, 150, 46], [980, 280, 46, 190], [1440, 220, 190, 46],
        [300, 680, 46, 210], [720, 560, 180, 46], [1040, 720, 46, 180],
        [1320, 590, 200, 46], [560, 950, 46, 150], [910, 920, 160, 46],
      ];
      rects.forEach(([x, y, w, h]) => obstacles.push({ x, y, w, h, type: 'cover' }));
      barrels.push(
        { x: 690, y: 390, r: 15, hp: 40 },
        { x: 1230, y: 420, r: 15, hp: 40 },
        { x: 520, y: 820, r: 15, hp: 40 },
        { x: 1380, y: 850, r: 15, hp: 40 },
      );
    } else if (pveMode === 'boss') {
      obstacles.push(
        { x: 380, y: 360, w: 100, h: 100, type: 'pillar' },
        { x: 1420, y: 360, w: 100, h: 100, type: 'pillar' },
        { x: 380, y: 800, w: 100, h: 100, type: 'pillar' },
        { x: 1420, y: 800, w: 100, h: 100, type: 'pillar' },
      );
    } else {
      obstacles.push(
        { x: 430, y: 330, w: 120, h: 58, type: 'cover' },
        { x: 1340, y: 300, w: 58, h: 150, type: 'cover' },
        { x: 800, y: 580, w: 160, h: 58, type: 'cover' },
        { x: 300, y: 860, w: 58, h: 160, type: 'cover' },
        { x: 1480, y: 840, w: 120, h: 58, type: 'cover' },
      );
    }
    return { obstacles, barrels };
  }

  function makeHostPlayer(info, index, count) {
    const character = charDef(info.character || 'alan');
    const spawn = arenaSpawn(index, count);
    const maxHp = Math.round(100 * (Number(character.hpMult) || 1));
    const pvp = state.config.mode === 'pvp';
    return {
      id: info.id,
      name: info.name || `干员 ${index + 1}`,
      character: info.character || 'alan',
      color: playerColor(index),
      x: spawn.x,
      y: spawn.y,
      r: PLAYER_R,
      angle: Math.atan2(ARENA.h / 2 - spawn.y, ARENA.w / 2 - spawn.x),
      hp: maxHp,
      maxHp,
      alive: true,
      downed: false,
      reviveProgress: 0,
      reviveBy: null,
      reviveLocked: false,
      ammo: WEAPON.ammo,
      maxAmmo: WEAPON.ammo,
      reloading: false,
      reloadTimer: 0,
      fireCd: 0,
      damage: 0,
      kills: 0,
      deaths: 0,
      revives: 0,
      credits: pvp ? PVP_START_CREDITS : 0,
      tech: pvp ? PVP_START_TECH : 0,
      upgrades: { damage: 0, armor: 0, rate: 0 },
      rank: 0,
      score: 0,
      input: {},
      isHost: info.id === state.hostId,
      isLocal: info.id === state.id,
    };
  }

  function initializeHostSimulation(payload) {
    const config = payload.config || state.config;
    const layout = createMapLayout(config.mode, config.pveMode);
    const players = (payload.players || state.players).map((info, index, list) => makeHostPlayer(info, index, list.length));
    const sim = {
      time: 0,
      mode: config.mode === 'pvp' ? 'pvp' : 'pve',
      pveMode: config.pveMode === 'boss' ? 'boss' : 'normal',
      rounds: config.rounds || 5,
      round: 1,
      phase: 'countdown',
      countdown: config.mode === 'pvp' ? 3.2 : 1.7,
      roundTime: 0,
      players,
      enemies: [],
      bullets: [],
      effects: [],
      zones: [],
      barrels: layout.barrels.map((barrel) => ({ ...barrel, exploded: false })),
      medkits: [],
      obstacles: layout.obstacles,
      boss: null,
      pveBossIndex: 0,
      pveBossCycle: 0,
      wave: 0,
      waveTimer: 2.4,
      waveClear: false,
      teamDamage: 0,
      pvpDeathOrder: [],
      roundSummary: null,
      result: null,
      message: '',
      messageUntil: 0,
      medkitTimer: 0,
    };
    state.sim = sim;
    if (sim.mode === 'pve' && sim.pveMode === 'normal') {
      sim.wave = 0;
      sim.waveTimer = 2.4;
    }
    if (sim.mode === 'pve' && sim.pveMode === 'boss') {
      sim.waveTimer = 0.6;
    }
    if (sim.mode === 'pvp') setupPvpRound(sim, 1);
  }

  function beginMatch(payload) {
    if (state.inGame) return;
    state.inGame = true;
    state.started = true;
    state.config = payload.config || state.config;
    state.hostId = payload.hostId;
    state.host = state.hostId === state.id;
    state.role = state.host ? 'host' : 'client';
    state.remoteInputs = {};
    state.pendingUpgrade = null;
    state.keys.clear();
    state.mouse.down = false;
    state.reloadPressed = false;
    state.lastInputSent = 0;
    state.lastSnapshotSent = 0;
    state.snap = null;
    dom.lobby.classList.add('is-hidden');
    dom.game.classList.remove('is-hidden');
    document.body.classList.add('mp-in-game');
    dom.result.classList.add('is-hidden');
    showCenter('', 0);
    resizeMpCanvas();
    if (state.role === 'host') {
      initializeHostSimulation(payload);
    } else {
      state.sim = null;
    }
    state.lastTime = performance.now();
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(mpLoop);
    if (state.role === 'host') {
      sendSnapshotSoon();
    }
  }

  function resizeMpCanvas() {
    if (!dom.canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = dom.canvas.getBoundingClientRect();
    dom.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    dom.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx = dom.canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.viewW = rect.width;
    state.viewH = rect.height;
  }

  function isBlocked(x, y, radius, obstacles = []) {
    if (x < 40 || y < 40 || x > ARENA.w - 40 || y > ARENA.h - 40) return true;
    for (const obstacle of obstacles) {
      const nx = clamp(x, obstacle.x, obstacle.x + obstacle.w);
      const ny = clamp(y, obstacle.y, obstacle.y + obstacle.h);
      if (Math.hypot(x - nx, y - ny) < radius) return true;
    }
    return false;
  }

  function movePlayer(p, dx, dy) {
    const obstacles = state.sim?.obstacles || [];
    const nx = p.x + dx;
    if (!isBlocked(nx, p.y, p.r, obstacles)) p.x = nx;
    const ny = p.y + dy;
    if (!isBlocked(p.x, ny, p.r, obstacles)) p.y = ny;
    p.x = clamp(p.x, 42, ARENA.w - 42);
    p.y = clamp(p.y, 42, ARENA.h - 42);
  }

  function localPlayer() {
    if (state.role === 'host') return state.sim?.players.find((player) => player.id === state.id) || null;
    return state.snap?.players?.find((player) => player.id === state.id) || null;
  }

  function mouseWorld() {
    const p = localPlayer();
    const camera = cameraFor(p);
    return { x: camera.x + state.mouse.x, y: camera.y + state.mouse.y };
  }

  function cameraFor(p) {
    const viewW = state.viewW || 1440;
    const viewH = state.viewH || 900;
    if (!p) return { x: 0, y: 0 };
    return {
      x: clamp(p.x - viewW / 2, 0, Math.max(0, ARENA.w - viewW)),
      y: clamp(p.y - viewH / 2, 0, Math.max(0, ARENA.h - viewH)),
    };
  }

  function playerInputForHost(p) {
    if (p.isLocal) {
      const m = mouseWorld();
      const angle = p ? Math.atan2(m.y - p.y, m.x - p.x) : p.angle;
      return {
        up: state.keys.has('KeyW') || state.keys.has('ArrowUp'),
        down: state.keys.has('KeyS') || state.keys.has('ArrowDown'),
        left: state.keys.has('KeyA') || state.keys.has('ArrowLeft'),
        right: state.keys.has('KeyD') || state.keys.has('ArrowRight'),
        fire: state.mouse.down,
        reload: !!state.reloadPressed,
        revive: state.keys.has('KeyE'),
        upgrade: state.pendingUpgrade,
        aim: angle,
      };
    }
    return state.remoteInputs[p.id] || {};
  }

  function sendClientInput() {
    if (state.role !== 'client' || !state.inGame) return;
    const now = performance.now();
    if (now - state.lastInputSent < 45) return;
    state.lastInputSent = now;
    const p = localPlayer();
    let aim = p?.angle || 0;
    if (p) {
      const m = mouseWorld();
      aim = Math.atan2(m.y - p.y, m.x - p.x);
    }
    const input = {
      up: state.keys.has('KeyW') || state.keys.has('ArrowUp'),
      down: state.keys.has('KeyS') || state.keys.has('ArrowDown'),
      left: state.keys.has('KeyA') || state.keys.has('ArrowLeft'),
      right: state.keys.has('KeyD') || state.keys.has('ArrowRight'),
      fire: state.mouse.down,
      reload: !!state.reloadPressed,
      revive: state.keys.has('KeyE'),
      upgrade: state.pendingUpgrade,
      aim,
    };
    state.pendingUpgrade = null;
    sendAction('input', input);
  }

  function aimFromInput(p, input) {
    if (Number.isFinite(input.aim)) p.angle = input.aim;
  }

  function buyUpgrade(p, type) {
    if (state.sim?.mode !== 'pvp' || !UPGRADE_COST[type]) return;
    const level = p.upgrades[type] || 0;
    const costs = UPGRADE_COST[type];
    if (level >= costs.length) {
      pushNotice(p.isLocal ? '该升级已满级' : '', 1400);
      return;
    }
    const cost = costs[level];
    if (type === 'rate') {
      if (p.tech < cost) return;
      p.tech -= cost;
    } else {
      if (p.credits < cost) return;
      p.credits -= cost;
    }
    p.upgrades[type] = level + 1;
    if (type === 'armor') {
      p.maxHp += 25;
      p.hp = Math.min(p.maxHp, p.hp + 25);
    }
    pushNotice(`${p.name} 购买了${type === 'damage' ? '伤害' : type === 'armor' ? '护甲' : '射速'}强化`, 1200);
  }

  function pushNotice(text, ttl = 1600) {
    if (!text) return;
    if (state.role === 'host') {
      state.sim.message = text;
      state.sim.messageUntil = state.sim.time + ttl / 1000;
    } else {
      showCenter(text, ttl);
    }
  }

  function updateHostPlayers(dt) {
    const sim = state.sim;
    for (const p of sim.players) {
      p.fireCd = Math.max(0, p.fireCd - dt);
      p.invuln = Math.max(0, (p.invuln || 0) - dt);
      if (p.downed) {
        p.reviveProgress = Math.max(0, p.reviveProgress || 0);
        continue;
      }
      if (!p.alive) continue;
      const input = playerInputForHost(p);
      p.input = input;
      if (input.upgrade) {
        buyUpgrade(p, input.upgrade);
        if (p.isLocal) state.pendingUpgrade = null;
      }
      p.reviveLocked = false;
      if (input.revive) {
        const target = sim.players
          .filter((other) => other.id !== p.id && other.downed && !other.disconnected && dist(p.x, p.y, other.x, other.y) < 76)
          .sort((a, b) => dist(p.x, p.y, a.x, a.y) - dist(p.x, p.y, b.x, b.y))[0];
        if (target) {
          target.reviveProgress = (target.reviveProgress || 0) + dt;
          target.reviveBy = p.id;
          target.reviveTouched = true;
          p.reviveLocked = p.character !== 'lifeline';
          if (target.reviveProgress >= 3) {
            target.downed = false;
            target.alive = true;
            target.hp = Math.ceil(target.maxHp * 0.5);
            target.reviveProgress = 0;
            target.reviveBy = null;
            p.revives += 1;
            sim.effects.push({ type: 'revive', x: target.x, y: target.y, life: 0.7, maxLife: 0.7, color: '#9bffd3' });
          }
        }
      }
      if (p.reviveLocked) {
        p.vx = 0;
        p.vy = 0;
      } else {
        let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          dx /= len;
          dy /= len;
          const speed = PLAYER_SPEED * (charDef(p.character).speedMult || 1) * (p.downed ? 0 : 1);
          movePlayer(p, dx * speed * dt, dy * speed * dt);
        }
        p.moving = len > 0;
      }
      aimFromInput(p, input);
      if (p.reloading) {
        p.reloadTimer -= dt;
        if (p.reloadTimer <= 0) {
          p.reloading = false;
          p.ammo = p.maxAmmo;
        }
      } else if (input.reload && p.ammo < p.maxAmmo) {
        p.reloading = true;
        p.reloadTimer = WEAPON.reload;
      }
      if (!p.reloading && p.fireCd <= 0 && input.fire && p.ammo > 0 && sim.phase === 'active') {
        p.ammo -= 1;
        p.fireCd = WEAPON.fireDelay * (1 - (p.upgrades.rate || 0) * 0.08);
        const damage = WEAPON.damage * (1 + (p.upgrades.damage || 0) * 0.15);
        const spread = rand(-0.025, 0.025);
        const angle = p.angle + spread;
        const muzzle = p.r + 8;
        sim.bullets.push({
          x: p.x + Math.cos(angle) * muzzle,
          y: p.y + Math.sin(angle) * muzzle,
          vx: Math.cos(angle) * WEAPON.bulletSpeed,
          vy: Math.sin(angle) * WEAPON.bulletSpeed,
          damage, owner: p.id, color: p.color, life: WEAPON.range, friendly: true,
        });
        sim.effects.push({ type: 'muzzle', x: p.x + Math.cos(angle) * 22, y: p.y + Math.sin(angle) * 22, life: 0.07, maxLife: 0.07, color: p.color });
      }
    }
    for (const p of sim.players) {
      if (p.downed && !p.reviveTouched) p.reviveProgress = 0;
      p.reviveTouched = false;
    }
    if (state.reloadPressed) state.reloadPressed = false;
  }

  function damagePlayerHost(p, amount, source = null) {
    const sim = state.sim;
    if (!p || !p.alive || p.downed || sim.phase !== 'active') return;
    if (p.invuln > 0) return;
    p.hp -= amount;
    p.lastHit = sim.time;
    if (p.hp > 0) return;
    p.hp = 0;
    p.downed = sim.mode === 'pve';
    p.alive = false;
    p.deaths += 1;
    sim.effects.push({ type: 'down', x: p.x, y: p.y, life: 0.6, maxLife: 0.6, color: '#ff7964' });
    if (sim.mode === 'pve') {
      p.reviveProgress = 0;
      if (sim.players.every((player) => !player.alive)) finishPveFailure(sim);
    } else {
      const aliveBefore = sim.players.filter((player) => player.alive || player === p).length;
      p.rank = aliveBefore;
      sim.pvpDeathOrder.push(p.id);
      if (sim.players.filter((player) => player.alive).length <= 1) endPvpRound(sim);
    }
  }

  function updateHostBullets(dt) {
    const sim = state.sim;
    for (const bullet of sim.bullets) {
      if (bullet.dead) continue;
      bullet.life -= dt;
      const nx = bullet.x + bullet.vx * dt;
      const ny = bullet.y + bullet.vy * dt;
      if (bullet.life <= 0 || nx < 25 || ny < 25 || nx > ARENA.w - 25 || ny > ARENA.h - 25) {
        bullet.dead = true;
        continue;
      }
      let hit = false;
      for (const ob of sim.obstacles) {
        if (nx > ob.x && nx < ob.x + ob.w && ny > ob.y && ny < ob.y + ob.h) { hit = true; break; }
      }
      if (hit) { bullet.dead = true; sim.effects.push({ type: 'spark', x: nx, y: ny, life: 0.18, maxLife: 0.18, color: bullet.color }); continue; }
      for (const barrel of sim.barrels) {
        if (barrel.exploded) continue;
        if (dist(nx, ny, barrel.x, barrel.y) < barrel.r + 4) {
          barrel.hp -= bullet.damage;
          bullet.dead = true;
          if (barrel.hp <= 0) explodeBarrel(barrel);
          break;
        }
      }
      if (bullet.dead) continue;
      if (sim.mode === 'pve') {
        for (const enemy of sim.enemies) {
          if (enemy.dead) continue;
          if (dist(nx, ny, enemy.x, enemy.y) < enemy.r + 4) {
            const owner = sim.players.find((player) => player.id === bullet.owner);
            const before = enemy.hp;
            enemy.hp -= bullet.damage;
            if (owner) {
              owner.damage += Math.min(before, bullet.damage);
              sim.teamDamage += Math.min(before, bullet.damage);
            }
            enemy.hitFlash = 0.12;
            bullet.dead = true;
            sim.effects.push({ type: 'hit', x: nx, y: ny, life: 0.18, maxLife: 0.18, color: '#ffd38b' });
            if (enemy.hp <= 0) killEnemyHost(enemy);
            break;
          }
        }
        if (bullet.dead) continue;
        if (sim.boss && sim.boss.hp > 0 && dist(nx, ny, sim.boss.x, sim.boss.y) < sim.boss.r + 4) {
          const owner = sim.players.find((player) => player.id === bullet.owner);
          const applied = Math.min(sim.boss.hp, bullet.damage);
          sim.boss.hp -= bullet.damage;
          if (owner) { owner.damage += applied; sim.teamDamage += applied; }
          sim.boss.hitFlash = 0.12;
          bullet.dead = true;
          sim.effects.push({ type: 'hit', x: nx, y: ny, life: 0.18, maxLife: 0.18, color: '#ffd38b' });
          if (sim.boss.hp <= 0) killBossHost();
        }
      } else {
        for (const p of sim.players) {
          if (p.id === bullet.owner || !p.alive || p.downed) continue;
          if (dist(nx, ny, p.x, p.y) < p.r + 4) {
            const owner = sim.players.find((player) => player.id === bullet.owner);
            if (owner) { owner.damage += bullet.damage; owner.kills += p.hp <= bullet.damage ? 1 : 0; }
            damagePlayerHost(p, bullet.damage, bullet.owner);
            bullet.dead = true;
            sim.effects.push({ type: 'hit', x: nx, y: ny, life: 0.18, maxLife: 0.18, color: '#ffb07a' });
            break;
          }
        }
      }
      if (!bullet.dead) { bullet.x = nx; bullet.y = ny; }
    }
    sim.bullets = sim.bullets.filter((bullet) => !bullet.dead).slice(-260);
    for (const effect of sim.effects) effect.life -= dt;
    sim.effects = sim.effects.filter((effect) => effect.life > 0).slice(-90);
  }

  function explodeBarrel(barrel) {
    const sim = state.sim;
    if (barrel.exploded) return;
    barrel.exploded = true;
    sim.effects.push({ type: 'explosion', x: barrel.x, y: barrel.y, life: 0.45, maxLife: 0.45, color: '#ff9a5f' });
    for (const p of sim.players) {
      if (!p.alive) continue;
      if (dist(p.x, p.y, barrel.x, barrel.y) < 145) damagePlayerHost(p, 52, 'barrel');
    }
    sim.barrels = sim.barrels.filter((entry) => !entry.exploded);
  }

  function spawnPveEnemy(type, scale, wave) {
    const sim = state.sim;
    const angle = rand(0, TAU);
    const radius = rand(0.2, 0.46) * Math.max(ARENA.w, ARENA.h);
    const x = clamp(ARENA.w / 2 + Math.cos(angle) * radius, 60, ARENA.w - 60);
    const y = clamp(ARENA.h / 2 + Math.sin(angle) * radius, 60, ARENA.h - 60);
    const base = {
      zombie: { hp: 45, speed: 72, damage: 10, r: 17, color: '#91b56b' },
      spider: { hp: 32, speed: 118, damage: 8, r: 13, color: '#c36b7a' },
      mutant: { hp: 78, speed: 64, damage: 16, r: 23, color: '#9a8b4a' },
      soldier: { hp: 62, speed: 88, damage: 11, r: 16, color: '#d0a45b', ranged: true },
      gunner: { hp: 82, speed: 65, damage: 14, r: 19, color: '#d17a58', ranged: true },
    }[type] || { hp: 48, speed: 80, damage: 10, r: 16, color: '#9b9b7b' };
    sim.enemies.push({
      id: `e_${Math.random().toString(36).slice(2)}`,
      type,
      x, y, r: base.r,
      hp: Math.round(base.hp * wave * scale),
      maxHp: Math.round(base.hp * wave * scale),
      speed: base.speed * (1 + Math.min(0.5, wave * 0.03)) * (scale >= 2 ? 1.1 : scale >= 1.5 ? 1.05 : 1),
      damage: Math.round(base.damage * scale * (1 + wave * 0.04)),
      attackCd: rand(0.4, 1.2),
      ranged: !!base.ranged,
      color: base.color,
      hitFlash: 0,
      dead: false,
    });
  }

  function spawnPveWave(sim) {
    sim.wave += 1;
    const scale = teamScale();
    const count = Math.round((4 + sim.wave * 2) * scale);
    const pool = sim.wave >= 4 ? ['zombie', 'spider', 'mutant', 'soldier', 'gunner'] : ['zombie', 'spider', 'mutant'];
    for (let index = 0; index < count; index += 1) {
      spawnPveEnemy(pool[randInt(0, pool.length - 1)], scale, sim.wave);
    }
    if (sim.wave % 5 === 0) {
      spawnBossHost(sim, 'sergeant', Math.floor(sim.wave / 5) - 1);
    }
    sim.waveClear = false;
    sim.message = `第 ${sim.wave} 波`;
    sim.messageUntil = sim.time + 2;
  }

  function updatePveEnemies(dt) {
    const sim = state.sim;
    if (sim.mode !== 'pve' || sim.pveMode !== 'normal') return;
    const activePlayers = sim.players.filter((player) => player.alive && !player.downed);
    for (const enemy of sim.enemies) {
      if (enemy.dead) continue;
      enemy.attackCd -= dt;
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      const target = activePlayers.sort((a, b) => dist(enemy.x, enemy.y, a.x, a.y) - dist(enemy.x, enemy.y, b.x, b.y))[0];
      if (!target) continue;
      const d = dist(enemy.x, enemy.y, target.x, target.y);
      if (d > (enemy.ranged ? 330 : enemy.r + target.r + 4)) {
        const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
        enemy.x += Math.cos(angle) * enemy.speed * dt;
        enemy.y += Math.sin(angle) * enemy.speed * dt;
      } else if (enemy.attackCd <= 0) {
        enemy.attackCd = enemy.ranged ? 1.7 : 0.9;
        if (enemy.ranged) {
          const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
          sim.bullets.push({ x: enemy.x, y: enemy.y, vx: Math.cos(angle) * 420, vy: Math.sin(angle) * 420, damage: enemy.damage, owner: 'enemy', color: '#ff6f5e', life: 1.4, hostile: true });
        } else {
          damagePlayerHost(target, enemy.damage, enemy.id);
        }
      }
    }
    sim.enemies = sim.enemies.filter((enemy) => !enemy.dead);
    if (sim.phase !== 'active') return;
    if (sim.waveClear) {
      sim.waveTimer -= dt;
      if (sim.waveTimer <= 0) { spawnPveWave(sim); sim.phase = 'active'; }
    } else if (sim.enemies.length === 0 && !sim.boss) {
      sim.waveClear = true;
      sim.waveTimer = 3.2;
      sim.message = `第 ${sim.wave} 波清除 · 休整`;
      sim.messageUntil = sim.time + 3;
    }
  }

  function spawnBossHost(sim, kind, cycle = 0) {
    const scale = teamScale();
    const baseHp = kind === 'director' ? 1450 : kind === 'sergeant' ? 1850 : 2300;
    const baseDamage = kind === 'director' ? 18 : kind === 'sergeant' ? 22 : 25;
    sim.boss = {
      kind,
      name: kind === 'director' ? '实验室主任' : kind === 'sergeant' ? '士官长' : '清道夫 X-7',
      x: ARENA.w / 2,
      y: 300,
      r: 62,
      hp: Math.round(baseHp * (1 + cycle * 0.55) * scale),
      maxHp: Math.round(baseHp * (1 + cycle * 0.55) * scale),
      damage: Math.round(baseDamage * (1 + cycle * 0.35) * scale),
      speed: 62,
      attackCd: 1.2,
      specialCd: 5.5,
      cycle,
      hitFlash: 0,
      attackAngle: Math.PI / 2,
    };
    sim.phase = 'active';
    sim.message = `${sim.boss.name} 出现`;
    sim.messageUntil = sim.time + 2.2;
  }

  function updateBossHost(dt) {
    const sim = state.sim;
    const boss = sim.boss;
    if (!boss || boss.hp <= 0) return;
    const activePlayers = sim.players.filter((player) => player.alive && !player.downed);
    const target = activePlayers.sort((a, b) => dist(boss.x, boss.y, a.x, a.y) - dist(boss.x, boss.y, b.x, b.y))[0];
    if (!target) return;
    boss.attackCd -= dt;
    boss.specialCd -= dt;
    boss.hitFlash = Math.max(0, boss.hitFlash - dt);
    const d = dist(boss.x, boss.y, target.x, target.y);
    boss.attackAngle = Math.atan2(target.y - boss.y, target.x - boss.x);
    if (d > 230) {
      boss.x += Math.cos(boss.attackAngle) * boss.speed * dt;
      boss.y += Math.sin(boss.attackAngle) * boss.speed * dt;
    }
    if (boss.attackCd <= 0) {
      const speedUp = Math.max(0.68, 1 - (boss.cycle || 0) * 0.08);
      boss.attackCd = (boss.kind === 'robot' ? 0.8 : boss.kind === 'director' ? 2.1 : 1.7) * speedUp;
      const angle = boss.attackAngle;
      if (boss.kind === 'director') {
        const count = 3 + Math.min(3, boss.cycle || 0);
        for (let i = 0; i < count; i += 1) {
          const offset = (i - (count - 1) / 2) * 0.16;
          spawnBossBullet(sim, boss, angle + offset, 330 + (boss.cycle || 0) * 20, boss.damage);
        }
      } else if (boss.kind === 'sergeant') {
        const count = 6 + Math.min(6, (boss.cycle || 0) * 2);
        for (let i = 0; i < count; i += 1) spawnBossBullet(sim, boss, angle + (i - (count - 1) / 2) * 0.11, 400, boss.damage * 0.6);
      } else {
        const count = 1 + Math.min(3, boss.cycle || 0);
        for (let i = 0; i < count; i += 1) spawnBossBullet(sim, boss, angle + (i - (count - 1) / 2) * 0.06, 520, boss.damage * 0.7);
      }
    }
    if (boss.specialCd <= 0) {
      boss.specialCd = boss.kind === 'director' ? 6.5 : boss.kind === 'sergeant' ? 7.5 : 6.2;
      if (boss.kind === 'director') {
        sim.zones.push({ x: target.x, y: target.y, r: 90, life: 4.5, maxLife: 4.5, tick: 0.5, damage: boss.damage });
      } else if (boss.kind === 'sergeant') {
        spawnBossBullet(sim, boss, boss.attackAngle, 260, boss.damage * 1.6, 32);
      } else {
        boss.charge = 0.65;
        boss.chargeDirX = Math.cos(boss.attackAngle);
        boss.chargeDirY = Math.sin(boss.attackAngle);
      }
    }
    if (boss.charge > 0) {
      boss.charge -= dt;
      boss.x += boss.chargeDirX * 620 * dt;
      boss.y += boss.chargeDirY * 620 * dt;
      for (const p of activePlayers) {
        if (dist(boss.x, boss.y, p.x, p.y) < boss.r + p.r) damagePlayerHost(p, boss.damage * 1.4, 'charge');
      }
    }
    boss.x = clamp(boss.x, 60, ARENA.w - 60);
    boss.y = clamp(boss.y, 60, ARENA.h - 60);
    for (const zone of sim.zones) {
      zone.life -= dt;
      zone.tick -= dt;
      if (zone.tick <= 0) {
        zone.tick += 0.55;
        for (const p of activePlayers) if (dist(p.x, p.y, zone.x, zone.y) < zone.r) damagePlayerHost(p, zone.damage, 'poison');
      }
    }
    sim.zones = sim.zones.filter((zone) => zone.life > 0);
  }

  function spawnBossBullet(sim, boss, angle, speed, damage, size = 6) {
    sim.bullets.push({
      x: boss.x + Math.cos(angle) * (boss.r + 8), y: boss.y + Math.sin(angle) * (boss.r + 8),
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      damage, owner: 'boss', color: boss.kind === 'director' ? '#a8e26e' : '#ff8360', life: 2.1, hostile: true, size,
    });
  }

  function killBossHost() {
    const sim = state.sim;
    if (!sim.boss) return;
    sim.effects.push({ type: 'explosion', x: sim.boss.x, y: sim.boss.y, life: 0.7, maxLife: 0.7, color: '#ffb36e' });
    sim.boss = null;
    sim.zones = [];
    sim.bullets = sim.bullets.filter((bullet) => !bullet.hostile);
    const active = sim.players.filter((player) => player.alive);
    for (const p of active) p.hp = Math.min(p.maxHp, p.hp + 30);
    if (sim.pveMode === 'boss') {
      sim.pveBossIndex += 1;
      sim.message = 'Boss 已击破 · 下一名即将抵达';
      sim.messageUntil = sim.time + 2.2;
      sim.bossRespawnTimer = 2.4;
    } else {
      sim.waveClear = false;
    }
  }

  function updatePveHost(dt) {
    const sim = state.sim;
    if (sim.phase !== 'active') return;
    if (sim.pveMode === 'boss') {
      if (!sim.boss) {
        sim.bossRespawnTimer = (sim.bossRespawnTimer || 0) - dt;
        if (sim.bossRespawnTimer <= 0) {
          const index = sim.pveBossIndex;
          const kind = ['director', 'sergeant', 'robot'][index % 3];
          spawnBossHost(sim, kind, Math.floor(index / 3));
        }
      }
      updateBossHost(dt);
      return;
    }
    updatePveEnemies(dt);
    updateBossHost(dt);
  }

  function setupPvpRound(sim, round) {
    sim.round = round;
    sim.phase = 'countdown';
    sim.countdown = 3.2;
    sim.roundTime = 0;
    sim.roundSummary = null;
    sim.pvpDeathOrder = [];
    sim.bullets = [];
    sim.effects = [];
    sim.zones = [];
    sim.barrels = createMapLayout('pvp').barrels.map((barrel) => ({ ...barrel, exploded: false }));
    sim.medkits = [];
    sim.medkitTimer = 3;
    sim.teamDamage = 0;
    const positions = pvpSpawns(sim.players.length);
    sim.players.forEach((p, index) => {
      p.alive = true;
      p.downed = false;
      p.hp = p.maxHp;
      p.ammo = p.maxAmmo;
      p.reloading = false;
      p.reloadTimer = 0;
      p.fireCd = 0;
      p.rank = 0;
      p.deathTime = 0;
      p.x = positions[index].x;
      p.y = positions[index].y;
      p.angle = Math.atan2(ARENA.h / 2 - p.y, ARENA.w / 2 - p.x);
    });
    sim.message = `回合 ${round} / ${sim.rounds}`;
    sim.messageUntil = sim.time + 2;
  }

  function pvpSpawns(count) {
    const points = [];
    const cx = ARENA.w / 2;
    const cy = ARENA.h / 2;
    const radius = 430;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / Math.max(1, count)) * TAU - Math.PI / 2;
      points.push({ x: clamp(cx + Math.cos(angle) * radius, 70, ARENA.w - 70), y: clamp(cy + Math.sin(angle) * radius, 70, ARENA.h - 70) });
    }
    return points;
  }

  function updatePvpHost(dt) {
    const sim = state.sim;
    if (sim.phase === 'countdown') {
      sim.countdown -= dt;
      if (sim.countdown <= 0) { sim.phase = 'active'; sim.message = '交战解除'; sim.messageUntil = sim.time + 1.2; }
      return;
    }
    if (sim.phase === 'roundSummary') {
      sim.countdown -= dt;
      if (sim.countdown <= 0) {
        if (sim.round >= sim.rounds) finishPvpMatch(sim);
        else setupPvpRound(sim, sim.round + 1);
      }
      return;
    }
    if (sim.phase !== 'active') return;
    sim.roundTime += dt;
    sim.medkitTimer -= dt;
    if (sim.medkitTimer <= 0 && sim.medkits.length < 4) {
      sim.medkitTimer = rand(6, 10);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const x = rand(90, ARENA.w - 90);
        const y = rand(90, ARENA.h - 90);
        if (!isBlocked(x, y, 20, sim.obstacles)) { sim.medkits.push({ x, y, r: 12 }); break; }
      }
    }
    for (const p of sim.players) {
      if (!p.alive) continue;
      for (const kit of [...sim.medkits]) {
        if (dist(p.x, p.y, kit.x, kit.y) < p.r + kit.r) {
          p.hp = Math.min(p.maxHp, p.hp + 50);
          sim.medkits = sim.medkits.filter((entry) => entry !== kit);
          sim.effects.push({ type: 'heal', x: kit.x, y: kit.y, life: 0.4, maxLife: 0.4, color: '#93ffcb' });
        }
      }
    }
    if (sim.players.filter((p) => p.alive).length <= 1) endPvpRound(sim);
    else if (sim.roundTime > 120) endPvpRound(sim, true);
  }

  function endPvpRound(sim, timeout = false) {
    if (sim.phase !== 'active') return;
    sim.phase = 'roundSummary';
    sim.countdown = 4.6;
    const alive = sim.players.filter((p) => p.alive).sort((a, b) => b.hp - a.hp);
    if (timeout) {
      alive.forEach((p, index) => { p.rank = index + 1; });
    } else {
      alive.forEach((p, index) => { p.rank = index + 1; });
    }
    for (const p of sim.players) if (!p.rank) p.rank = sim.players.length;
    const rows = [...sim.players].sort((a, b) => a.rank - b.rank).map((p) => {
      const credits = PVP_REWARD_CREDITS[p.rank - 1] ?? 40;
      const tech = PVP_REWARD_TECH[p.rank - 1] ?? 0;
      p.credits += credits;
      p.tech += tech;
      p.score += Math.max(0, sim.players.length - p.rank + 1) * 100;
      return { id: p.id, name: p.name, rank: p.rank, credits, tech, score: p.score, damage: Math.round(p.damage) };
    });
    sim.roundSummary = { round: sim.round, rows };
    sim.message = `回合 ${sim.round} 结束 · 按名次发放奖励`;
    sim.messageUntil = sim.time + 4.5;
  }

  function finishPvpMatch(sim) {
    sim.phase = 'result';
    const standings = [...sim.players].sort((a, b) => b.score - a.score).map((p, index) => ({ ...p, finalRank: index + 1 }));
    sim.result = {
      type: 'pvp',
      title: '对战结束',
      subtitle: `已完成 ${sim.rounds} 回合 · 按总积分排名`,
      rows: standings.map((p) => ({
        rank: p.finalRank, name: p.name, kills: p.kills, deaths: p.deaths, damage: Math.round(p.damage), score: p.score, credits: p.credits, tech: p.tech,
      })),
    };
    sim.message = '';
  }

  function finishPveFailure(sim) {
    if (sim.result) return;
    sim.phase = 'result';
    sim.result = {
      type: 'pve-failure',
      title: '作战失败',
      subtitle: `团队总伤害 ${formatInt(sim.teamDamage)} · 所有干员生命信号中断`,
      rows: sim.players.map((p) => ({
        name: p.name, damage: Math.round(p.damage), kills: p.kills, deaths: p.deaths, revives: p.revives,
      })),
    };
    sim.message = '';
  }

  function showMessageHost(text, ttl = 1800) {
    if (!state.sim) return;
    state.sim.message = text;
    state.sim.messageUntil = state.sim.time + ttl / 1000;
  }

  function updateHost(dt) {
    const sim = state.sim;
    if (!sim) return;
    sim.time += dt;
    if (sim.phase === 'result') return;
    if (sim.phase === 'countdown') {
      sim.countdown -= dt;
      if (sim.countdown <= 0) {
        if (sim.mode === 'pvp') { sim.phase = 'active'; sim.message = '交战解除'; sim.messageUntil = sim.time + 1.2; }
        else { sim.phase = 'active'; sim.message = '开始作战'; sim.messageUntil = sim.time + 1.4; }
      }
      return;
    }
    if (sim.phase === 'roundSummary') { updatePvpHost(dt); return; }
    updateHostPlayers(dt);
    updateHostBullets(dt);
    if (sim.mode === 'pve') updatePveHost(dt);
    else updatePvpHost(dt);
    for (const effect of sim.effects) effect.life -= dt;
    sim.effects = sim.effects.filter((effect) => effect.life > 0).slice(-100);
    if (sim.messageUntil && sim.time > sim.messageUntil) sim.message = '';
  }

  function publicPlayer(p) {
    return {
      id: p.id, name: p.name, character: p.character, color: p.color,
      x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, angle: p.angle,
      hp: Math.ceil(p.hp), maxHp: p.maxHp, alive: p.alive, downed: p.downed,
      reviveProgress: p.reviveProgress || 0, credits: p.credits, tech: p.tech,
      upgrades: p.upgrades, damage: Math.round(p.damage), kills: p.kills, deaths: p.deaths,
      revives: p.revives, rank: p.rank, score: p.score, ammo: p.ammo, maxAmmo: p.maxAmmo,
      reloading: p.reloading, isHost: p.isHost,
    };
  }

  function buildSnapshot() {
    const sim = state.sim;
    return {
      t: Math.round(sim.time * 1000) / 1000,
      mode: sim.mode, pveMode: sim.pveMode, phase: sim.phase,
      wave: sim.wave, round: sim.round, rounds: sim.rounds, countdown: sim.countdown,
      roundTime: sim.roundTime,
      players: sim.players.map(publicPlayer),
      enemies: sim.enemies.map((enemy) => ({
        id: enemy.id, type: enemy.type, x: Math.round(enemy.x), y: Math.round(enemy.y), r: enemy.r,
        hp: Math.max(0, Math.round(enemy.hp)), maxHp: enemy.maxHp, hitFlash: enemy.hitFlash,
      })),
      bullets: sim.bullets.slice(-180).map((b) => ({
        x: Math.round(b.x), y: Math.round(b.y), vx: b.vx, vy: b.vy, color: b.color, hostile: !!b.hostile, size: b.size || 4,
      })),
      barrels: sim.barrels.map((b) => ({ x: b.x, y: b.y, r: b.r, hp: b.hp })),
      medkits: sim.medkits.map((m) => ({ x: m.x, y: m.y, r: m.r })),
      zones: sim.zones.map((z) => ({ x: z.x, y: z.y, r: z.r, life: z.life, maxLife: z.maxLife })),
      boss: sim.boss ? {
        kind: sim.boss.kind, name: sim.boss.name, x: Math.round(sim.boss.x), y: Math.round(sim.boss.y), r: sim.boss.r,
        hp: Math.max(0, Math.round(sim.boss.hp)), maxHp: sim.boss.maxHp, hitFlash: sim.boss.hitFlash,
      } : null,
      obstacles: sim.obstacles,
      effects: sim.effects.slice(-80).map((effect) => ({ type: effect.type, x: effect.x, y: effect.y, life: effect.life, maxLife: effect.maxLife, color: effect.color })),
      teamDamage: Math.round(sim.teamDamage),
      aliveCount: sim.players.filter((p) => p.alive).length,
      roundSummary: sim.roundSummary,
      result: sim.result,
      message: sim.message || '',
      arena: ARENA,
      hostId: state.hostId,
    };
  }

  function sendSnapshotSoon() {
    if (!state.inGame || state.role !== 'host' || !state.sim) return;
    const now = performance.now();
    if (now - state.lastSnapshotSent < 55) return;
    state.lastSnapshotSent = now;
    sendAction('snapshot', buildSnapshot());
  }

  function mpLoop(now) {
    if (!state.inGame) return;
    const dt = clamp((now - (lastFrame || now)) / 1000, 0, 0.05);
    lastFrame = now;
    if (state.role === 'host' && state.sim) {
      updateHost(dt);
      sendSnapshotSoon();
    } else {
      sendClientInput();
    }
    renderMpMatch();
    updateMpHud();
    state.raf = requestAnimationFrame(mpLoop);
  }

  function returnToLobbyLocal(reason = '') {
    state.inGame = false;
    cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.sim = null;
    state.snap = null;
    state.remoteInputs = {};
    state.keys.clear();
    state.mouse.down = false;
    state.pendingUpgrade = null;
    dom.game.classList.add('is-hidden');
    dom.lobby.classList.remove('is-hidden');
    dom.result.classList.add('is-hidden');
    document.body.classList.remove('mp-in-game');
    if (reason && dom.hint) dom.hint.textContent = reason;
    renderLobby();
  }

  function endMatchFromServer(payload) {
    if (!state.inGame) return;
    returnToLobbyLocal(payload?.reason || '战斗结束');
  }

  function hostReturnToLobby() {
    if (state.role !== 'host') return;
    sendAction('end', { reason: '房主结束了本场作战' });
    returnToLobbyLocal('已结束本场作战');
  }

  function leaveMatch() {
    if (!state.inGame) return;
    if (state.role === 'host') hostReturnToLobby();
    else {
      sendAction('leave', {});
      state.connected = false;
      state.eventSource?.close();
      state.eventSource = null;
      returnToLobbyLocal('已离开战斗');
    }
  }

  function showCenter(text, ttl = 1800) {
    state.centerToast = text ? { text, until: Date.now() + ttl } : null;
  }

  function drawRoundedRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function renderMpMatch() {
    if (!dom.canvas) return;
    if (!ctx) resizeMpCanvas();
    const data = state.role === 'host' ? state.sim : state.snap;
    const w = state.viewW || dom.canvas.clientWidth || 1440;
    const h = state.viewH || dom.canvas.clientHeight || 900;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#03090c';
    ctx.fillRect(0, 0, w, h);
    if (!data) {
      ctx.fillStyle = '#6f9999';
      ctx.font = '12px "SFMono-Regular", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('正在接收战场数据…', w / 2, h / 2);
      return;
    }
    const players = data.players || [];
    const local = players.find((player) => player.id === state.id);
    const camera = cameraFor(local);
    state.camera = camera;
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    // Floor grid.
    ctx.fillStyle = '#07171b';
    ctx.fillRect(0, 0, ARENA.w, ARENA.h);
    ctx.strokeStyle = 'rgba(112, 215, 211, 0.055)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= ARENA.w; x += 80) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ARENA.h); ctx.stroke();
    }
    for (let y = 0; y <= ARENA.h; y += 80) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ARENA.w, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(114, 230, 221, 0.18)';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, ARENA.w - 4, ARENA.h - 4);
    // Obstacles.
    for (const obstacle of data.obstacles || []) {
      ctx.fillStyle = obstacle.type === 'pillar' ? '#122428' : '#0c1d20';
      ctx.strokeStyle = 'rgba(130, 230, 221, 0.2)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
      ctx.strokeRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
      ctx.strokeStyle = 'rgba(255, 210, 140, 0.16)';
      ctx.beginPath(); ctx.moveTo(obstacle.x + 5, obstacle.y + 6); ctx.lineTo(obstacle.x + obstacle.w - 5, obstacle.y + 6); ctx.stroke();
    }
    // Poison / zones.
    for (const zone of data.zones || []) {
      const alpha = clamp(zone.life / Math.max(0.01, zone.maxLife || 1), 0, 1);
      ctx.fillStyle = `rgba(132, 190, 72, ${0.08 + alpha * 0.1})`;
      ctx.strokeStyle = `rgba(164, 230, 98, ${0.15 + alpha * 0.25})`;
      ctx.beginPath(); ctx.arc(zone.x, zone.y, zone.r, 0, TAU); ctx.fill(); ctx.stroke();
    }
    // Barrels.
    for (const barrel of data.barrels || []) {
      ctx.fillStyle = barrel.hp > 0 ? '#7b3c29' : '#2a1b18';
      ctx.strokeStyle = '#ff9a5f';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(barrel.x, barrel.y, barrel.r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255, 196, 117, 0.45)';
      ctx.beginPath(); ctx.arc(barrel.x, barrel.y, barrel.r * 0.35, 0, TAU); ctx.fill();
    }
    // Medkits.
    for (const kit of data.medkits || []) {
      ctx.fillStyle = 'rgba(92, 255, 190, 0.16)';
      ctx.strokeStyle = '#7dffd0';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(kit.x, kit.y, 18, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#a5ffe0';
      ctx.fillRect(kit.x - 7, kit.y - 2, 14, 4);
      ctx.fillRect(kit.x - 2, kit.y - 7, 4, 14);
    }
    // Bullets.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const bullet of data.bullets || []) {
      ctx.strokeStyle = bullet.color || '#ffd28a';
      ctx.lineWidth = bullet.hostile ? 2.2 : 1.6;
      ctx.beginPath();
      ctx.moveTo(bullet.x, bullet.y);
      ctx.lineTo(bullet.x - bullet.vx * 0.018, bullet.y - bullet.vy * 0.018);
      ctx.stroke();
      ctx.fillStyle = bullet.color || '#ffd28a';
      ctx.beginPath(); ctx.arc(bullet.x, bullet.y, bullet.size || 2.2, 0, TAU); ctx.fill();
    }
    ctx.restore();
    // Enemies.
    for (const enemy of data.enemies || []) {
      const bob = Math.sin((data.t || 0) * 4 + enemy.x * 0.02) * 2;
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath(); ctx.ellipse(enemy.x + 3, enemy.y + enemy.r * 0.7, enemy.r * 0.9, enemy.r * 0.38, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = enemy.hitFlash > 0 ? '#ffe0a0' : (enemy.type === 'spider' ? '#80404b' : enemy.type === 'soldier' || enemy.type === 'gunner' ? '#6c4b29' : '#52633a');
      ctx.strokeStyle = enemy.type === 'mutant' ? '#d0b65b' : 'rgba(206, 255, 180, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (enemy.type === 'spider') {
        ctx.ellipse(enemy.x, enemy.y + bob, enemy.r, enemy.r * 0.7, 0, 0, TAU);
      } else {
        ctx.arc(enemy.x, enemy.y + bob, enemy.r, 0, TAU);
      }
      ctx.fill(); ctx.stroke();
      const ratio = clamp(enemy.hp / Math.max(1, enemy.maxHp), 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(enemy.x - enemy.r, enemy.y - enemy.r - 12, enemy.r * 2, 3);
      ctx.fillStyle = '#e9ad72'; ctx.fillRect(enemy.x - enemy.r, enemy.y - enemy.r - 12, enemy.r * 2 * ratio, 3);
    }
    // Boss.
    if (data.boss) {
      const boss = data.boss;
      const pulse = 1 + Math.sin((data.t || 0) * 4) * 0.02;
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath(); ctx.ellipse(boss.x + 5, boss.y + 28, boss.r, boss.r * 0.45, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = boss.hitFlash > 0 ? '#ffe3ad' : boss.kind === 'director' ? '#3b5144' : boss.kind === 'robot' ? '#3a4148' : '#4d3b2b';
      ctx.strokeStyle = boss.kind === 'director' ? '#a7ef9a' : boss.kind === 'robot' ? '#ff8069' : '#ffc078';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(boss.x, boss.y, boss.r * pulse, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.beginPath(); ctx.arc(boss.x, boss.y, boss.r * 0.55, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,225,171,.8)';
      ctx.font = '700 9px "SFMono-Regular", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(boss.name || 'BOSS', boss.x, boss.y - boss.r - 13);
    }
    // Players.
    for (const p of players) {
      if (!p.alive && !p.downed) {
        ctx.fillStyle = 'rgba(120, 145, 140, 0.32)';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.65, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255, 114, 95, .35)';
        ctx.beginPath(); ctx.moveTo(p.x - 6, p.y - 6); ctx.lineTo(p.x + 6, p.y + 6); ctx.moveTo(p.x + 6, p.y - 6); ctx.lineTo(p.x - 6, p.y + 6); ctx.stroke();
        continue;
      }
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath(); ctx.ellipse(p.x + 3, p.y + 12, p.r, p.r * 0.42, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = p.downed ? '#ff7b68' : p.id === state.id ? '#f2fff8' : 'rgba(210,255,246,.25)';
      ctx.lineWidth = p.id === state.id ? 2.4 : 1.2;
      ctx.fillStyle = p.downed ? 'rgba(120,55,50,.8)' : p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = '#203034';
      ctx.fillRect(p.r - 2, -4, 16, 8);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.r + 11, -2, 5, 4);
      ctx.restore();
      const ratio = clamp(p.hp / Math.max(1, p.maxHp), 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,.58)'; ctx.fillRect(p.x - 23, p.y - p.r - 14, 46, 4);
      ctx.fillStyle = p.downed ? '#ff725f' : ratio > 0.35 ? '#79f4d8' : '#ffc05e';
      ctx.fillRect(p.x - 23, p.y - p.r - 14, 46 * ratio, 4);
      ctx.fillStyle = 'rgba(225,255,250,.9)';
      ctx.font = '600 8px "SFMono-Regular", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(p.name || '干员', p.x, p.y - p.r - 19);
      if (p.downed) {
        ctx.fillStyle = 'rgba(255, 104, 82, .9)';
        ctx.font = '700 8px "SFMono-Regular", monospace';
        ctx.fillText('DOW NED', p.x, p.y + p.r + 15);
        if (p.reviveProgress > 0) {
          ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(p.x - 24, p.y + p.r + 20, 48, 4);
          ctx.fillStyle = '#8fffd1'; ctx.fillRect(p.x - 24, p.y + p.r + 20, 48 * clamp(p.reviveProgress / 3, 0, 1), 4);
        }
      }
    }
    // Effects.
    for (const effect of data.effects || []) {
      const alpha = clamp(effect.life / Math.max(0.01, effect.maxLife || 0.2), 0, 1);
      ctx.globalAlpha = alpha;
      if (effect.type === 'explosion') {
        ctx.fillStyle = 'rgba(255, 129, 78, .18)';
        ctx.beginPath(); ctx.arc(effect.x, effect.y, 120 * (1 - alpha) + 20, 0, TAU); ctx.fill();
        ctx.strokeStyle = effect.color || '#ffae76';
        ctx.lineWidth = 3; ctx.stroke();
      } else {
        ctx.fillStyle = effect.color || '#8fffe0';
        ctx.beginPath(); ctx.arc(effect.x, effect.y, (effect.type === 'muzzle' ? 5 : 10) * alpha + 2, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // Screen border vignette.
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, w, 8); ctx.fillRect(0, h - 8, w, 8); ctx.fillRect(0, 0, 8, h); ctx.fillRect(w - 8, 0, 8, h);
  }

  function updateMpHud() {
    if (!state.inGame) return;
    const data = state.role === 'host' ? state.sim : state.snap;
    if (!data) return;
    const players = data.players || [];
    const local = players.find((player) => player.id === state.id);
    if (dom.localName) setText(dom.localName, local?.name || state.localName);
    if (dom.localCharacter) setText(dom.localCharacter, charDef(local?.character || localCharacter()).name || '干员');
    if (local) {
      setText(dom.localHp, `${Math.ceil(local.hp)} / ${Math.ceil(local.maxHp)}`);
      setText(dom.localAmmo, local.reloading ? '换弹中…' : `${local.ammo ?? 0} / ${local.maxAmmo ?? WEAPON.ammo}`);
      setText(dom.localCredits, formatInt(local.credits));
      setText(dom.localTech, local.tech);
      dom.localHpFill.style.width = `${clamp(local.hp / Math.max(1, local.maxHp), 0, 1) * 100}%`;
      setText(dom.upDamage, local.upgrades?.damage || 0);
      setText(dom.upArmor, local.upgrades?.armor || 0);
      setText(dom.upRate, local.upgrades?.rate || 0);
    }
    const alive = players.filter((player) => player.alive).length;
    setText(dom.alive, `${alive} ALIVE`);
    if (dom.roster) {
      dom.roster.innerHTML = players.map((player) => {
        const stateClass = !player.alive && !player.downed ? 'is-dead' : player.downed ? 'is-down' : '';
        return `<div class="mp-game-roster-row ${stateClass}"><i style="background:${player.color}"></i><span>${escapeHtml(player.name)}</span><b>${player.downed ? 'DOW' : Math.ceil(player.hp)}</b></div>`;
      }).join('');
    }
    setText(dom.teamDamageBig, formatInt(data.teamDamage || 0));
    setText(dom.teamDamage, `总伤害 ${formatInt(data.teamDamage || 0)}`);
    // Mission labels.
    const mode = data.mode || state.config.mode;
    if (mode === 'pvp') {
      setText(dom.missionKicker, 'LAN // PVP DEATHMATCH');
      setText(dom.missionTitle, `回合 ${data.round || 1} / ${data.rounds || state.config.rounds}`);
      const phaseText = data.phase === 'countdown' ? '战斗准备' : data.phase === 'roundSummary' ? '回合结算' : data.phase === 'result' ? '对战结束' : `${alive} 名玩家存活`;
      setText(dom.missionState, phaseText);
    } else if (data.pveMode === 'boss') {
      setText(dom.missionKicker, 'LAN // PVE BOSS GAUNTLET');
      setText(dom.missionTitle, data.boss ? data.boss.name : 'Boss 循环');
      setText(dom.missionState, data.phase === 'countdown' ? '战斗准备' : data.boss ? '击破所有目标' : '下一名 Boss 即将抵达');
    } else {
      setText(dom.missionKicker, 'LAN // PVE CONTAINMENT');
      setText(dom.missionTitle, `第 ${pad2(data.wave || 1)} 波`);
      setText(dom.missionState, data.phase === 'countdown' ? '战斗准备' : data.phase === 'result' ? '作战结束' : data.waveClear ? '区域肃清 · 休整' : '清剿中');
    }
    if (data.boss) {
      dom.bossBar.classList.remove('is-hidden');
      setText(dom.bossName, data.boss.name || 'BOSS');
      setText(dom.bossHp, `${formatInt(data.boss.hp)} / ${formatInt(data.boss.maxHp)}`);
      dom.bossFill.style.width = `${clamp(data.boss.hp / Math.max(1, data.boss.maxHp), 0, 1) * 100}%`;
    } else {
      dom.bossBar.classList.add('is-hidden');
    }
    setText(dom.net, state.role === 'host' ? 'LAN · HOST' : 'LAN · CLIENT');
    // Center messages / countdown / revive prompts.
    let center = '';
    const now = Date.now();
    if (state.centerToast && now < state.centerToast.until) center = state.centerToast.text;
    if (!center && data.phase === 'countdown' && data.countdown > 0) center = state.config.mode === 'pvp' ? `回合 ${data.round} · ${Math.ceil(data.countdown)}` : '准备作战 · 3';
    if (!center && data.phase === 'roundSummary' && data.roundSummary) {
      const rows = data.roundSummary.rows.map((row) => `<tr><td>#${row.rank}</td><td>${escapeHtml(row.name)}</td><td>+${row.credits} CR</td><td>+${row.tech} TP</td></tr>`).join('');
      center = `<div class="mp-round-summary"><b>回合 ${data.roundSummary.round} 结算</b><table>${rows}</table><small>下一回合即将开始</small></div>`;
    }
    if (!center && data.message) center = data.message;
    if (!center && local?.downed) center = '你已阵亡 · 等待队友救援';
    if (!center && local?.alive && data.mode === 'pve') {
      const downed = players.find((player) => player.id !== local.id && player.downed && dist(local.x, local.y, player.x, player.y) < 76);
      if (downed) center = `按住 E 救援 ${downed.name}${local.character === 'lifeline' ? ' · 浮游无人机可在移动中救援' : ' · 救援期间无法移动'}`;
    }
    if (dom.message) {
      if (center) {
        dom.message.classList.remove('is-hidden');
        if (dom.message.innerHTML !== center) dom.message.innerHTML = center;
      } else {
        dom.message.classList.add('is-hidden');
        dom.message.innerHTML = '';
      }
    }
    renderMpResult(data);
  }

  function renderMpResult(data) {
    const result = data?.result;
    if (!result) {
      dom.result.classList.add('is-hidden');
      return;
    }
    const rows = (result.rows || []).map((row) => {
      if (result.type === 'pvp') {
        return `<tr><td>#${row.rank}</td><td>${escapeHtml(row.name)}</td><td>${row.kills}</td><td>${row.deaths}</td><td>${formatInt(row.damage)}</td><td>${row.score}</td><td>${formatInt(row.credits)}</td><td>${row.tech}</td></tr>`;
      }
      return `<tr><td>${escapeHtml(row.name)}</td><td>${formatInt(row.damage)}</td><td>${row.kills}</td><td>${row.deaths}</td><td>${row.revives}</td></tr>`;
    }).join('');
    const head = result.type === 'pvp'
      ? '<tr><th>排名</th><th>干员</th><th>击杀</th><th>阵亡</th><th>伤害</th><th>积分</th><th>CR</th><th>TP</th></tr>'
      : '<tr><th>干员</th><th>伤害</th><th>击杀</th><th>阵亡</th><th>救援</th></tr>';
    const action = state.role === 'host'
      ? '<button class="btn btn-primary" type="button" data-mp-return="1">结束并返回大厅</button>'
      : '<p class="mp-result-wait">等待房主结束本场作战…</p>';
    const html = `<h3>${escapeHtml(result.title)}</h3><p>${escapeHtml(result.subtitle || '')}</p><table class="mp-result-table">${head}${rows}</table>${action}`;
    if (dom.result.innerHTML !== html) dom.result.innerHTML = html;
    dom.result.classList.remove('is-hidden');
  }

  function setupMpInputs() {
    window.addEventListener('keydown', (event) => {
      if (!state.inGame) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '')) return;
      if (event.code === 'Escape') { event.preventDefault(); leaveMatch(); return; }
      state.keys.add(event.code);
      if (event.code === 'KeyR' && !event.repeat) state.reloadPressed = true;
      if (state.config.mode === 'pvp' && !event.repeat && ['Digit1', 'Digit2', 'Digit3'].includes(event.code)) {
        state.pendingUpgrade = event.code === 'Digit1' ? 'damage' : event.code === 'Digit2' ? 'armor' : 'rate';
      }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(event.code)) event.preventDefault();
    });
    window.addEventListener('keyup', (event) => state.keys.delete(event.code));
    dom.canvas?.addEventListener('mousemove', (event) => {
      const rect = dom.canvas.getBoundingClientRect();
      state.mouse.x = event.clientX - rect.left;
      state.mouse.y = event.clientY - rect.top;
    });
    dom.canvas?.addEventListener('mousedown', (event) => { if (event.button === 0) state.mouse.down = true; });
    window.addEventListener('mouseup', (event) => { if (event.button === 0) state.mouse.down = false; });
    dom.canvas?.addEventListener('contextmenu', (event) => event.preventDefault());
    dom.result?.addEventListener('click', (event) => {
      if (event.target.closest('[data-mp-return]')) hostReturnToLobby();
    });
    window.addEventListener('resize', () => { if (state.inGame) resizeMpCanvas(); });
  }

  setupMpInputs();
  window.LabZeroMP = { state, openLobby, beginMatch, buildSnapshot, returnToLobbyLocal, hostReturnToLobby, damagePlayerHost, killBossHost, endPvpRound, finishPvpMatch, finishPveFailure };
})();
