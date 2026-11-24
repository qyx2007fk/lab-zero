'use strict';
/* LAB ZERO // server-authoritative match simulation.
 * All movement, weapons, enemy AI, damage and round state live here.
 * Clients only send input and render snapshots.
 */
const fs = require('fs');
const path = require('path');

const MAP = JSON.parse(fs.readFileSync(path.join(__dirname, 'network-map.json'), 'utf8'));
const BALANCE = JSON.parse(fs.readFileSync(path.join(__dirname, 'network-balance.json'), 'utf8'));
const CHARACTERS = BALANCE.characters;
const WEAPONS = BALANCE.weapons;
const WEAPON_ORDER = ['pistol', 'smg', 'ar', 'lmg', 'rocket'];
const WORLD = MAP.world;
const OBSTACLES = MAP.obstacles;
const TAU = Math.PI * 2;
const PLAYER_BASE_HP = 100;
const PLAYER_BASE_SPEED = 225;
const START = { x: 1200, y: 930 };
const PVP_SPAWNS = [
  { x: 360, y: 380 }, { x: 2040, y: 380 },
  { x: 360, y: 1120 }, { x: 2040, y: 1120 },
  { x: 1200, y: 260 }, { x: 1200, y: 1240 },
  { x: 720, y: 760 }, { x: 1680, y: 760 },
];
const COLORS = ['#67ecdd', '#ffd278', '#ff9d7b', '#b49aff', '#7fc7ff', '#a8f28a', '#ff8fc3', '#e9e3a4'];
const BOSS_DEFS = {
  director: { name: '实验室主任', hp: 1250, r: 37, speed: 82, damage: 12, biome: 'lab', color: '#7fe4a1' },
  sergeant: { name: '士官长', hp: 1700, r: 38, speed: 76, damage: 16, biome: 'military', color: '#ffb36b' },
  robot: { name: '清道夫 X-7', hp: 2400, r: 42, speed: 70, damage: 15, biome: 'robot', color: '#ff8069' },
};
const ENEMY_SPECS = {
  zombie: { r: 16, behavior: 'melee', hp: (w) => 85 + w * 9, speed: (w) => 72 + Math.min(38, w * 1.4), damage: (w) => 8 + Math.min(5, w * 0.4), range: 34, cd: [0.9, 1.35], credits: [2, 11] },
  runner: { r: 15, behavior: 'melee', hp: (w) => Math.round((85 + w * 9) * 1.3), speed: (w) => (72 + Math.min(38, w * 1.4)) * 4, damage: (w) => 8 + Math.min(5, w * 0.4), range: 34, cd: [0.46, 0.72], credits: [3, 15] },
  entangler: { r: 16, behavior: 'entangler', hp: (w) => Math.round((85 + w * 9) * 1.15), speed: (w) => 38 + Math.min(18, w * 0.8), damage: () => 0, range: 84, cd: [0, 0], credits: [5, 20], immuneRange: 280 },
  charger: { r: 25, behavior: 'charger', hp: (w) => Math.round((85 + w * 9) * 3.1), speed: (w) => 42 + Math.min(16, w * 0.6), chargeSpeed: (w) => (72 + Math.min(38, w * 1.4)) * 5, damage: (w) => (8 + Math.min(5, w * 0.4)) * 2, range: 45, cd: [0.9, 1.35], credits: [14, 36] },
  mutant: { r: 18, behavior: 'mutant', hp: (w) => 72 + w * 8, speed: (w) => 112 + Math.min(36, w * 2), damage: (w) => 18 + Math.min(12, w * 1.5), range: 42, credits: [4, 16] },
  spider: { r: 15, behavior: 'ranged', hp: (w) => 56 + w * 6, speed: (w) => 94 + Math.min(32, w * 1.5), damage: (w) => 5 + Math.min(5, w * 0.3), range: 430, preferred: 220, cd: [1.7, 2.35], bulletSpeed: 300, credits: [3, 13], poison: true },
  normal: { r: 16, behavior: 'ranged', hp: (w) => 58 + w * 8, speed: (w) => 108 + Math.min(40, w * 3), damage: (w) => 5 + Math.min(5, w * 0.35), range: 610, preferred: 260, cd: [1.42, 2.02], bulletSpeed: 420, credits: [1, 10] },
  elite: { r: 21, behavior: 'ranged', hp: (w) => 185 + w * 19, speed: (w) => 126 + Math.min(28, w * 2), damage: (w) => 6.5 + Math.min(6, w * 0.42), range: 680, preferred: 300, cd: [2.25, 2.9], bulletSpeed: 500, burst: 3, credits: [20, 50] },
  combatRobot: { r: 19, behavior: 'melee', hp: (w) => 108 + w * 11, speed: (w) => 82 + Math.min(30, w * 1.2), damage: (w) => 7 + Math.min(6, w * 0.4), range: 40, cd: [0.9, 1.4], credits: [6, 22], stun: 0.5 },
  repairRobot: { r: 18, behavior: 'repair', hp: (w) => 92 + w * 9, speed: (w) => 74 + Math.min(22, w), damage: () => 0, range: 0, credits: [8, 26] },
  gunnerRobot: { r: 24, behavior: 'ranged', hp: (w) => 190 + w * 17, speed: (w) => 68 + Math.min(22, w * 0.8), damage: (w) => 7 + Math.min(7, w * 0.4), range: 620, preferred: 320, cd: [1.45, 2.05], bulletSpeed: 430, burst: 4, credits: [22, 55] },
};
const BIOME_POOLS = {
  lab: ['zombie', 'zombie', 'runner', 'entangler', 'charger', 'mutant', 'spider'],
  military: ['normal', 'normal', 'elite', 'normal'],
  robot: ['combatRobot', 'gunnerRobot', 'gunnerRobot', 'repairRobot'],
};
const BIOMES = ['lab', 'military', 'robot'];
const UPGRADE_COST = { damage: [250, 420, 650, 900], armor: [300, 480, 720, 980], rate: [3, 5, 7, 9] };

