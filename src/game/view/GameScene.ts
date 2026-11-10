import Phaser from 'phaser';
import { getRule } from '../../contracts/catalog';
import { DT, type Game, type RuleChange } from '../Game';
import type { Params } from '../params';
import { arenaBounds, CENTER, MAX_HP, WORLD_H, WORLD_W, type World } from '../world';

const STEP_MS = DT * 1000;
const ACTION_LABEL = { dash: 'Dash', shoot: 'Blaster', shield: 'Shield', blink: 'Blink' } as const;
const CONTACT_COLOR = { damage: 0xef5350, none: 0x9e9e9e, heal: 0x66bb6a, eat: 0xf48fb1 } as const;

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: number; size: number }

/**
 * Presentation only: runs the fixed-step loop, draws the world, owns camera
 * and post-FX. Reads Game/World/Params; never mutates simulation state
 * (except draining the event outbox).
 */
export class GameScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private toast!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private pausedText!: Phaser.GameObjects.Text;
  private waiting = false;
  private waitT = 0;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private acc = 0;
  private cam = { x: CENTER.x, y: CENTER.y, zoom: 1, angle: 0 };
  private particles: Particle[] = [];
  private history = new Map<string, { x: number; y: number }[]>();
  private toastT = 0;
  private fx: {
    color?: Phaser.FX.ColorMatrix;
    pixel?: Phaser.FX.Pixelate;
    blur?: Phaser.FX.Blur;
    vignette?: Phaser.FX.Vignette;
  } = {};
  private hasFx = false;

  constructor(private readonly game_: Game) {
    super('game');
  }

  create() {
    this.g = this.add.graphics();
    const style = { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '15px', color: '#e8ecf4' };
    this.hud = this.add.text(14, 12, '', { ...style, lineSpacing: 4 }).setShadow(1, 1, '#000', 2);
    this.info = this.add.text(0, 12, '', { ...style, fontSize: '12px', color: '#9aa4b8', align: 'right' }).setOrigin(1, 0);
    this.hint = this.add.text(14, 0, '', { ...style, fontSize: '12px', color: '#9aa4b8' }).setOrigin(0, 1);
    this.toast = this.add
      .text(0, 70, '', { ...style, fontSize: '18px', align: 'center', lineSpacing: 6 })
      .setOrigin(0.5, 0)
      .setShadow(2, 2, '#000', 4)
      .setAlpha(0);
    this.pausedText = this.add
      .text(0, 0, 'PAUSED\npress P to resume', { ...style, fontSize: '28px', align: 'center', lineSpacing: 8 })
      .setOrigin(0.5)
      .setShadow(2, 2, '#000', 6)
      .setVisible(false);

    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCam.ignore(this.g);
    this.cameras.main.ignore([this.hud, this.info, this.hint, this.toast, this.pausedText]);
    this.cameras.main.setBackgroundColor('#06070b');
    this.layoutHud();
    this.hasFx = this.renderer.type === Phaser.WEBGL && !!this.cameras.main.postFX;
    this.resetFx();
    this.scale.on('resize', () => {
      this.layoutHud();
      this.resetFx(); // camera post-FX targets keep their old size otherwise, shifting the view
    });

    this.game_.onRuleChange((c) => this.showToast(c));
    if (this.game_.lastChange) this.showToast(this.game_.lastChange);
  }

  private layoutHud() {
    const { width, height } = this.scale;
    this.uiCam.setSize(width, height);
    this.info.setPosition(width - 14, 12);
    this.hint.setPosition(14, height - 12);
    this.toast.setPosition(width / 2, 64);
    this.pausedText.setPosition(width / 2, height / 2);
  }

  update(_time: number, delta: number) {
    this.acc += Math.min(delta, 250);
    let steps = 0;
    this.waiting = false;
    while (this.acc >= STEP_MS && steps < 8) {
      if (!this.game_.step()) {
        // Paused: drop the time. Waiting on inputs (lockstep net play): keep a
        // little so we can catch up quickly once they arrive.
        this.waiting = !this.game_.paused;
        this.acc = this.game_.paused ? 0 : Math.min(this.acc, 300);
        break;
      }
      this.acc -= STEP_MS;
      steps++;
    }
    if (steps >= 8) this.acc = Math.min(this.acc, 300);
    this.waitT = this.waiting ? this.waitT + delta / 1000 : 0;

    const dt = delta / 1000;
    const w = this.game_.world;
    const p = this.game_.params;
    this.drainEvents(w);
    this.updateCamera(w, p, dt);
    this.updateFx(p, w.time);
    this.draw(w, p, dt);
    this.updateHud(w, p, dt);
  }

  // ── camera & post-processing ─────────────────────────────────────
  private X(p: Params, x: number) {
    return p.mirror ? WORLD_W - x : x;
  }

  private updateCamera(w: World, p: Params, dt: number) {
    const alive = w.players.filter((pl) => pl.alive);
    const pts = alive.length ? alive : w.players;
    let cx = CENTER.x, cy = CENTER.y, spanX = 0, spanY = 0;
    if (pts.length) {
      const xs = pts.map((pl) => this.X(p, pl.x)), ys = pts.map((pl) => pl.y);
      cx = xs.reduce((a, b) => a + b, 0) / xs.length;
      cy = ys.reduce((a, b) => a + b, 0) / ys.length;
      spanX = Math.max(...xs) - Math.min(...xs);
      spanY = Math.max(...ys) - Math.min(...ys);
    }
    const { width, height } = this.scale;
    const fit = Math.max(0.35, Math.min(1, width / (spanX + 700), height / (spanY + 500)));
    const targetZoom = fit * p.zoom;
    const k = 1 - Math.exp(-dt * 6 * (1 - 0.93 * p.camLag));
    this.cam.x += (cx - this.cam.x) * k;
    this.cam.y += (cy - this.cam.y) * k;
    this.cam.zoom += (targetZoom - this.cam.zoom) * (1 - Math.exp(-dt * 3));

    if (p.camSpin > 0) {
      this.cam.angle += p.camSpin * 0.6 * dt;
    } else {
      let a = this.cam.angle % (Math.PI * 2);
      if (a > Math.PI) a -= Math.PI * 2;
      if (a < -Math.PI) a += Math.PI * 2;
      this.cam.angle = a * Math.exp(-dt * 2);
    }

    const shake = p.quake * 12;
    const main = this.cameras.main;
    main.setZoom(this.cam.zoom);
    main.setRotation(this.cam.angle);
    main.centerOn(this.cam.x + (Math.random() - 0.5) * shake, this.cam.y + (Math.random() - 0.5) * shake);
  }

  private resetFx() {
    if (!this.hasFx) return;
    this.cameras.main.postFX.clear();
    this.fx = { color: this.cameras.main.postFX.addColorMatrix() };
  }

  private updateFx(p: Params, time: number) {
    if (!this.hasFx) return;
    const pfx = this.cameras.main.postFX;
    const cm = this.fx.color!;
    cm.reset();
    if (p.hue > 0) cm.hue((time * 90 * p.hue) % 360, true);
    if (p.night > 0) cm.brightness(1 - 0.55 * p.night, true);
    if (p.invert) cm.negative(true);

    if (p.pixelate > 0.02) {
      this.fx.pixel ??= pfx.addPixelate(1);
      this.fx.pixel.amount = 1 + p.pixelate * 7;
    } else if (this.fx.pixel) { pfx.remove(this.fx.pixel); this.fx.pixel = undefined; }

    if (p.blur > 0.02) {
      this.fx.blur ??= pfx.addBlur(0, 2, 2, 1, 0xffffff, 4);
      this.fx.blur.strength = p.blur * 2.5;
    } else if (this.fx.blur) { pfx.remove(this.fx.blur); this.fx.blur = undefined; }

    if (p.darkness > 0.02) {
      this.fx.vignette ??= pfx.addVignette(0.5, 0.5, 0.8, 1);
      this.fx.vignette.radius = 0.85 - 0.62 * p.darkness;
      this.fx.vignette.strength = 1;
    } else if (this.fx.vignette) { pfx.remove(this.fx.vignette); this.fx.vignette = undefined; }
  }

  // ── drawing ──────────────────────────────────────────────────────
  private draw(w: World, p: Params, dt: number) {
    const g = this.g;
    const X = (x: number) => this.X(p, x);
    const t = w.time;
    g.clear();

    // floor + grid
    g.fillStyle(0x0d1018, 1).fillRect(0, 0, WORLD_W, WORLD_H);
    g.lineStyle(1, 0x161b27, 1);
    for (let x = 0; x <= WORLD_W; x += 100) g.lineBetween(x, 0, x, WORLD_H);
    for (let y = 0; y <= WORLD_H; y += 100) g.lineBetween(0, y, WORLD_W, y);

    // position-seed zones: grid + occupied cells
    const ov = this.game_.seedOverlay();
    if (ov?.cellSize) {
      const s = ov.cellSize;
      g.lineStyle(2, 0x3949ab, 0.45);
      for (let x = 0; x <= WORLD_W; x += s) g.lineBetween(X(x), 0, X(x), WORLD_H);
      for (let y = 0; y <= WORLD_H; y += s) g.lineBetween(0, y, WORLD_W, y);
      const pulse = 0.07 + 0.03 * Math.sin(t * 3);
      for (const c of ov.activeCells ?? []) {
        const x = p.mirror ? WORLD_W - (c.cx + 1) * s : c.cx * s;
        g.fillStyle(0x7986cb, pulse).fillRect(x, c.cy * s, s, s);
        g.lineStyle(3, 0x9fa8da, 0.7).strokeRect(x, c.cy * s, s, s);
      }
    }
    // anchor points the current seed was sampled from (timed position mode)
    for (const pt of ov?.points ?? []) {
      const x = X(pt.x), r = 22 + 4 * Math.sin(t * 4);
      g.lineStyle(2, 0x9fa8da, 0.8).strokeCircle(x, pt.y, r);
      g.lineBetween(x - r - 8, pt.y, x - r + 6, pt.y);
      g.lineBetween(x + r - 6, pt.y, x + r + 8, pt.y);
      g.lineBetween(x, pt.y - r - 8, x, pt.y - r + 6);
      g.lineBetween(x, pt.y + r - 6, x, pt.y + r + 8);
      g.fillStyle(0x9fa8da, 0.9).fillCircle(x, pt.y, 3);
    }

    // conveyors
    if (p.conveyor > 0) {
      const a = Math.min(1, p.conveyor / 1100);
      for (let band = 0; band * 150 < WORLD_H; band++) {
        const dir = band % 2 === 0 ? 1 : -1;
        g.fillStyle(dir > 0 ? 0x1a2a3a : 0x2a1a3a, 0.35 * a).fillRect(0, band * 150, WORLD_W, 150);
        g.lineStyle(2, 0x3d5a80, 0.4 * a);
        const off = ((t * 90 * dir) % 80 + 80) % 80;
        for (let x = -80 + off; x < WORLD_W + 80; x += 80) {
          const vx = X(x), cy = band * 150 + 75, s = dir * (p.mirror ? -1 : 1) * 10;
          g.lineBetween(vx - s, cy - 12, vx + s, cy);
          g.lineBetween(vx + s, cy, vx - s, cy + 12);
        }
      }
    }

    // zones
    for (let i = 0; i < p.icePatches && i < w.ice.length; i++) {
      const z = w.ice[i];
      g.fillStyle(0xb3e5fc, 0.14).fillCircle(X(z.x), z.y, z.r);
      g.lineStyle(2, 0xb3e5fc, 0.3).strokeCircle(X(z.x), z.y, z.r);
    }
    for (let i = 0; i < p.lavaPools && i < w.pools.length; i++) {
      const z = w.pools[i];
      g.fillStyle(0xff5722, 0.55).fillCircle(X(z.x), z.y, z.r);
      g.lineStyle(3, 0xffab40, 0.5 + 0.3 * Math.sin(t * 4 + i)).strokeCircle(X(z.x), z.y, z.r * (0.85 + 0.1 * Math.sin(t * 3 + i)));
    }
    for (let i = 0; i < p.speedPads && i < w.pads.length; i++) {
      const z = w.pads[i];
      const ang = p.mirror ? Math.PI - z.angle : z.angle;
      g.fillStyle(0x006064, 0.6).fillCircle(X(z.x), z.y, z.r);
      g.lineStyle(3, 0x4dd0e1, 0.9).strokeCircle(X(z.x), z.y, z.r);
      const ex = X(z.x) + Math.cos(ang) * z.r * 0.8, ey = z.y + Math.sin(ang) * z.r * 0.8;
      g.lineBetween(X(z.x) - Math.cos(ang) * z.r * 0.6, z.y - Math.sin(ang) * z.r * 0.6, ex, ey);
      g.lineBetween(ex, ey, ex - Math.cos(ang - 0.6) * 10, ey - Math.sin(ang - 0.6) * 10);
      g.lineBetween(ex, ey, ex - Math.cos(ang + 0.6) * 10, ey - Math.sin(ang + 0.6) * 10);
    }
    if (p.portals) {
      for (const pair of w.portals) {
        for (const s of [pair.a, pair.b]) {
          g.fillStyle(pair.color, 0.2).fillCircle(X(s.x), s.y, 30);
          g.lineStyle(4, pair.color, 0.9).strokeCircle(X(s.x), s.y, 24 + 4 * Math.sin(t * 5));
        }
      }
    }
    if (p.blackHole > 0) {
      const r = 22 + 14 * p.blackHole;
      for (let i = 3; i >= 1; i--) g.lineStyle(2, 0x7c4dff, 0.15 * i).strokeCircle(X(CENTER.x), CENTER.y, r + i * 30 + 8 * Math.sin(t * 2 + i));
      g.fillStyle(0x000000, 1).fillCircle(X(CENTER.x), CENTER.y, r);
      g.lineStyle(3, 0xb388ff, 0.9).strokeCircle(X(CENTER.x), CENTER.y, r);
    }

    // walls
    if (p.wallsVisible) {
      const stroke = p.wallsHurt ? 0xffeb3b : p.wallBounce > 0 ? 0x66bb6a : 0x59637d;
      const alpha = p.wallsSolid ? 1 : 0.25;
      for (const wall of w.walls) {
        const x = p.mirror ? WORLD_W - wall.x - wall.w : wall.x;
        g.fillStyle(0x2b3245, alpha).fillRect(x, wall.y, wall.w, wall.h);
        g.lineStyle(p.wallsHurt ? 3 : 2, stroke, alpha).strokeRect(x, wall.y, wall.w, wall.h);
      }
    }

    // arena edge (shrinks); dim everything outside it
    const B = arenaBounds(p.arenaScale);
    const bx0 = p.mirror ? WORLD_W - B.x1 : B.x0;
    g.fillStyle(0x000000, 0.55);
    g.fillRect(-2000, -2000, WORLD_W + 4000, B.y0 + 2000);
    g.fillRect(-2000, B.y1, WORLD_W + 4000, WORLD_H - B.y1 + 2000);
    g.fillRect(-2000, B.y0, bx0 + 2000, B.y1 - B.y0);
    g.fillRect(bx0 + (B.x1 - B.x0), B.y0, WORLD_W - bx0 - (B.x1 - B.x0) + 2000, B.y1 - B.y0);
    const edgeColor = { solid: 0x59637d, wrap: 0x4dd0e1, bouncy: 0x81c784, lava: 0xff7043 }[p.edges];
    g.lineStyle(p.edges === 'lava' ? 6 : 3, edgeColor, p.edges === 'wrap' ? 0.4 + 0.3 * Math.sin(t * 3) : 1);
    g.strokeRect(bx0, B.y0, B.x1 - B.x0, B.y1 - B.y0);

    // light-cycle trails
    if (w.trails.length) {
      const colors = new Map(w.players.map((pl) => [pl.id, pl.color]));
      for (const tr of w.trails) {
        g.fillStyle(colors.get(tr.owner) ?? 0xffffff, Math.min(1, tr.ttl * 1.5) * 0.85).fillCircle(X(tr.x), tr.y, 4);
      }
    }

    // motion trails (visual only)
    const trailLen = Math.floor(p.trails * 22);
    const live = new Set<string>();
    const track = (key: string, x: number, y: number, r: number, color: number, alpha: number) => {
      live.add(key);
      let h = this.history.get(key);
      if (!h) this.history.set(key, (h = []));
      h.push({ x, y });
      while (h.length > Math.max(trailLen, 1)) h.shift();
      if (trailLen > 1) {
        for (let i = 0; i < h.length - 1; i++) {
          const f = (i + 1) / h.length;
          g.fillStyle(color, 0.35 * f * alpha).fillCircle(h[i].x, h[i].y, r * (0.4 + 0.6 * f));
        }
      }
    };

    // coins
    for (const c of w.coins) {
      if (c.ttl < 2 && Math.floor(c.ttl * 7) % 2 === 0) continue;
      const color = p.coinValue < 0 ? 0xba68c8 : 0xffd54f;
      track(`c${c.id}`, X(c.x), c.y, 7, color, 1);
      const squish = Math.abs(Math.sin(t * 3 + c.id));
      g.fillStyle(color, 1).fillEllipse(X(c.x), c.y, 14 * (0.4 + 0.6 * squish), 14);
      g.lineStyle(2, 0xffffff, 0.6).strokeEllipse(X(c.x), c.y, 14 * (0.4 + 0.6 * squish), 14);
    }

    // enemies
    const ec = CONTACT_COLOR[p.enemyContact];
    for (const e of w.enemies) {
      const ex = X(e.x);
      track(`e${e.id}`, ex, e.y, e.r, ec, p.enemyAlpha);
      g.fillStyle(ec, p.enemyAlpha).fillCircle(ex, e.y, e.r);
      if (p.enemyShoot > 0) g.lineStyle(3, 0xffab40, p.enemyAlpha).strokeCircle(ex, e.y, e.r + 3);
      const a = Math.atan2(e.vy, p.mirror ? -e.vx : e.vx);
      for (const side of [-0.5, 0.5]) {
        const ox = ex + Math.cos(a + side) * e.r * 0.5, oy = e.y + Math.sin(a + side) * e.r * 0.5;
        g.fillStyle(0xffffff, p.enemyAlpha).fillCircle(ox, oy, e.r * 0.25);
        g.fillStyle(0x000000, p.enemyAlpha).fillCircle(ox + Math.cos(a) * 2, oy + Math.sin(a) * 2, e.r * 0.12);
      }
    }

    // bullets
    const pcolor = new Map(w.players.map((pl) => [pl.id, pl.color]));
    for (const b of w.bullets) {
      const color = b.owner === null ? 0xff8a65 : pcolor.get(b.owner) ?? 0xffffff;
      g.fillStyle(color, 1).fillCircle(X(b.x), b.y, b.r);
      g.fillStyle(0xffffff, 0.8).fillCircle(X(b.x), b.y, b.r * 0.45);
    }

    // players
    for (const pl of w.players) {
      const label = this.label(pl.id, pl.name);
      if (!pl.alive) { label.setVisible(false); this.history.delete(pl.id); continue; }
      const x = X(pl.x);
      track(pl.id, x, pl.y, pl.r, pl.color, 1);
      const blink = pl.invulnT > 0 && Math.floor(pl.invulnT * 12) % 2 === 0;
      const alpha = blink ? 0.35 : 1;
      if (w.tagIt === pl.id) {
        g.lineStyle(3, 0xffd700, 0.9);
        for (let i = 0; i < 6; i++) {
          const a = t * 2 + (i * Math.PI) / 3;
          g.lineBetween(x + Math.cos(a) * (pl.r + 12), pl.y + Math.sin(a) * (pl.r + 12), x + Math.cos(a) * (pl.r + 20), pl.y + Math.sin(a) * (pl.r + 20));
        }
      }
      g.fillStyle(pl.color, alpha).fillCircle(x, pl.y, pl.r);
      g.lineStyle(2, 0xffffff, alpha).strokeCircle(x, pl.y, pl.r);
      const fa = p.mirror ? Math.PI - pl.facing : pl.facing;
      g.lineStyle(3, 0x0b0d12, alpha).lineBetween(x, pl.y, x + Math.cos(fa) * pl.r, pl.y + Math.sin(fa) * pl.r);
      // health arc
      const frac = Math.max(0, pl.hp) / MAX_HP;
      g.lineStyle(3, frac > 0.5 ? 0x69f0ae : frac > 0.25 ? 0xffd740 : 0xff5252, 0.9);
      g.beginPath();
      g.arc(x, pl.y, pl.r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      g.strokePath();
      if (pl.shieldT > 0) {
        g.lineStyle(3, 0x80deea, 0.9).strokeCircle(x, pl.y, pl.r + 11);
        g.fillStyle(0x80deea, 0.15).fillCircle(x, pl.y, pl.r + 11);
      }
      label.setVisible(true).setPosition(x, pl.y - pl.r - 14);
    }

    for (const key of this.history.keys()) if (!live.has(key)) this.history.delete(key);

    // particles
    for (const pt of this.particles) {
      pt.life -= dt;
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vx *= 0.94; pt.vy *= 0.94;
      g.fillStyle(pt.color, Math.max(0, pt.life / pt.max)).fillCircle(pt.x, pt.y, pt.size);
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
  }

  private label(id: string, name: string) {
    let t = this.labels.get(id);
    if (!t) {
      t = this.add.text(0, 0, name, { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', color: '#ffffff' }).setOrigin(0.5, 1);
      this.uiCam.ignore(t);
      this.labels.set(id, t);
    }
    return t;
  }

  private drainEvents(w: World) {
    const p = this.game_.params;
    const counts = { pickup: 7, hurt: 10, death: 36, boom: 28, eat: 12, teleport: 10, shoot: 2, split: 10, heal: 4, steal: 10, tag: 18, kill: 14, pad: 8, spawn: 8 };
    for (const e of w.events.splice(0)) {
      const n = counts[e.type];
      const speed = e.type === 'boom' || e.type === 'death' ? 380 : 170;
      for (let i = 0; i < n && this.particles.length < 900; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = speed * (0.3 + Math.random() * 0.7);
        const life = 0.3 + Math.random() * 0.5;
        this.particles.push({
          x: this.X(p, e.x), y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life, max: life, color: e.color === 0 ? 0xb388ff : e.color, size: 2 + Math.random() * 3,
        });
      }
    }
  }

  // ── HUD ──────────────────────────────────────────────────────────
  private updateHud(w: World, p: Params, dt: number) {
    const lines = w.players.map((pl) => {
      const hp = pl.alive ? `♥ ${Math.ceil(pl.hp).toString().padStart(3)}` : 'respawning…';
      const score = p.scoresHidden ? '???' : Math.round(pl.score).toString();
      const combo = p.combo > 0 && pl.comboT > 0 && pl.combo > 0 ? `  combo x${pl.combo + 1}` : '';
      const it = w.tagIt === pl.id ? '  ★IT★' : '';
      return `${pl.name}  ${hp}   ◆ ${score}${combo}${it}`;
    });
    if (!w.players.some((pl) => pl.id === 'p2')) lines.push('P2: arrow keys to join (same keyboard)');
    this.hud.setText(lines.join('\n'));

    const active = Object.values(this.game_.live).filter((v) => v > 0.001).length;
    this.info.setText(`${this.game_.seedStatus()}\n${active} rules live · tick ${w.tick}${this.game_.paused ? ' · PAUSED' : ''}`);
    this.hint.setText(
      `P1: WASD + Space   P2: Arrows + Enter   Action: ${ACTION_LABEL[p.actionMode]}${p.actionMode === 'dash' && !p.dashEnabled ? ' (disabled)' : ''}\n` +
      `[P] pause   [T] rule timer   [R] randomize   [\`] panel`,
    );
    if (this.game_.paused) {
      this.pausedText.setText('PAUSED\npress P to resume').setVisible(true);
    } else if (this.waitT > 0.4) {
      // Lockstep: someone paused, lagged, or we're still joining.
      this.pausedText.setText(w.tick === 0 && w.players.length === 0 ? 'Connecting…' : 'Waiting for other players…').setVisible(true);
    } else {
      this.pausedText.setVisible(false);
    }

    if (this.toastT > 0) {
      this.toastT -= dt;
      this.toast.setAlpha(Math.min(1, this.toastT / 0.6));
    }
  }

  private showToast(c: RuleChange) {
    const add = c.added.map((id) => `+ ${getRule(id).name}`);
    const rem = c.removed.map((id) => `− ${getRule(id).name}`);
    const row = (xs: string[]) => {
      const out: string[] = [];
      for (let i = 0; i < xs.length; i += 4) out.push(xs.slice(i, i + 4).join('    '));
      return out;
    };
    this.toast.setText(['⟳ THE RULES HAVE CHANGED', ...row(add), ...row(rem)].join('\n'));
    this.toastT = 4;
    this.toast.setAlpha(1);
  }
}
