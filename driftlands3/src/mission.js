// The voyage: four chapters, each a small script that waits on the world (a number of seconds, or a condition).
// Driftlands II cut cables. This one ties them.
import * as THREE from 'three';
import { U } from './glsl.js';

const V = 'Idris Vane', W = 'Wren Halloway · the Loom', P = 'Ysolde Kerr · Pilot of Halyard';
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const K = (s) => `<kbd>${s}</kbd>`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
const bellKey = (g) => (g.input.mode === 'pad' ? 'X rings the ship\'s bell' : g.input.mode === 'touch' ? 'Bell rings the ship\'s bell' : `${K('Right click')} or ${K('E')} rings the ship's bell`);
// the lines of the long splice: which table each is made fast to, and which house it holds
export const SPLICE = [['loom', 'the Gate'], ['loom', 'the Yard'], ['shuttle', 'the Wind Works'], ['loom', 'the Wayhouse'], ['shuttle', 'the Stacks']];

export const CHAPTERS = [
  {
    numeral: 'I', title: 'The Loom', sub: 'West of Rootfall', time: 546,
    setup(g) {
      const L = g.loom.tables.loom.pos, R = g.loom.tables.rootfall ? g.loom.tables.rootfall.pos : L;
      const d = v3(L.x - R.x, 0, L.z - R.z).normalize();
      g.ship.place(v3(R.x - d.x * 620 + d.z * 60, R.y + 110, R.z - d.z * 620 - d.x * 60), Math.atan2(d.x, d.z));
      g.loom.setLit(0.12); g.halyard.setLit(0.4);
      g.setConvoy(0); g.setTime(40, 150);
    },
    *script(g) {
      const ui = g.ui, lm = g.loom;
      const n = () => g.hailed.filter(Boolean).length, N = lm.posts.length;
      const mark = () => { g.markers.length = 0; lm.posts.forEach((p, i) => { if (!g.hailed[i]) g.markers.push({ pos: lm.postPos(i), label: cap(p.name) }); }); };
      yield 1.2;
      ui.card('Chapter I', 'The Loom', 'West of Rootfall, three weeks after the Bell', 5.5);
      yield 4.5;
      g.say(V, 'Three weeks of lit windows in the east, and this is what the light has fetched out of the cloud. Halloway\'s neighbours.');
      g.say(W, 'Mind the lines, Idris. Every rope you can see is somebody\'s road home.');
      g.hailOn = true; mark();
      g.objective(`Hail the ${WORD[N]} great houses of the Loom`, 0, N);
      ui.hint(g.input.mode === 'pad' ? 'Left stick steers the ship' : g.input.mode === 'touch' ? 'Drag on the left to steer' : `Move the ring to steer · ${K('Shift')} for speed · ${K('Ctrl')} to slow`, 9);
      yield () => g.ship.pos.distanceTo(lm.postPos(0)) < 560 || n() > 0;
      ui.hint('Come close to a great house, then: ' + bellKey(g), 12);
      yield () => n() >= 1;
      mark(); g.objective(`Hail the ${WORD[N]} great houses of the Loom`, 1, N);
      g.say(W, 'There. They are lighting a lamp for you. The Weavers weave one for every guest, and you will be paying for it in visits for years.');
      yield () => n() >= 2;
      mark(); g.objective(`Hail the ${WORD[N]} great houses of the Loom`, n(), N);
      g.say(V, 'You told the Institute you had stayed for the whales, Halloway.');
      g.say(W, 'I stayed for the whales. I stayed on for the soup.');
      yield () => n() >= 3;
      mark(); g.objective(`Hail the ${WORD[N]} great houses of the Loom`, n(), N);
      g.say(V, 'Woven. All of it. The walls, the roofs, I believe the very stairs.');
      g.say(W, 'And the islands, they will tell you, if you let them. They say they weave the roots so the tables keep company. I have stopped arguing.');
      yield () => n() >= 4;
      mark(); g.objective(`Hail the ${WORD[N]} great houses of the Loom`, n(), N);
      yield () => n() >= N;
      g.markers.length = 0; g.hailOn = false; lm.setLit(1);
      g.objective('The Loom knows you', N, N);
      g.audio.sting(true);
      yield 2.5;
      g.say(W, 'Now you are known. That matters here more than a commission. Idris, look west. That is not weather.');
      g.say(V, 'Smoke. A great deal of it, and all of it under way.');
      g.say(W, 'The Weavers have a word for a town that never lands. It is not a kind word. Two peoples left the Tall City, in the story: one by the roots, and one by the air.');
      g.say(V, 'Then somebody had better go and say good morning.');
      yield g.talkDone; yield 1.5;
      g.complete();
    },
  },
  {
    numeral: 'II', title: 'Halyard', sub: 'A town that never lands', time: 80,
    setup(g) {
      g.setConvoy(260, 7); g.convoy.goal = 7;
      const hy = g.halyard, a = hy.anchor, d = g.routeDir(260);
      g.ship.place(v3(a.x + d.x * 2300 + d.z * 200, a.y + 70, a.z + d.z * 2300 - d.x * 200), Math.atan2(-d.x, -d.z));
      g.loom.setLit(1); hy.setLit(0.5);
      g.cp.hooks = g.cp.hooks || [false, false, false];
      ['the Netters', 'the Still', 'the Wayhouse'].forEach((name, i) => { if (!g.cp.hooks[i]) { const t = g.hook(hy.house(name)); const down = t.onDown; t.onDown = () => { down(); g.cp.hooks[i] = true; }; } });
      g.hooksLeft = g.hooks.length;
    },
    *script(g) {
      const ui = g.ui, hy = g.halyard;
      const left = () => g.hooks.filter((k) => k.t.alive).length;
      const near = (m, up = 0) => hy.anchor.clone().add(v3((Math.random() - 0.5) * m, 60 + up, (Math.random() - 0.5) * m));
      const first = (g.cp.hooks || []).every((x) => !x);
      yield 1.2;
      if (first) {
        ui.card('Chapter II', 'Halyard', 'A town that never lands', 5.5);
        yield 4.5;
        g.say(V, 'Great heavens, it is a town. Houses, a yard, a works. Somebody has hung out washing.');
        g.say(P, 'Airship on our bow, this is Halyard. If you have come to cut us up for parts, you may join the queue.');
      }
      g.markers.push({ pos: hy.anchor, label: 'Halyard' });
      g.objective('Meet the flying town');
      yield () => g.ship.pos.distanceTo(hy.anchor) < 1500;
      g.markers.length = 0;
      ui.warn('Tenders on the houses', 4);
      g.wave(5, near(700, 120), 160);
      if (first) {
        g.say(W, 'Tenders. The city has stopped hauling, but nobody told the gardeners out on the far lines. A town with no roots looks like deadwood to them.');
        g.say(P, 'They have hooks in three of our houses and they are winding them down into the cloud. We have no guns, airship. We have never needed any.');
      }
      let done = 3 - left();
      g.objective('Break the three pruning hooks', done, 3);
      ui.hint(g.input.mode === 'pad' ? 'Right trigger fires the lances' : g.input.mode === 'touch' ? 'Hold Fire' : `Hold ${K('Click')} or ${K('Space')} to fire the chord lances at the hooks`, 9);
      const lines = [
        () => { g.say(P, 'She is riding again. I do not know who you are, airship, but do keep on.'); g.wave(5, near(900, 150), 150); },
        () => { g.say(V, 'They prune whatever will not root. I begin to dislike gardening.'); g.wave(7, near(900, 100), 170); ui.warn('More Tenders', 4); },
      ];
      while (left() > 0) {
        const before = left();
        yield () => left() < before;
        done = 3 - left(); g.objective('Break the three pruning hooks', done, 3);
        if (left() > 0 && lines[done - 1]) lines[done - 1]();
      }
      g.objective('Clear the last of the Tenders');
      yield () => g.dronesAlive() === 0;
      g.objective('Halyard is free', 3, 3);
      g.audio.sting(true);
      g.say(P, 'Ysolde Kerr, Pilot. Halyard is nine engines short of staying up and there is weather astern of us. We saw lit windows in the east and steered for them. Is there ground there?');
      g.say(W, 'There is the Loom. Three tables and a great many opinions. Bring them in, Idris. I shall talk to the Weavers. I may be some time.');
      yield g.talkDone; yield 1.5;
      g.complete();
    },
  },
  {
    numeral: 'III', title: 'The Way In', sub: 'With weather astern', time: 262,
    setup(g) {
      const L = g.routeLen, at = [300, L[1] * 0.75, L[1] + (L[2] - L[1]) * 0.45, L[2] + 40][g.cp.stage || 0];
      g.setConvoy(at, 0); g.convoy.goal = 34; g.convoy.follow = true;
      const d = g.routeDir(at), p = g.routeAt(at + 950);
      g.ship.place(v3(p.x, p.y + 60, p.z), Math.atan2(d.x, d.z));
      g.loom.setLit(1); g.halyard.setLit(0.6);
      g.storm(true);
      g.setTime(318, 190);
    },
    *script(g) {
      const ui = g.ui, hy = g.halyard, end = g.routeLen[3];
      const k = () => g.convoyK;
      const ahead = (m, up = 60, side = 0) => { const d = g.routeDir(g.convoy.s), a = hy.anchor; return v3(a.x + d.x * m + d.z * side, Math.max(150, a.y + up), a.z + d.z * m - d.x * side); };
      const from = g.cp.stage || 0, first = (n) => from < n;
      const lead = () => { g.markers.length = 0; g.markers.push({ pos: g.routeAt(Math.min(end, g.convoy.s + 1500)).setY(g.ship.pos.y), label: 'Lead the way' }); };
      function* restart(name, line) {
        const h = hy.house(name); g.fail(h);
        ui.warn(cap(h.name) + ' has lost her engines', 5);
        g.say(P, line);
        g.markers.length = 0; g.markers.push({ pos: h.o.centre, label: 'Ring the bell alongside' });
        g.objective('Ring the ship\'s bell close alongside ' + h.name);
        ui.hint(bellKey(g) + ': old engines catch on a struck note', 9);
        yield () => !h.failing;
        g.markers.length = 0; g.audio.sting(true);
      }
      yield 1.2;
      if (first(1)) { ui.card('Chapter III', 'The Way In', 'Keep ahead of her, and keep her together', 5.5); yield 4.5; }
      g.objective('Lead Halyard in to the Loom');
      lead();
      if (first(1)) {
        g.say(P, 'Halyard will follow your stern light. Keep ahead of the Pilot house and we keep way on. Drop astern and we wait for you.');
        yield () => k() > 0.16;
        g.wave(6, ahead(900, 80), 170); ui.warn('Tenders ahead', 4);
        g.say(V, 'They have not finished with their pruning, it seems.');
        yield () => k() > 0.3 && g.dronesAlive() < 3;
        g.cp.stage = 1;
      }
      if (first(2)) {
        yield* restart('the Stacks', 'The Stacks is going down. Forty families, airship. Her engines want waking and we have nothing aboard loud enough.');
        g.say(V, 'A lance to cut and a bell to wake. The Institute did not issue this ship by accident.');
        g.objective('Lead Halyard in to the Loom'); lead();
        g.wave(5, ahead(800, 120, 300), 120); g.wave(5, ahead(800, 40, -300), 120); ui.warn('Tenders, both bows', 4);
        yield () => k() > 0.58;
        g.cp.stage = 2;
      }
      if (first(3)) {
        const boss = g.combat.spawnDrone(ahead(700, 420), { boss: true, hp: 1300, scale: 8.5, r: 38, speed: 48, dmg: 5 });
        if (boss) {
          boss.objective = true; boss.label = 'Shearsman';
          if (g.cp.boss) boss.hp = Math.max(boss.maxHp * 0.2, Math.min(boss.maxHp, g.cp.boss));
          boss.onHurt = () => { g.cp.boss = boss.hp; };
          g.markers.length = 0;
          ui.warn('Something large is coming down the wind', 5);
          g.say(W, 'That will be a Shearsman. They send one when a hedge has got quite out of hand.');
          g.objective('Bring down the Shearsman');
          yield () => !boss.alive || boss.hp < boss.maxHp * 0.55;
          if (boss.alive) { g.wave(5, ahead(600, 100), 110); yield* restart('the Mend', 'Now the Mend has stopped. That is the house that mends the others.'); g.objective('Bring down the Shearsman'); }
          yield () => !boss.alive;
          for (const dr of g.combat.drones) g.combat.hurt(dr, 999);
          g.audio.sting(true);
          g.say(V, 'Down, and the rest are scattering. Well flown.');
        }
        g.cp.stage = 3;
      }
      g.objective('Lead Halyard in to the Loom'); lead();
      g.say(W, 'I can see your lights. The Weavers have agreed to hold one line. One, on trial. I have been talking since noon.');
      yield () => { if (g.markers[0]) g.markers[0].pos.copy(g.routeAt(Math.min(end, g.convoy.s + 1500))).setY(g.ship.pos.y); return k() > 0.985; };
      g.markers.length = 0;
      g.say(P, 'Ground. Stone with grass on it. Half this town has never seen any.');
      yield g.talkDone; yield 1.5;
      g.complete();
    },
  },
  {
    numeral: 'IV', title: 'The Long Splice', sub: 'Dusk', time: 318,
    setup(g) {
      g.setConvoy(g.routeLen[3], 0);
      g.loom.setLit(1); g.halyard.setLit(0.6);
      g.setupSplice(SPLICE);
      (g.cp.lines || []).forEach((done, i) => { if (!done) return; const sp = g.splices[i]; sp.state = 2; sp.rope.mesh.visible = true; sp.rope.litGoal = 1; sp.rope.lit = 1; sp.h.moor = 1; });
      const D = g.sites.dock.approach;
      g.ship.place(D.pos.clone(), D.yaw);
      g.setTime(352, 240);
    },
    *script(g) {
      const ui = g.ui, hy = g.halyard, total = SPLICE.length;
      const mark = () => {
        g.markers.length = 0;
        if (g.carrying) g.markers.push({ pos: g.carrying.h.o.centre, label: 'Make fast: ' + g.carrying.h.name });
        else for (const sp of g.splices) if (sp.state === 0) g.markers.push({ pos: sp.anchor.world(), label: 'Line' });
      };
      const said = [
        () => g.say(P, 'Fast! Halyard has a line ashore. I never thought to say that.'),
        () => g.say(W, 'A long splice, the Weavers call it. Two ropes unlaid and married strand for strand, so the join is no thicker than the rope and runs through any block.'),
        () => { g.say(W, 'They say it wants two crews who trust each other. They say that part rather pointedly.'); g.say(P, 'Tell them we heard it.'); },
        () => g.say(V, 'Last year I cut cables for a living. I find I prefer this.'),
      ];
      yield 1.2;
      if (!g.tied()) { ui.card('Chapter IV', 'The Long Splice', 'Five lines before the light goes', 5.5); yield 4.5; }
      g.spliceOn = true;
      if (!g.tied()) {
        g.say(W, 'One line became five while you were crossing. The Weavers do nothing by halves once they have started. The coils are at the gates on the rims: take one up and carry it across.');
        g.say(P, 'And quickly, if you would. We are holding her up on habit.');
      }
      ui.hint('Fly close to a marked gate to take up a line, then carry it to the house it names', 11);
      let n = g.tied(), state = '', failT = 26;
      g.objective('Carry five lines from the Loom to Halyard', n, total);
      while (g.tied() < total) {
        // while the lines go on, houses that are not yet fast begin to sink; a line (or the bell) saves them
        const key = (g.carrying ? 'c' + g.splices.indexOf(g.carrying) : 'free') + g.tied();
        if (key !== state) { state = key; mark(); }
        if (g.tied() > n) { n = g.tied(); g.objective('Carry five lines from the Loom to Halyard', n, total); if (said[n - 1]) said[n - 1](); }
        if (g.carrying && g.markers[0]) g.markers[0].pos.copy(g.carrying.h.o.centre);
        failT -= 0.25;
        if (failT <= 0) {
          failT = 34;
          const open = g.splices.filter((sp) => sp.state !== 2 && !sp.h.failing).map((sp) => sp.h);
          if (open.length && g.failing().length < 2) { const h = open[Math.floor(Math.random() * open.length)]; g.fail(h); h.sinkGoal = 0.34; ui.warn(cap(h.name) + ' is sinking: a line or the bell will hold her', 5); }
        }
        yield 0.25;
      }
      g.markers.length = 0; g.spliceOn = false;
      g.objective('Carry five lines from the Loom to Halyard', total, total);
      for (const h of hy.houses) { h.failing = false; h.sinkGoal = 0; h.moor = Math.max(h.moor, 0.5); }
      g.say(P, 'All lines fast. Shut down the lift engines, one house at a time, and see if she holds.');
      yield 5;
      g.say(P, 'She holds.');
      g.say(W, 'Bring the Long Gallery to the Hall, Idris. There is a berth for her off the western rim. It is customary to ring when one arrives.');
      yield g.talkDone;
      const D = g.sites.dock;
      g.markers.push({ pos: D.pos, label: 'The berth' });
      g.objective('Bring the Long Gallery to her berth at the Hall');
      yield () => g.ship.pos.distanceTo(D.pos) < 520;
      ui.hint(g.input.mode === 'pad' ? 'Hold B to slow for the berth' : g.input.mode === 'touch' ? 'Ease in: she berths herself when you are close and slow' : `Hold ${K('Ctrl')} or ${K('C')} to slow. She berths herself when you are close.`, 10);
      yield () => g.ship.pos.distanceTo(D.pos) < 170 && g.ship.speed < 48;
      g.markers.length = 0;
      g.dock();
      yield () => g.docked;
      g.objective('Ring the ship\'s bell');
      g.say(V, 'Two towns, five ropes, and not one person who can say whose idea it was. Ring her in.');
      yield g.talkDone;
      g.combat.bellT = 0; g.awaitBell = true;
      ui.hint(g.input.mode === 'pad' ? 'X rings the bell' : g.input.mode === 'touch' ? 'Press Bell' : `${K('Right click')} or ${K('E')}`, 60);
      yield () => g.bellRung;
      ui.hint('', 0.01); g.objective('');
      g.finale();
      yield 6; g.say(W, 'Lanterns. Both towns at once, and neither asked the other. Oh, look at that.');
      yield 9; g.say(P, 'Halyard is fast, all lines. First time since anyone began keeping the log.');
      yield 10; g.say(W, 'They are singing the splice home, Idris. Two crews, and neither knows the other\'s words.');
      yield 10; g.say(V, 'Plate twenty two. No. I shall not hang this one. Some things the Institute may simply be told.');
      yield g.talkDone; yield 6;
      g.finish();
    },
  },
];

