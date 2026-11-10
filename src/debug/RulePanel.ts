import { CATALOG, type RuleId } from '../contracts/catalog';
import type { RuleCategory } from '../contracts/rules';
import type { Game } from '../game/Game';
import type { PanelHost, SeedModeId } from './PanelHost';

const CATEGORY_LABEL: Record<RuleCategory, string> = {
  movement: 'Movement', world: 'World', enemies: 'Enemies', coins: 'Coins & Score', combat: 'Combat & Health', camera: 'Camera, Visuals & Time',
};

/** Which controls matter for each seed mode. */
const MODE_ROWS: Record<SeedModeId, { timer: boolean; zone: boolean; precision: boolean }> = {
  timer: { timer: true, zone: false, precision: false },
  position: { timer: false, zone: true, precision: false },
  both: { timer: true, zone: true, precision: false },
  constant: { timer: false, zone: false, precision: true },
  timerpos: { timer: true, zone: false, precision: true },
};

interface Row { el: HTMLElement; fill: HTMLElement; marker: HTMLElement; btn: HTMLButtonElement; slider: HTMLInputElement; val: HTMLElement }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Dev tool: game controls, seed modes, players, online play, saves, and all 100 rules live. */
export class RulePanel {
  private rows = new Map<RuleId, Row>();
  private sectionBtns = new Map<RuleCategory, HTMLButtonElement>();
  private filter = '';
  private activeOnly = false;
  private el: Record<string, HTMLElement> = {};
  private playersSig = '';
  private rosterSig = '';
  private flashT = 0;

  constructor(private root: HTMLElement, private game: Game, private host: PanelHost) {
    this.build();
    this.renderSaves();
    setInterval(() => this.refresh(), 150);
    this.refresh();
  }