let matchSeq = 0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const angleTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);

function circleRectHit(x, y, r, o) {
  const nx = clamp(x, o.x, o.x + o.w);
  const ny = clamp(y, o.y, o.y + o.h);
  return (x - nx) ** 2 + (y - ny) ** 2 < r * r;
}
function blocked(x, y, r) {
  if (x < 40 || y < 40 || x > WORLD.w - 40 || y > WORLD.h - 40) return true;
  for (const o of OBSTACLES) {
    if (o.shape === 'circle') {
      if (dist(x, y, o.x, o.y) < r + o.r) return true;
    } else if (circleRectHit(x, y, r, o)) return true;
  }
  return false;
}
function moveActor(a, dx, dy) {
  if (!blocked(a.x + dx, a.y, a.r)) a.x += dx;
  if (!blocked(a.x, a.y + dy, a.r)) a.y += dy;
  a.x = clamp(a.x, 38, WORLD.w - 38);
  a.y = clamp(a.y, 38, WORLD.h - 38);
}
function lineClear(ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(d / 24));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (blocked(ax + (bx - ax) * t, ay + (by - ay) * t, 3)) return false;
  }
  return true;
}
function id(prefix) { return prefix + (++matchSeq).toString(36) + Math.random().toString(36).slice(2, 5); }

function makeAmmo() {
  const ammo = {};
  for (const wid of WEAPON_ORDER) ammo[wid] = WEAPONS[wid].mag;
  return ammo;
}
function makeMods() {
  const mods = {};
  for (const wid of WEAPON_ORDER) mods[wid] = { mag: 0, barrel: 0, scope: 0, stock: 0 };
  return mods;
}
function makePlayer(entry, index, mode) {
  const char = CHARACTERS[entry.character] || CHARACTERS.alan;
  const maxHp = Math.round(PLAYER_BASE_HP * char.hpMult);
  const spawn = mode === 'pvp' ? PVP_SPAWNS[index % PVP_SPAWNS.length] : { x: START.x + (index % 2) * 70, y: START.y + Math.floor(index / 2) * 60 };
  return {
    id: entry.id, name: entry.name || '干员', character: char.id, characterId: char.id,
    color: COLORS[index % COLORS.length], x: spawn.x, y: spawn.y, r: 14 * (char.bodyScale || 1),
    angle: 0, aimAngle: 0, vx: 0, vy: 0, speedBase: PLAYER_BASE_SPEED * (char.speedMult || 1),
    hp: maxHp, maxHp, alive: true, downed: false, reviveProgress: 0, reviveBy: null,
    invuln: 0, hitFlash: 0, moving: false, walkPhase: 0,
    weapon: 'pistol', owned: Object.fromEntries(WEAPON_ORDER.map((w) => [w, true])),
    ammo: makeAmmo(), mods: makeMods(), reloading: false, reloadTimer: 0, reloadDuration: 1,
    fireCd: 0, input: {}, downedAt: 0, disconnected: false,
    credits: mode === 'pvp' ? 1145 : 0, tech: mode === 'pvp' ? 5 : 0,
    kills: 0, deaths: 0, damage: 0, revives: 0, score: 0, rank: 0,
    upgrades: { damage: 0, armor: 0, rate: 0 },
    grenades: { frag: 2, flash: 0, incen: 0 }, selectedGrenade: 'frag',
    paralyzed: 0, entangled: false, entangleTimer: 0, entangleDuration: 0,
    entanglePresses: 0, entangleRequired: 0, entangleEnemy: null,
    characterData: char, skillCooldown: 0, skillCooldownMax: char.active ? (char.active.cooldown || 0) : 0,
    healDroneTimer: 0, holoShieldTimer: 0, valkyrieMissiles: 16,
  };
}

class Match {
  constructor(roomId, config, entries) {
    this.roomId = roomId;
    this.config = { mode: config.mode === 'pvp' ? 'pvp' : 'pve', pveMode: config.pveMode === 'boss' ? 'boss' : 'normal', rounds: clamp(Number(config.rounds) || 5, 1, 10) };
    this.mode = this.config.mode;
    this.time = 0;
    this.tick = 0;
    this.players = entries.map((e, i) => makePlayer(e, i, this.mode));
    this.enemies = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.effects = [];
    this.zones = [];
    this.barrels = [];
    this.medkits = [];
    this.boss = null;
    this.bossKind = null;
    this.wave = 0;
    this.round = 1;
    this.rounds = this.config.rounds;
    this.phase = 'countdown';
    this.countdown = this.mode === 'pvp' ? 3 : 3.2;
    this.waveClear = false;
    this.waveTimer = 0;
    this.teamDamage = 0;
    this.pvpDeathOrder = [];
    this.roundSummary = null;
    this.result = null;
    this.pveBossIndex = 0;
    this.pveBossCycle = 0;
    this.biome = 'lab';
    this.medkitTimer = 3;
    this.startedAt = Date.now();
    this.playerCount = this.players.length;
    this.nextId = 1;
    this.effectId = 1;
    if (this.mode === 'pvp') this.setupPvpRound();
  }

  emit(type, x, y, color = '#8fffe0', extra = {}) {
    this.effects.push({ id: `fx${this.effectId++}`, type, x, y, color, life: 0.35, maxLife: 0.35, ...extra });
    if (this.effects.length > 100) this.effects.splice(0, this.effects.length - 100);
  }