export const FREE = {
  numeral: '', title: 'Free flight', sub: 'After the splice', time: 20,
  setup(g) {
    g.setConvoy(g.routeLen[3], 0);
    g.setupSplice(SPLICE);
    for (const sp of g.splices) { sp.state = 2; sp.rope.mesh.visible = true; sp.rope.litGoal = 1; sp.rope.lit = 1; sp.h.moor = 1; }
    for (const h of g.halyard.houses) h.moor = Math.max(h.moor, 0.5);
    g.loom.setLit(1); g.halyard.setLit(1);
    const D = g.sites.dock.approach;
    g.ship.place(D.pos.clone(), D.yaw);
    U.uCityGlow.value = 1;
    g.freeTime = true;
  },
  *script(g) { yield 1; g.objective('The Driftlands are yours'); g.ui.card('', 'Free flight', 'Both towns keep a lamp lit for you', 5); yield 1e9; },
};

export class Mission {
  constructor(g) { this.g = g; this.it = null; this.wait = null; this.chapter = null; }
  start(ch) {
    this.chapter = ch; this.wait = null;
    ch.setup(this.g);
    this.it = ch.script(this.g);
  }
  stop() { this.it = null; this.wait = null; }
  update(dt) {
    if (!this.it) return;
    for (let guard = 0; guard < 30; guard++) {
      const w = this.wait;
      if (typeof w === 'number') { this.wait = w - dt; if (this.wait > 0) return; }
      else if (typeof w === 'function') { if (!w()) return; }
      const r = this.it.next();
      if (r.done) { this.it = null; return; }
      this.wait = r.value; dt = 0;
    }
  }
}