  private build() {
    const r = this.root;
    r.innerHTML = `
      <header>
        <h1>Rulestorm <small>rule inspector</small></h1>
        <div class="toolbar">
          <button id="pause" class="primary" title="Pause / resume the game (P). Online, this pauses everyone."></button>
          <button id="randomize" title="New random seed — new rules right now (R)">🎲 Randomize</button>
          <button id="restart" title="Same seed, fresh world and scores">↻ Restart</button>
          <button id="newgame" title="New seed, fresh world">✦ New game</button>
        </div>

        <div class="section">
          <div class="row"><span class="lbl">Rules change by</span></div>
          <div class="seg" id="mode">
            <button data-mode="timer" title="New rules every N seconds">Timer</button>
            <button data-mode="position" title="New rules when a player enters a new zone">Zones</button>
            <button data-mode="both" title="Zone changes and the timer">Zones+Timer</button>
            <button data-mode="constant" title="Constant position: the players' exact positions pick the rules every tick. Stand still to keep them.">Live pos</button>
            <button data-mode="timerpos" title="Timer position: the players' exact positions are sampled each time the timer rolls over">Timed pos</button>
          </div>
          <div class="row" id="timerRow">
            <button id="timerToggle" title="Pause / resume the rule timer (T)"></button>
            <label>every <input id="period" type="range" min="3" max="60" step="1"> <span id="periodv" class="num"></span></label>
            <button id="reroll" title="Jump to the next timer period">Skip ⏭</button>
          </div>
          <div class="row" id="zoneRow">
            <label>Zone size <input id="zone" type="range" min="100" max="900" step="50"> <span id="zonev" class="num"></span></label>
          </div>
          <div class="row" id="precisionRow">
            <label title="Positions are rounded to this many pixels before picking rules (1 = every pixel counts)">Precision <input id="precision" type="range" min="1" max="100" step="1"> <span id="precisionv" class="num"></span></label>
          </div>
          <div class="row">
            <label>Seed <input id="seed" type="text" spellcheck="false"></label>
            <button id="apply">Apply</button>
            <button id="copy" title="Copy a link that reproduces this seed + mode">Copy link</button>
          </div>
        </div>

        <div class="section">
          <div class="row"><span class="lbl">Players</span><span id="players" class="players"></span></div>
        </div>

        <div class="section">
          <div class="row"><span class="lbl">Online (P2P)</span><span id="netState" class="muted"></span></div>
          <div class="row" id="netOffline">
            <button id="hostBtn" class="primary" title="Create a room others can join with a link">🌐 Host online game</button>
            <input id="roomIn" type="text" placeholder="room code / link" spellcheck="false">
            <button id="joinBtn">Join</button>
          </div>
          <div class="row" id="netRoster"><span id="roster" class="players"></span></div>
          <div class="row" id="netActions">
            <button id="inviteBtn" class="primary">Copy invite link</button>
            <button id="leaveBtn" class="danger"></button>
          </div>
          <div id="netErr" class="err"></div>
        </div>

        <details class="section" id="savesBox">
          <summary>Saves <span id="saveCount" class="muted"></span></summary>
          <div class="row"><button id="save" class="primary">💾 Save current game</button><span id="saveMsg" class="muted"></span></div>
          <ul id="saves" class="saves"></ul>
        </details>

        <div class="status" id="status"></div>
        <div class="row">
          <input id="filter" type="search" placeholder="Filter rules…">
          <label><input id="activeOnly" type="checkbox"> Live only</label>
          <button id="clear" title="Clear every forced rule and section">Clear forced</button>
        </div>
      </header>
      <div class="rules" id="rules"></div>`;
    for (const n of r.querySelectorAll<HTMLElement>('[id]')) this.el[n.id] = n;
    const el = this.el;
    const h = this.host;

    el.pause.onclick = () => h.game.setPaused(!h.game.isPaused());
    el.randomize.onclick = () => h.seed.randomize();
    el.restart.onclick = () => h.game.restart();
    el.newgame.onclick = () => h.game.newGame();

    for (const b of el.mode.querySelectorAll<HTMLButtonElement>('button')) {
      b.onclick = () => h.seed.setMode(b.dataset.mode as SeedModeId);
    }
    el.timerToggle.onclick = () => h.seed.setTimerPaused(!h.seed.isTimerPaused());
    el.reroll.onclick = () => h.seed.rerollNow();

    // Sliders commit on release (each change is a shared command online).
    const slider = (id: string, label: string, unit: string, get: () => number, set: (v: number) => void) => {
      const input = el[id] as HTMLInputElement;
      input.value = String(get());
      input.oninput = () => { el[label].textContent = `${input.value}${unit}`; };
      input.onchange = () => set(Number(input.value));
    };
    slider('period', 'periodv', 's', h.seed.getPeriodSec, h.seed.setPeriodSec);
    slider('zone', 'zonev', 'px', h.seed.getZoneSize, h.seed.setZoneSize);
    slider('precision', 'precisionv', 'px', h.seed.getPrecision, h.seed.setPrecision);

    const seedIn = el.seed as HTMLInputElement;
    const apply = () => { if (seedIn.value.trim()) { h.seed.setBase(seedIn.value); seedIn.blur(); } };
    el.apply.onclick = apply;
    seedIn.onkeydown = (e) => { if (e.key === 'Enter') apply(); };
    el.copy.onclick = () => this.copy(el.copy, h.seed.shareLink());

    el.hostBtn.onclick = () => h.net.host();
    const roomIn = el.roomIn as HTMLInputElement;
    const join = () => {
      let v = roomIn.value.trim();
      const m = /[?&]room=([a-z0-9]+)/i.exec(v); // accept a pasted invite link
      if (m) v = m[1];
      if (v) h.net.join(v);
    };
    el.joinBtn.onclick = join;
    roomIn.onkeydown = (e) => { if (e.key === 'Enter') join(); };
    el.inviteBtn.onclick = () => { const l = h.net.inviteLink(); if (l) this.copy(el.inviteBtn, l); };
    el.leaveBtn.onclick = () => h.net.leave();

    el.save.onclick = () => {
      const err = h.saves.save();
      el.saveMsg.textContent = err ?? 'Saved ✓';
      this.flashT = 2;
      this.renderSaves();
    };

    el.filter.oninput = (e) => { this.filter = (e.target as HTMLInputElement).value.toLowerCase(); this.refresh(); };
    el.activeOnly.onchange = (e) => { this.activeOnly = (e.target as HTMLInputElement).checked; this.refresh(); };
    el.clear.onclick = () => h.rules.clearForced();

    this.buildRules(el.rules);
  }