  setupPvpRound() {
    this.phase = 'countdown';
    this.countdown = 3;
    this.bullets = [];
    this.enemyBullets = [];
    this.enemies = [];
    this.boss = null;
    this.barrels = [
      { x: 820, y: 450, r: 15, hp: 30, exploded: false }, { x: 1580, y: 450, r: 15, hp: 30, exploded: false },
      { x: 820, y: 1050, r: 15, hp: 30, exploded: false }, { x: 1580, y: 1050, r: 15, hp: 30, exploded: false },
    ];
    this.medkits = [];
    this.medkitTimer = 3;
    this.pvpDeathOrder = [];
    this.roundSummary = null;
    this.players.forEach((p, i) => {
      const s = PVP_SPAWNS[i % PVP_SPAWNS.length];
      p.x = s.x; p.y = s.y; p.alive = true; p.downed = false; p.hp = p.maxHp;
      p.reloading = false; p.ammo = makeAmmo(); p.angle = 0; p.fireCd = 0;
      p.paralyzed = 0; p.entangled = false; p.entangleEnemy = null; p.rank = 0;
    });
  }

  applyInput(playerId, input) {
    const p = this.players.find((e) => e.id === playerId);
    if (!p || p.disconnected) return;
    p.input = input || {};
    if (this.mode === 'pvp' && input?.upgrade) this.buyUpgrade(p, input.upgrade);
    if (input?.weapon && WEAPONS[input.weapon] && p.owned[input.weapon]) p.weapon = input.weapon;
    if (input?.skill) p.pendingSkill = true;
    if (input?.reload) p.pendingReload = true;
    if (input?.struggle) p.pendingStruggle = true;
  }

  buyUpgrade(p, type) {
    if (!UPGRADE_COST[type]) return;
    const level = p.upgrades[type] || 0;
    const costs = UPGRADE_COST[type];
    if (level >= costs.length) return;
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
      p.hp += 25;
    }
  }

  removePlayer(id) {
    const p = this.players.find((e) => e.id === id);
    if (!p) return;
    p.disconnected = true;
    p.alive = false;
    p.downed = true;
  }

  update(dt) {
    if (this.phase === 'result') return;
    this.time += dt;
    this.tick += 1;
    if (this.config.mode === 'pvp') this.updatePvp(dt);
    else this.updatePve(dt);
    for (const e of this.effects) e.life -= dt;
    this.effects = this.effects.filter((e) => e.life > 0);
    if (this.result) this.phase = 'result';
  }

  updatePlayers(dt) {
    for (const p of this.players) {
      if (p.disconnected) continue;
      p.invuln = Math.max(0, p.invuln - dt);
      p.hitFlash = Math.max(0, p.hitFlash - dt);
      p.fireCd = Math.max(0, p.fireCd - dt);
      p.paralyzed = Math.max(0, p.paralyzed - dt);
      p.skillCooldown = Math.max(0, p.skillCooldown - dt);
      p.healDroneTimer = Math.max(0, p.healDroneTimer - dt);
      p.holoShieldTimer = Math.max(0, p.holoShieldTimer - dt);
      if (p.holoShieldTimer > 0) p.invuln = Math.max(p.invuln, 0.1);
      if (p.downed) continue;
      if (!p.alive) continue;
      if (p.entangled) {
        p.entangleTimer = Math.max(0, p.entangleTimer - dt);
        if (p.pendingStruggle) {
          p.pendingStruggle = false;
          p.entanglePresses += 1;
        }
        if (p.entanglePresses >= p.entangleRequired) {
          this.releaseEntangle(p, true);
        } else if (p.entangleTimer <= 0) {
          this.releaseEntangle(p, false);
        }
        continue;
      }
      if (p.paralyzed > 0) continue;
      const input = p.input || {};
      if (p.pendingSkill) { p.pendingSkill = false; this.useSkill(p); }
      // revive target first; reviver is locked unless Lifeline.
      p.reviveLocked = false;
      if (input.revive) {
        const target = this.players
          .filter((x) => x.id !== p.id && x.downed && !x.disconnected && dist(p.x, p.y, x.x, x.y) < 76)
          .sort((a, b) => dist(p.x, p.y, a.x, a.y) - dist(p.x, p.y, b.x, b.y))[0];
        if (target) {
          target.reviveProgress += dt;
          target.reviveBy = p.id;
          p.reviveLocked = p.character !== 'lifeline';
          if (target.reviveProgress >= 3) {
            target.downed = false;
            target.alive = true;
            target.hp = Math.ceil(target.maxHp * 0.5);
            target.reviveProgress = 0;
            p.revives += 1;
            this.emit('revive', target.x, target.y, '#9bffd3', { life: 0.7, maxLife: 0.7 });
          }
        }
      }
      let dx = 0; let dy = 0;
      if (!p.reviveLocked) {
        dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
        const len = Math.hypot(dx, dy);
        if (len) {
          dx /= len; dy /= len;
          const weapon = WEAPONS[p.weapon] || WEAPONS.pistol;
          const speed = p.speedBase * (weapon.mobility || 1);
          moveActor(p, dx * speed * dt, dy * speed * dt);
          p.moving = true;
          p.walkPhase += dt * 9;
        } else p.moving = false;
      } else p.moving = false;
      if (Number.isFinite(input.aim)) {
        p.angle = input.aim;
        p.aimAngle = input.aim;
      }
      if (input.weapon && WEAPONS[input.weapon] && p.owned[input.weapon]) p.weapon = input.weapon;
      if (p.reloading) {
        p.reloadTimer -= dt;
        if (p.reloadTimer <= 0) { p.reloading = false; p.ammo[p.weapon] = WEAPONS[p.weapon].mag; }
      } else if ((p.pendingReload || input.reload) && p.ammo[p.weapon] < WEAPONS[p.weapon].mag) {
        p.reloading = true;
        p.reloadDuration = WEAPONS[p.weapon].reload;
        p.reloadTimer = p.reloadDuration;
      }
      p.pendingReload = false;
      p.pendingStruggle = false;
      const weapon = WEAPONS[p.weapon];
      if (input.fire && !p.reloading && p.fireCd <= 0 && p.ammo[p.weapon] > 0 && this.phase === 'active') {
        p.ammo[p.weapon] -= 1;
        const rate = 1 - (p.upgrades.rate || 0) * 0.08;
        p.fireCd = weapon.fireDelay * rate;
        const spread = (weapon.spread * Math.PI / 180) * 0.5;
        const angle = p.angle + rnd(-spread, spread);
        const dmg = weapon.damage * (1 + (p.upgrades.damage || 0) * 0.15);
        const muzzle = p.r + 8;
        this.bullets.push({
          id: id('b'), owner: p.id, friendly: true, kind: weapon.projectile || 'bullet',
          x: p.x + Math.cos(angle) * muzzle, y: p.y + Math.sin(angle) * muzzle,
          vx: Math.cos(angle) * weapon.bulletSpeed, vy: Math.sin(angle) * weapon.bulletSpeed,
          damage: dmg, radius: weapon.projectile === 'rocket' ? 4 : 2, life: weapon.range / weapon.bulletSpeed,
          color: p.color, splash: weapon.splashDamage || 0, splashRadius: weapon.splashRadius || 0,
        });
        this.emit('muzzle', p.x + Math.cos(angle) * 24, p.y + Math.sin(angle) * 24, p.color, { life: 0.08, maxLife: 0.08 });
      }
    }
  }

  useSkill(p) {
    if (p.skillCooldown > 0 || !p.alive || p.downed) return;
    const id = p.characterData.active?.id;
    if (!id) return;
    if (id === 'healDrone') {
      p.healDroneTimer = 5;
      p.skillCooldown = p.skillCooldownMax;
      for (const other of this.players) {
        if (!other.alive || other.downed) continue;
        if (dist(p.x, p.y, other.x, other.y) < 260) other.hp = Math.min(other.maxHp, other.hp + 24);
      }
      this.emit('revive', p.x, p.y, '#9bffd3', { life: 0.8, maxLife: 0.8 });
    } else if (id === 'holoShield') {
      p.holoShieldTimer = 3;
      p.invuln = 3;
      p.skillCooldown = p.skillCooldownMax;
      this.emit('revive', p.x, p.y, '#9dd8ff', { life: 0.6, maxLife: 0.6 });
    } else if (id === 'poisonBottle') {
      const tx = clamp(p.x + Math.cos(p.angle) * 190, 80, WORLD.w - 80);
      const ty = clamp(p.y + Math.sin(p.angle) * 190, 80, WORLD.h - 80);
      this.zones.push({ x: tx, y: ty, r: 105, radius: 105, life: 3, maxLife: 3, owner: p.id, tick: 0, color: '#b8ff75' });
      p.skillCooldown = 3;
    } else if (id === 'homingBarrage') {
      const targets = (this.mode === 'pve' ? this.enemies.filter((e) => !e.dead) : this.players.filter((e) => e.id !== p.id && e.alive))
        .sort((a, b) => dist(p.x, p.y, a.x, a.y) - dist(p.x, p.y, b.x, b.y)).slice(0, 8);
      for (const t of targets) {
        this.emit('explosion', t.x, t.y, '#ffb36e', { life: 0.45, maxLife: 0.45 });
        if (this.mode === 'pve') this.damageEnemy(t, 100, p.id);
        else this.damagePlayer(t, 100, p.id);
      }
      p.valkyrieMissiles = 0;
      p.skillCooldown = 2.5;
    }
  }

  updateZones(dt) {
    for (const z of this.zones) {
      z.life -= dt;
      z.tick = (z.tick || 0) - dt;
      if (z.tick > 0) continue;
      z.tick = 0.5;
      if (this.mode === 'pve') {
        for (const e of this.enemies) {
          if (!e.dead && dist(z.x, z.y, e.x, e.y) < z.r) {
            const pct = e.type === 'boss' ? 0.02 : 0.05;
            this.damageEnemy(e, Math.max(1, e.maxHp * pct), z.owner);
          }
        }
      } else {
        for (const p of this.players) {
          if (p.alive && p.id !== z.owner && dist(z.x, z.y, p.x, p.y) < z.r) this.damagePlayer(p, p.maxHp * 0.04, z.owner, true);
        }
      }
    }
    this.zones = this.zones.filter((z) => z.life > 0);
  }

  updateBullets(dt) {
    for (const b of this.bullets) {
      if (b.dead) continue;
      b.life -= dt;
      const nx = b.x + b.vx * dt;
      const ny = b.y + b.vy * dt;
      if (b.life <= 0 || nx < 30 || ny < 30 || nx > WORLD.w - 30 || ny > WORLD.h - 30) { b.dead = true; continue; }
      if (blocked(nx, ny, b.radius || 2)) { b.dead = true; this.emit('spark', nx, ny, b.color, { life: 0.2, maxLife: 0.2 }); continue; }
      if (this.mode === 'pve') {
        let hit = false;
        for (const e of this.enemies) {
          if (e.dead || e.spawnTimer > 0) continue;
          if (e.type === 'entangler' && !e.attached && dist(e.x, e.y, this.players.find((p) => p.id === b.owner)?.x || 0, this.players.find((p) => p.id === b.owner)?.y || 0) > e.immuneRange) continue;
          if (dist(nx, ny, e.x, e.y) < e.r + 5) {
            hit = true;
            b.dead = true;
            this.damageEnemy(e, b.damage, b.owner, b.kind === 'rocket');
            if (b.kind === 'rocket') this.explode(nx, ny, b.splash, b.splashRadius, b.owner);
            break;
          }
        }
        if (hit) continue;
        for (const barrel of this.barrels) {
          if (barrel.hp <= 0) continue;
          if (dist(nx, ny, barrel.x, barrel.y) < barrel.r + 4) { barrel.hp -= b.damage; b.dead = true; if (barrel.hp <= 0) this.explodeBarrel(barrel); break; }
        }
      } else {
        for (const barrel of this.barrels) {
          if (barrel.hp <= 0 || barrel.exploded) continue;
          if (dist(nx, ny, barrel.x, barrel.y) < barrel.r + 4) {
            barrel.hp -= b.damage;
            b.dead = true;
            if (barrel.hp <= 0) this.explodeBarrel(barrel);
            break;
          }
        }
        if (b.dead) continue;
        for (const p of this.players) {
          if (p.id === b.owner || !p.alive) continue;
          if (dist(nx, ny, p.x, p.y) < p.r + 5) {
            b.dead = true;
            this.damagePlayer(p, b.damage, b.owner);
            if (b.kind === 'rocket') this.explode(nx, ny, b.splash, b.splashRadius, b.owner);
            break;
          }
        }
      }
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
    for (const b of this.enemyBullets) {
      if (b.dead) continue;
      b.life -= dt;
      const nx = b.x + b.vx * dt;
      const ny = b.y + b.vy * dt;
      if (b.life <= 0 || blocked(nx, ny, b.radius || 3)) { b.dead = true; continue; }
      for (const p of this.players) {
        if (!p.alive || p.downed || p.disconnected) continue;
        if (dist(nx, ny, p.x, p.y) < p.r + (b.radius || 4)) {
          b.dead = true;
          this.damagePlayer(p, b.damage, null, b.poison);
          break;
        }
      }
    }
    this.enemyBullets = this.enemyBullets.filter((b) => !b.dead);
  }

  damageEnemy(e, damage, ownerId, splash = false) {
    if (e.dead) return;
    e.hp -= damage;
    e.hitFlash = 0.12;
    const owner = this.players.find((p) => p.id === ownerId);
    if (owner) { owner.damage += damage; this.teamDamage += damage; }
    if (e.hp <= 0) {
      e.dead = true;
      this.emit('death', e.x, e.y, '#ff9e6b', { life: 0.35, maxLife: 0.35 });
      if (owner) {
        owner.credits += rndInt(e.credits?.[0] || 1, e.credits?.[1] || 5);
        owner.kills += 1;
        const xpGain = e.type === 'boss' ? 320 : e.type === 'elite' ? 72 : 28 + this.wave * 2;
        owner.xp += xpGain;
        while (owner.xp >= owner.xpNext) {
          owner.xp -= owner.xpNext;
          owner.level += 1;
          owner.maxHp += 12;
          owner.hp = Math.min(owner.maxHp, owner.hp + 28);
          owner.xpNext = Math.round(80 * Math.pow(1.22, owner.level - 1));
        }
      }
      if (e.type === 'boss') {
        this.boss = null;
        if (this.config.pveMode === 'boss') {
          this.pveBossIndex += 1;
          this.waveTimer = 2.4;
        }
      }
    }
  }

  damagePlayer(p, damage, sourceId = null, poison = false) {
    if (!p.alive || p.downed || p.disconnected || p.invuln > 0) return;
    if (poison && p.characterData.poisonImmune) return;
    let amount = damage * (1 - (p.characterData.damageReduction || 0));
    p.hp -= amount;
    p.hitFlash = 0.2;
    p.invuln = 0.08;
    if (sourceId) {
      const owner = this.players.find((e) => e.id === sourceId);
      if (owner) {
        owner.damage += Math.min(amount, Math.max(0, p.hp + amount));
        if (p.hp - amount <= 0 && owner.id !== p.id) owner.kills += 1;
      }
    }
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      p.downed = this.mode === 'pve';
      p.deaths += 1;
      p.downedAt = this.time;
      p.entangled = false;
      p.entangleEnemy = null;
      if (this.mode === 'pvp') {
        const alive = this.players.filter((e) => e.alive).length;
        p.rank = alive + 1;
        this.pvpDeathOrder.push(p.id);
        this.checkPvpRound();
      } else {
        this.emit('down', p.x, p.y, '#ff725f');
        if (this.players.every((e) => !e.alive)) this.finishPveFailure();
      }
    }
  }

  updatePve(dt) {
    if (this.phase === 'result') return;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'active';
        this.wave = 1;
        if (this.config.pveMode === 'boss') {
          this.spawnBoss(0);
        } else {
          this.spawnWave();
        }
      }
      return;
    }
    this.updatePlayers(dt);
    this.updateZones(dt);
    this.updateBullets(dt);
    this.updateEnemies(dt);
    if (this.phase !== 'active') return;
    if (this.config.pveMode === 'boss') {
      if (!this.boss && this.waveTimer > 0) {
        this.waveTimer -= dt;
        if (this.waveTimer <= 0) this.spawnBoss(this.pveBossIndex);
      }
      return;
    }
    if (this.enemies.length === 0 && !this.boss) {
      if (!this.waveClear) { this.waveClear = true; this.waveTimer = 3.4; }
      else {
        this.waveTimer -= dt;
        if (this.waveTimer <= 0) {
          this.wave += 1;
          this.waveClear = false;
          this.spawnWave();
        }
      }
    }
  }

  spawnWave() {
    this.biome = BIOMES[Math.floor((this.wave - 1) / 5) % BIOMES.length] || 'lab';
    const scale = this.playerCount >= 3 ? 2 : this.playerCount === 2 ? 1.5 : 1;
    const count = Math.min(42, Math.round((4 + this.wave * 2) * scale));
    const pool = BIOME_POOLS[this.biome] || BIOME_POOLS.lab;
    for (let i = 0; i < count; i += 1) {
      const type = this.wave % 5 === 0 ? (i === 0 ? null : pool[rndInt(0, pool.length - 1)]) : pool[rndInt(0, pool.length - 1)];
      if (!type) continue;
      this.spawnEnemy(type);
    }
    if (this.wave % 5 === 0) this.spawnBoss(this.wave / 5 - 1);
    this.phase = 'active';
  }

  spawnEnemy(type) {
    const spec = ENEMY_SPECS[type];
    if (!spec) return null;
    const door = MAP.spawnPoints[rndInt(0, MAP.spawnPoints.length - 1)];
    const scale = this.playerCount >= 3 ? 2 : this.playerCount === 2 ? 1.5 : 1;
    const hp = Math.round(spec.hp(this.wave) * scale);
    const e = {
      id: id('e'), type, r: spec.r, x: door.x + rnd(-45, 45), y: door.y + rnd(-45, 45),
      angle: 0, aimAngle: 0, vx: 0, vy: 0, hp, maxHp: hp,
      speed: spec.speed(this.wave), damage: spec.damage(this.wave) * Math.sqrt(scale),
      behavior: spec.behavior, range: spec.range, preferred: spec.preferred || 0,
      cd: spec.cd, bulletSpeed: spec.bulletSpeed || 0, credits: spec.credits,
      attackCd: rnd(0.2, 0.9), spawnTimer: 0.9, spawnMax: 0.9, attackAnim: 0,
      windup: 0, telegraph: 0.3, hasLOS: false, stunTimer: 0, dead: false,
      immuneRange: spec.immuneRange || 0, attached: false, attachedPlayer: null,
      chargeState: 'ready', chargeUsed: false, chargeTime: 0, chargeDirX: 0, chargeDirY: 0,
      chargeSpeed: spec.chargeSpeed ? spec.chargeSpeed(this.wave) : 0,
      poison: spec.poison || false, stun: spec.stun || 0, burst: spec.burst || 0,
    };
    this.enemies.push(e);
    return e;
  }

  spawnBoss(index) {
    const kinds = ['director', 'sergeant', 'robot'];
    const kind = kinds[index % 3];
    const def = BOSS_DEFS[kind];
    const cycle = Math.floor(index / 3);
    const scale = this.playerCount >= 3 ? 2 : this.playerCount === 2 ? 1.5 : 1;
    const hp = Math.round(def.hp * scale * (1 + cycle * 0.55));
    const boss = {
      id: id('boss'), type: 'boss', bossKind: kind, name: def.name, r: def.r,
      x: MAP.bossSpawn.x, y: MAP.bossSpawn.y, angle: 0, aimAngle: 0,
      hp, maxHp: hp, speed: def.speed, damage: def.damage * (1 + cycle * 0.35),
      behavior: kind, range: 520, preferred: 240, attackCd: 1.5, windup: 0, telegraph: 0.5,
      phase2: false, hasLOS: false, spawnTimer: 1.2, spawnMax: 1.2, dead: false,
      color: def.color, spawnCycle: cycle,
    };
    this.boss = boss;
    this.enemies.push(boss);
    return boss;
  }

  updateEnemies(dt) {
    const targets = this.players.filter((p) => p.alive && !p.downed && !p.disconnected);
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.spawnTimer > 0) { e.spawnTimer = Math.max(0, e.spawnTimer - dt); continue; }
      if (e.stunTimer > 0) { e.stunTimer -= dt; continue; }
      const spec = ENEMY_SPECS[e.type];
      if (spec?.behavior === 'entangler') {
        this.updateEntangler(e, dt, targets);
        continue;
      }
      if (e.type === 'charger') { this.updateCharger(e, dt, targets); continue; }
      const target = targets.sort((a, b) => dist(e.x, e.y, a.x, a.y) - dist(e.x, e.y, b.x, b.y))[0];
      if (!target) continue;
      const d = dist(e.x, e.y, target.x, target.y);
      e.aimAngle = Math.atan2(target.y - e.y, target.x - e.x);
      e.angle = e.aimAngle;
      e.hasLOS = lineClear(e.x, e.y, target.x, target.y);
      e.attackCd -= dt;
      if (e.behavior === 'ranged' || e.type === 'boss') {
        if (e.hasLOS && d < e.range && e.attackCd <= 0) {
          e.attackCd = e.type === 'boss' ? 1.25 : rnd(e.cd[0], e.cd[1]);
          e.attackAnim = 0.22;
          const count = e.type === 'boss' ? 5 : (e.burst || 1);
          for (let i = 0; i < count; i += 1) this.enemyShoot(e, target, i - (count - 1) / 2);
          continue;
        }
        if (d > (e.preferred || 180) + 30 || !e.hasLOS) {
          const a = e.aimAngle;
          moveActor(e, Math.cos(a) * e.speed * dt, Math.sin(a) * e.speed * dt);
        }
        continue;
      }
      if (spec?.behavior === 'mutant') {
        if (d < e.r + target.r + 10) {
          for (const victim of targets) {
            if (dist(e.x, e.y, victim.x, victim.y) < 100 + victim.r) this.damagePlayer(victim, e.damage, null);
          }
          this.emit('explosion', e.x, e.y, '#b8ff75', { life: 0.45, maxLife: 0.45 });
          e.dead = true;
        } else moveActor(e, Math.cos(e.aimAngle) * e.speed * dt, Math.sin(e.aimAngle) * e.speed * dt);
        continue;
      }
      if (d > e.r + target.r + 6) {
        moveActor(e, Math.cos(e.aimAngle) * e.speed * dt, Math.sin(e.aimAngle) * e.speed * dt);
      } else if (e.attackCd <= 0) {
        e.attackCd = rnd(e.cd?.[0] || 0.9, e.cd?.[1] || 1.3);
        e.attackAnim = 0.22;
        this.damagePlayer(target, e.damage, null);
        if (e.stun) target.paralyzed = Math.max(target.paralyzed, e.stun);
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  updateEntangler(e, dt, targets) {
    if (e.attached) {
      const p = e.attachedPlayer;
      if (!p || !p.entangled) { e.attached = false; e.attachedPlayer = null; }
      else { e.x = p.x; e.y = p.y; }
      return;
    }
    const target = targets[0];
    if (!target) return;
    const d = dist(e.x, e.y, target.x, target.y);
    e.aimAngle = Math.atan2(target.y - e.y, target.x - e.x);
    e.angle = e.aimAngle;
    if (d > 84) {
      moveActor(e, Math.cos(e.aimAngle) * e.speed * dt, Math.sin(e.aimAngle) * e.speed * dt);
      return;
    }
    target.entangled = true;
    target.entangleTimer = 2.55;
    target.entangleDuration = 2.55;
    target.entanglePresses = 0;
    target.entangleRequired = 6;
    target.entangleEnemy = e;
    target.input.struggle = false;
    e.attached = true;
    e.attachedPlayer = target;
    e.x = target.x; e.y = target.y;
  }

  releaseEntangle(p, success) {
    const e = p.entangleEnemy;
    p.entangled = false;
    p.entangleTimer = 0;
    p.entanglePresses = 0;
    p.entangleEnemy = null;
    if (e) { e.attached = false; e.attachedPlayer = null; if (success) e.dead = true; }
    if (!success) this.damagePlayer(p, p.maxHp * 3, null);
  }

  updateCharger(e, dt, targets) {
    const target = targets.sort((a, b) => dist(e.x, e.y, a.x, a.y) - dist(e.x, e.y, b.x, b.y))[0];
    if (!target) return;
    const d = dist(e.x, e.y, target.x, target.y);
    e.aimAngle = Math.atan2(target.y - e.y, target.x - e.x);
    e.angle = e.aimAngle;
    if (e.chargeState === 'windup') {
      e.windup -= dt;
      if (e.windup <= 0) { e.chargeState = 'charging'; e.chargeTime = 1.12; e.chargeDirX = Math.cos(e.aimAngle); e.chargeDirY = Math.sin(e.aimAngle); }
      return;
    }
    if (e.chargeState === 'charging') {
      e.chargeTime -= dt;
      const nx = e.x + e.chargeDirX * e.chargeSpeed * dt;
      const ny = e.y + e.chargeDirY * e.chargeSpeed * dt;
      if (blocked(nx, ny, e.r)) { e.chargeState = 'spent'; e.chargeUsed = true; }
      else { e.x = nx; e.y = ny; }
      if (dist(e.x, e.y, target.x, target.y) < e.r + target.r + 8) {
        target.paralyzed = Math.max(target.paralyzed, 3);
        this.damagePlayer(target, e.damage * 1.25, null);
        e.chargeState = 'spent'; e.chargeUsed = true;
      }
      if (e.chargeTime <= 0) { e.chargeState = 'spent'; e.chargeUsed = true; }
      return;
    }
    if (!e.chargeUsed && d < 560 && d > 75 && lineClear(e.x, e.y, target.x, target.y)) {
      e.chargeState = 'windup'; e.windup = 0.48; e.chargeUsed = true; e.telegraph = 0.48;
      return;
    }
    if (d > e.r + target.r + 8) moveActor(e, Math.cos(e.aimAngle) * e.speed * dt, Math.sin(e.aimAngle) * e.speed * dt);
    else {
      e.attackCd -= dt;
      if (e.attackCd <= 0) { e.attackCd = rnd(0.9, 1.35); this.damagePlayer(target, e.damage, null); }
    }
  }

  enemyShoot(e, target, offset = 0) {
    const angle = Math.atan2(target.y - e.y, target.x - e.x) + offset * 0.1;
    this.enemyBullets.push({
      id: id('eb'), x: e.x + Math.cos(angle) * (e.r + 6), y: e.y + Math.sin(angle) * (e.r + 6),
      vx: Math.cos(angle) * (e.bulletSpeed || 420), vy: Math.sin(angle) * (e.bulletSpeed || 420),
      damage: e.damage * 0.62, radius: 4, life: 2.2, color: e.poison ? '#a6ef74' : '#ff8069', poison: e.poison,
    });
  }

  explode(x, y, damage, radius, ownerId) {
    this.emit('explosion', x, y, '#ffb36e', { life: 0.5, maxLife: 0.5 });
    if (this.mode === 'pve') {
      for (const e of this.enemies) if (!e.dead && dist(x, y, e.x, e.y) < radius + e.r) this.damageEnemy(e, damage, ownerId);
    } else {
      for (const p of this.players) if (p.alive && dist(x, y, p.x, p.y) < radius + p.r) this.damagePlayer(p, damage, ownerId);
    }
  }

  explodeBarrel(barrel) {
    if (barrel.exploded) return;
    barrel.exploded = true;
    barrel.hp = 0;
    this.explode(barrel.x, barrel.y, 48, 135, null);
  }

  updatePvp(dt) {
    if (this.phase === 'result') return;
    if (this.phase === 'roundSummary') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        if (this.round >= this.rounds) this.finishPvp();
        else { this.round += 1; this.setupPvpRound(); }
      }
      return;
    }
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.phase = 'active';
      return;
    }
    this.updatePlayers(dt);
    this.updateZones(dt);
    this.updateBullets(dt);
    if (this.phase === 'active' && this.players.filter((p) => p.alive && !p.disconnected).length <= 1) this.checkPvpRound();
    this.medkitTimer -= dt;
    if (this.medkitTimer <= 0) {
      this.medkitTimer = rnd(5, 9);
      const x = rnd(300, WORLD.w - 300); const y = rnd(300, WORLD.h - 300);
      if (!blocked(x, y, 18)) this.medkits.push({ id: id('m'), x, y, r: 14 });
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      for (const kit of this.medkits) {
        if (kit.taken) continue;
        if (dist(p.x, p.y, kit.x, kit.y) < p.r + 16) {
          kit.taken = true; p.hp = Math.min(p.maxHp, p.hp + 35);
        }
      }
    }
    this.medkits = this.medkits.filter((k) => !k.taken);
    for (const barrel of this.barrels) if (barrel.hp <= 0 && !barrel.exploded) this.explodeBarrel(barrel);
  }

  checkPvpRound() {
    const alive = this.players.filter((p) => p.alive && !p.disconnected);
    if (alive.length > 1 || this.phase !== 'active') return;
    if (alive.length === 1) {
      alive[0].rank = 1;
      alive[0].score += 200;
    }
    this.phase = 'roundSummary';
    this.countdown = 4.6;
    const rows = this.players.map((p) => ({ id: p.id, name: p.name, rank: p.rank || 1, credits: 0, tech: 0 }));
    for (const p of this.players) {
      const rank = p.rank || (p.alive ? 1 : rows.length);
      p.rank = rank;
      const creditReward = [300, 220, 160, 120, 90, 70, 50, 40][rank - 1] || 30;
      const techReward = [3, 3, 2, 2, 1, 1, 1, 0][rank - 1] || 0;
      p.credits += creditReward;
      p.tech += techReward;
      p.score += (rows.length - rank + 1) * 100;
      const row = rows.find((r) => r.id === p.id);
      if (row) { row.credits = creditReward; row.tech = techReward; }
    }
    this.roundSummary = { round: this.round, rows };
  }

  finishPvp() {
    const sorted = [...this.players].sort((a, b) => b.score - a.score || b.kills - a.kills);
    this.result = {
      type: 'pvp', title: '对战结束', subtitle: `已完成 ${this.rounds} 回合 · 按总积分排名`,
      rows: sorted.map((p, i) => ({
        rank: i + 1, name: p.name, kills: p.kills, deaths: p.deaths, damage: Math.round(p.damage),
        score: p.score, credits: p.credits, tech: p.tech,
      })),
    };
    this.phase = 'result';
  }

  finishPveFailure() {
    this.result = {
      type: 'pve', title: '作战失败', subtitle: '全员失去战斗能力',
      rows: this.players.map((p) => ({ name: p.name, damage: Math.round(p.damage), kills: p.kills, deaths: p.deaths, revives: p.revives })),
    };
    this.phase = 'result';
  }

  publicPlayer(p) {
    return {
      id: p.id, name: p.name, character: p.character, characterId: p.character, color: p.color,
      x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, angle: p.angle,
      r: Math.round(p.r * 10) / 10, hp: Math.ceil(p.hp), maxHp: p.maxHp,
      speedBase: p.speedBase, weaponMobility: WEAPONS[p.weapon]?.mobility || 1,
      alive: p.alive, downed: p.downed, reviveProgress: p.reviveProgress, reviveLocked: !!p.reviveLocked,
      invuln: p.invuln, hitFlash: p.hitFlash, moving: p.moving, walkPhase: p.walkPhase,
      weapon: p.weapon, owned: p.owned, ammo: p.ammo, mods: p.mods,
      reloading: p.reloading, reloadTimer: p.reloadTimer, reloadDuration: p.reloadDuration,
      credits: p.credits, tech: p.tech, upgrades: p.upgrades,
      kills: p.kills, deaths: p.deaths, damage: Math.round(p.damage), revives: p.revives,
      score: p.score, rank: p.rank, level: p.level, xp: Math.floor(p.xp), xpNext: p.xpNext,
      grenades: p.grenades, selectedGrenade: p.selectedGrenade,
      paralyzed: p.paralyzed, entangled: p.entangled, entangleTimer: p.entangleTimer,
      entangleDuration: p.entangleDuration, entanglePresses: p.entanglePresses,
      entangleRequired: p.entangleRequired,
      skillCooldown: p.skillCooldown, skillCooldownMax: p.skillCooldownMax,
      healDroneTimer: p.healDroneTimer, holoShieldTimer: p.holoShieldTimer, valkyrieMissiles: p.valkyrieMissiles,
      shieldUnlocked: p.holoShieldTimer > 0, shield: p.holoShieldTimer > 0 ? 70 : 0, maxShield: 70,
      talentPoints: 0, talents: {}, reviving: false,
    };
  }

  snapshot() {
    return {
      server: true,
      t: Math.round(this.time * 1000) / 1000,
      mode: this.mode, pveMode: this.config.pveMode, phase: this.phase,
      wave: this.wave, round: this.round, rounds: this.rounds,
      countdown: Math.max(0, this.countdown), waveClear: this.waveClear,
      biome: this.biome, teamDamage: Math.round(this.teamDamage),
      players: this.players.map((p) => this.publicPlayer(p)),
      enemies: this.enemies.map((e) => ({
        id: e.id, type: e.type, bossKind: e.bossKind, name: e.name,
        x: Math.round(e.x), y: Math.round(e.y), r: e.r, angle: e.angle, aimAngle: e.aimAngle,
        hp: Math.max(0, Math.round(e.hp)), maxHp: e.maxHp, spawnTimer: e.spawnTimer,
        spawnMax: e.spawnMax, attackAnim: e.attackAnim, hitFlash: e.hitFlash,
        windup: e.windup || 0, telegraph: e.telegraph || 0.3, phase2: !!e.phase2,
        vx: e.vx, vy: e.vy, hasLOS: e.hasLOS, dead: false,
        faction: BOSS_DEFS[e.bossKind]?.biome || (e.type === 'normal' || e.type === 'elite' ? 'military' : ['combatRobot', 'repairRobot', 'gunnerRobot'].includes(e.type) ? 'robot' : 'lab'),
      })),
      bullets: this.bullets.map((b) => ({
        id: b.id, x: Math.round(b.x), y: Math.round(b.y), vx: b.vx, vy: b.vy,
        color: b.color, hostile: false, radius: b.radius || 2, kind: b.kind,
      })),
      enemyBullets: this.enemyBullets.map((b) => ({
        id: b.id, x: Math.round(b.x), y: Math.round(b.y), vx: b.vx, vy: b.vy,
        color: b.color, hostile: true, radius: b.radius || 4,
      })),
      boss: this.boss ? {
        id: this.boss.id, type: 'boss', bossKind: this.boss.bossKind, name: this.boss.name,
        x: Math.round(this.boss.x), y: Math.round(this.boss.y), r: this.boss.r,
        aimAngle: this.boss.aimAngle, hp: Math.max(0, Math.round(this.boss.hp)), maxHp: this.boss.maxHp,
        hitFlash: this.boss.hitFlash,
      } : null,
      barrels: this.barrels, medkits: this.medkits,
      zones: this.zones, effects: this.effects,
      roundSummary: this.roundSummary, result: this.result,
    };
  }
}

module.exports = { Match, MAP, CHARACTERS, WEAPONS, WEAPON_ORDER, PVP_SPAWNS };