  private async copy(btn: HTMLElement, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      const prev = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = prev; }, 1200);
    } catch {
      prompt('Copy this link:', text);
    }
  }

  private renderSaves() {
    const list = this.host.saves.list();
    this.el.saveCount.textContent = list.length ? `(${list.length})` : '';
    const ul = this.el.saves;
    ul.innerHTML = list.length ? '' : '<li class="muted">No saves yet.</li>';
    for (const s of list) {
      const li = document.createElement('li');
      const when = new Date(s.savedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      li.innerHTML = `<span class="sname" title="${esc(s.name)}"><b>${esc(when)}</b> ${esc(s.name)}</span>`;
      const load = document.createElement('button');
      load.textContent = 'Load';
      load.onclick = () => this.host.saves.load(s.id);
      const del = document.createElement('button');
      del.textContent = '✕';
      del.title = 'Delete this save';
      del.className = 'danger';
      del.onclick = () => { if (confirm('Delete this save? This cannot be undone.')) { this.host.saves.remove(s.id); this.renderSaves(); } };
      li.append(load, del);
      ul.appendChild(li);
    }
  }

  private renderPlayers() {
    const slots = this.host.players.slots();
    const sig = slots.length ? slots.map((s) => `${s.id}:${s.joined}`).join('|') : 'online';
    if (sig === this.playersSig) return;
    this.playersSig = sig;
    const box = this.el.players;
    box.innerHTML = '';
    if (!slots.length) {
      box.innerHTML = '<span class="muted">online: one player per browser (WASD or arrows)</span>';
      return;
    }
    for (const s of slots) {
      const chip = document.createElement('span');
      chip.className = `chip ${s.joined ? 'joined' : ''}`;
      chip.textContent = s.name;
      box.appendChild(chip);
      if (!s.removable) continue;
      const b = document.createElement('button');
      b.textContent = s.joined ? `Remove ${s.name}` : `Add ${s.name}`;
      b.onclick = () => (s.joined ? this.host.players.remove(s.id) : this.host.players.add(s.id));
      box.appendChild(b);
    }
  }

  private renderNet() {
    const n = this.host.net;
    const mode = n.mode();
    const info = n.info();
    const el = this.el;
    const online = (mode === 'hosting' || mode === 'client') && !!info;
    el.netOffline.style.display = mode === 'offline' ? '' : 'none';
    el.netRoster.style.display = online ? '' : 'none';
    el.netActions.style.display = mode === 'offline' ? 'none' : '';
    el.inviteBtn.style.display = online ? '' : 'none';
    el.leaveBtn.textContent = mode === 'hosting' ? 'Stop hosting' : mode === 'joining' ? 'Cancel' : 'Leave';
    el.netState.textContent =
      mode === 'offline' ? 'offline'
        : mode === 'joining' ? `joining ${n.room()}…`
        : !info ? 'creating room…'
        : `${info.role === 'host' ? 'hosting' : 'in'} room ${n.room()} as ${info.me ?? '…'}${info.desyncs ? ` · ${info.desyncs} resync` : ''}`;
    el.netErr.textContent = n.error() ?? '';

    const sig = info ? info.roster.map((p) => `${p.id}${p.local}`).join(',') : '';
    if (sig !== this.rosterSig) {
      this.rosterSig = sig;
      el.roster.innerHTML = '';
      for (const p of info?.roster ?? []) {
        const chip = document.createElement('span');
        chip.className = 'chip joined';
        chip.style.borderColor = hex(p.color);
        chip.textContent = p.local ? `${p.name} (you)` : p.name;
        el.roster.appendChild(chip);
      }
    }
  }

  /** Keep inputs in step with the app (unless the user is using them). */
  private syncInputs() {
    const h = this.host;
    const set = (id: string, v: string) => {
      const input = this.el[id] as HTMLInputElement;
      if (document.activeElement !== input) input.value = v;
    };
    set('seed', String(h.seed.getBase()));
    set('period', String(h.seed.getPeriodSec()));
    set('zone', String(h.seed.getZoneSize()));
    set('precision', String(h.seed.getPrecision()));
  }

  private refresh() {
    const g = this.game;
    const h = this.host;
    const el = this.el;

    const paused = h.game.isPaused();
    el.pause.textContent = paused ? '▶ Resume' : '⏸ Pause';
    el.pause.classList.toggle('active', paused);

    const mode = h.seed.getMode();
    for (const b of el.mode.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('active', b.dataset.mode === mode);
    const rowsOn = MODE_ROWS[mode];
    el.timerRow.classList.toggle('disabled', !rowsOn.timer);
    el.zoneRow.style.display = rowsOn.zone ? '' : 'none';
    el.precisionRow.style.display = rowsOn.precision ? '' : 'none';
    const tp = h.seed.isTimerPaused();
    el.timerToggle.textContent = tp ? '▶ Timer' : '⏸ Timer';
    el.timerToggle.classList.toggle('active', tp);
    this.syncInputs();
    if (document.activeElement !== el.period) el.periodv.textContent = `${h.seed.getPeriodSec()}s`;
    if (document.activeElement !== el.zone) el.zonev.textContent = `${h.seed.getZoneSize()}px`;
    if (document.activeElement !== el.precision) el.precisionv.textContent = `${h.seed.getPrecision()}px`;
    this.renderPlayers();
    this.renderNet();

    if (this.flashT > 0) { this.flashT -= 0.15; if (this.flashT <= 0) el.saveMsg.textContent = ''; }

    for (const [cat, b] of this.sectionBtns) {
      const m = g.sections.get(cat);
      b.textContent = m === 'on' ? 'ALL ON' : m === 'off' ? 'ALL OFF' : 'auto';
      b.classList.toggle('forcedBtn', m !== undefined);
    }

    const live = Object.values(g.live).filter((v) => v > 0.001).length;
    el.status.textContent = `${g.deps.rules.name} · seed ${g.seed?.toString(16).padStart(8, '0') ?? '—'} · ${live} live · ${g.overrides.size} forced${g.sections.size ? ` · ${g.sections.size} sections` : ''}${paused ? ' · PAUSED' : ''}\n${g.seedStatus()}`;

    for (const def of CATALOG) {
      const id = def.id as RuleId;
      const row = this.rows.get(id)!;
      const v = g.live[id];
      const target = g.target[id];
      const ovr = g.overrides.get(id);
      const forced = g.forcedValue(id);
      const visible = (!this.activeOnly || v > 0.001) &&
        (!this.filter || def.name.toLowerCase().includes(this.filter) || def.id.includes(this.filter) || def.desc.toLowerCase().includes(this.filter));
      row.el.style.display = visible ? '' : 'none';
      row.el.classList.toggle('on', v > 0.001);
      row.el.classList.toggle('forced', ovr !== undefined);
      row.el.classList.toggle('secforced', ovr === undefined && forced !== undefined);
      row.fill.style.width = `${v * 100}%`;
      row.marker.style.left = `${target * 100}%`;
      row.val.textContent = v > 0.001 ? v.toFixed(2) : '';
      row.btn.textContent = ovr !== undefined ? (ovr > 0 ? 'ON' : 'OFF') : forced !== undefined ? (forced > 0 ? 'on' : 'off') : 'auto';
      row.slider.disabled = def.kind === 'toggle' || ovr === 0;
    }
    for (const hd of this.root.querySelectorAll<HTMLElement>('.rules h3')) {
      let n = hd.nextElementSibling as HTMLElement | null;
      let any = false;
      while (n && n.tagName !== 'H3') { if (n.style.display !== 'none') any = true; n = n.nextElementSibling as HTMLElement | null; }
      hd.style.display = any ? '' : 'none';
    }
  }

  private buildRules(list: HTMLElement) {
    let lastCat = '';
    for (const def of CATALOG) {
      if (def.category !== lastCat) {
        lastCat = def.category;
        const cat = def.category;
        const h = document.createElement('h3');
        const label = document.createElement('span');
        label.textContent = CATEGORY_LABEL[cat];
        const b = document.createElement('button');
        b.className = 'ovr sec';
        b.title = 'Whole section: auto → all ON → all OFF → auto';
        b.onclick = () => {
          const cur = this.game.sections.get(cat);
          this.host.rules.setSection(cat, cur === undefined ? 'on' : cur === 'on' ? 'off' : null);
        };
        h.append(label, b);
        this.sectionBtns.set(cat, b);
        list.appendChild(h);
      }
      const el = document.createElement('div');
      el.className = 'rule';
      el.title = `${def.id}\n${def.desc}${'group' in def && def.group ? `\nexclusive group: ${def.group}` : ''}`;
      el.innerHTML = `
        <span class="name">${def.name}</span>
        <span class="kind">${def.kind === 'toggle' ? 'T' : 'D'}</span>
        <span class="bar"><span class="fill"></span><span class="marker"></span></span>
        <span class="val"></span>
        <input class="slider" type="range" min="0" max="1" step="0.05" value="1">
        <button class="ovr">auto</button>`;
      const row: Row = {
        el,
        fill: el.querySelector('.fill')!,
        marker: el.querySelector('.marker')!,
        btn: el.querySelector('.ovr')!,
        slider: el.querySelector('.slider')!,
        val: el.querySelector('.val')!,
      };
      const id = def.id as RuleId;
      row.btn.onclick = () => {
        const cur = this.game.overrides.get(id);
        if (cur === undefined) this.host.rules.setOverride(id, def.kind === 'toggle' ? 1 : Number(row.slider.value));
        else if (cur > 0) this.host.rules.setOverride(id, 0);
        else this.host.rules.setOverride(id, null);
      };
      row.slider.onchange = () => this.host.rules.setOverride(id, Number(row.slider.value));
      if (def.kind === 'toggle') row.slider.style.visibility = 'hidden'; // keep the grid cell
      list.appendChild(el);
      this.rows.set(id, row);
    }
  }
}
