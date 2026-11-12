// The voyage: four chapters, each a small script that waits on the world (a number of seconds, or a condition).
import * as THREE from 'three';
import { U } from './glsl.js';

const V = 'Idris Vane', W = 'Wren Halloway · by post';
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const K = (s) => `<kbd>${s}</kbd>`;

export const CHAPTERS = [
  {
    numeral: 'I', title: 'Moorings', sub: 'Verdigris Reach', time: 548,
    setup(g) {
      const d = g.dirCity, I = g.world.islands[0].pos;
      g.ship.place(v3(I.x - d.x * 860 + d.z * 150, I.y + 100, I.z - d.z * 860 - d.x * 150), Math.atan2(d.x, d.z));
      g.sites.grapples.forEach((s, i) => g.combat.addTarget('grapple', s.pos, { hp: 260, quat: s.quat, label: 'Grapple', onDown: () => { g.cables.verd[i].sever(); g.freeIsland(0, 1 / 3); } }));
    },
    *script(g) {
      const ui = g.ui, c = g.combat;
      const left = () => c.targets.filter((t) => t.kind === 'grapple').length;
      yield 1.2;
      ui.card('Chapter I', 'Moorings', 'Verdigris Reach, a year after the Chord', 5.5);
      yield 4.5;
      g.say(V, 'There she is. Verdigris Reach, with three cables in her side like harpoons.');
      g.say(V, 'You surveyed these islands with a lens. Today, I am sorry to say, calls for the lances.');
      g.objective('Break the three grapples on Verdigris Reach', 0, 3);
      ui.hint(g.input.mode === 'pad' ? 'Left stick steers the ship' : g.input.mode === 'touch' ? 'Drag on the left to steer' : `Move the ring to steer · ${K('Shift')} for speed`, 9);
      yield () => g.nearestTarget() < 700;
      ui.hint(g.input.mode === 'pad' ? 'Right trigger fires the lances' : g.input.mode === 'touch' ? 'Hold Fire' : `Hold ${K('Click')} or ${K('Space')} to fire the chord lances`, 9);
      yield () => left() <= 2;
      g.objective('Break the three grapples on Verdigris Reach', 1, 3);
      g.say(V, 'One. Did you see her lift? She has been dragged a full league since spring.');
      yield () => left() <= 1;
      g.objective('Break the three grapples on Verdigris Reach', 2, 3);
      const I = g.world.islands[0].pos, d = g.dirCity;
      g.wave(5, v3(I.x + d.x * 900, I.y + 160, I.z + d.z * 900), 150);
      ui.warn('Tenders on the cable', 4);
      g.say(W, 'Long Gallery, this is Halloway, on the Rootfall post. I can hear them coming down the line. They hum before they strike.');
      g.say(V, 'Wren Halloway. Ten years of silence on a warm ledge, and she chooses this morning to write.');
      yield 9;
      ui.hint(g.input.mode === 'pad' ? 'X rings the Bell' : g.input.mode === 'touch' ? 'Bell breaks everything near you' : `${K('Right click')} or ${K('E')} rings the Bell: it breaks everything near you`, 9);
      yield () => left() === 0 && g.dronesAlive() === 0;
      g.objective('Verdigris Reach is free', 3, 3);
      g.audio.sting(true);
      g.say(V, 'That is the last of them. Look at her ride. I had forgotten she could.');
      g.say(W, 'The cables all run one way, Idris. Out past the Reach, something tall is standing in the cloud where there was nothing in my day.');
      g.say(V, 'Then we follow the line and ask it what it wants. Bring her about.');
      yield g.talkDone; yield 1.5;
      g.complete();
    },
  },
  {
    numeral: 'II', title: 'The Reach', sub: 'Open cloud', time: 70,
    setup(g) {
      const d = g.dirCity, I = g.world.islands[0].pos, C = g.city.centre, L = Math.hypot(C.x - I.x, C.z - I.z);
      // if she was lost on the crossing she is picked up again a little short of where it happened
      const at = [330, L * 0.17, L * 0.36, L * 0.51, L * 0.63][g.cp.stage || 0];
      g.ship.place(v3(I.x + d.x * at, I.y + 110 + (g.cp.stage ? 70 : 0), I.z + d.z * at), Math.atan2(d.x, d.z));
      for (const c of g.cables.verd) c.hide();
      g.freeIsland(0, 1, true);
      g.storm(true);
      if ((g.cp.stage || 0) >= 4) g.setTime(322);
    },
    *script(g) {
      const ui = g.ui, d = g.dirCity, I = g.world.islands[0].pos, C = g.city.centre;
      const L = Math.hypot(C.x - I.x, C.z - I.z);                       // the whole crossing, island to city
      const s = () => (g.ship.pos.x - I.x) * d.x + (g.ship.pos.z - I.z) * d.z;
      const ahead = (m, up = 60, side = 0) => v3(g.ship.pos.x + d.x * m + d.z * side, Math.max(140, g.ship.pos.y + up), g.ship.pos.z + d.z * m - d.x * side);
      const gate = v3(C.x - d.x * 900, 330, C.z - d.z * 900);
      const from = g.cp.stage || 0, first = (n) => from < n;       // the stages already flown before a loss are not replayed
      yield 1.2;
      if (first(1)) { ui.card('Chapter II', 'The Reach', 'Open cloud, and the glass falling', 5.5); yield 4.5; }
      g.markers.push({ pos: gate, label: 'Follow the cables' });
      g.objective('Follow the cables across the Reach');
      if (first(1)) {
        g.say(V, 'Keep the cables on your left hand and do not lose them. The glass is falling.');
        yield () => s() > L * 0.2;
        g.cp.stage = 1;
      }
      if (first(2)) {
        g.wave(6, ahead(760, 70), 150); ui.warn('Tenders ahead', 4);
        if (first(1)) {
          g.say(W, 'They are not soldiers, whatever they look like. They are gardeners. Tenders. They prune what the city grows.');
          g.say(V, 'And it grows islands?');
          g.say(W, 'It lost them. That is a different thing.');
        }
        yield () => s() > L * 0.4 || (s() > L * 0.33 && g.dronesAlive() === 0);
        g.cp.stage = 2;
      }
      if (first(3)) {
        if (first(2)) g.say(V, 'Lightning. Naturally.');
        g.wave(4, ahead(700, 120, 260), 110); g.wave(5, ahead(780, 30, -240), 110); ui.warn('More of them, both bows', 4);
        yield () => s() > L * 0.55 || (s() > L * 0.48 && g.dronesAlive() === 0);
        g.cp.stage = 3;
      }
      if (first(4)) {
        g.wave(7, ahead(820, 90), 170); ui.warn('Tenders, dead ahead', 4);
        if (first(3)) g.say(W, 'Do not try to count them. It has had a year to build them and nothing else to do.');
        yield () => s() > L * 0.66;
        g.cp.stage = 4;
        g.setTime(318, 22);
        g.say(V, 'Great heavens.');
        yield 3.2;
        g.say(V, 'Halloway. That is no island.');
        g.say(W, 'No. It is the first one. Built, not grown. Everything else out here is its garden, gone to seed.');
      }
      g.markers.length = 0; g.markers.push({ pos: gate, label: 'The Tall City' });
      g.objective('Reach the Tall City');
      yield () => g.ship.pos.distanceTo(gate) < 320 || Math.hypot(g.ship.pos.x - C.x, g.ship.pos.z - C.z) < 900;
      yield g.talkDone;
      g.complete();
    },
  },
  {
    numeral: 'III', title: 'The Tall City', sub: 'Among the towers', time: 322,
    setup(g) {
      const d = g.dirCity, C = g.city.centre;
      g.ship.place(v3(C.x - d.x * 1180, 340, C.z - d.z * 1180), Math.atan2(d.x, d.z));
      for (const c of g.cables.verd) c.hide();
      g.freeIsland(0, 1, true);
      g.cp.hearts = g.cp.hearts || [false, false, false, false];
      g.alarm = g.cp.hearts.filter(Boolean).length >= 2 ? 1 : 0.25;
      g.sites.hearts.forEach((h, i) => {
        if (g.cp.hearts[i]) { g.slackHeart(i, true); return; }
        g.combat.addTarget('heart', h.pos, { hp: 600, quat: h.quat, scale: 1.5, label: 'Winch heart', onDown: () => { g.cp.hearts[i] = true; g.slackHeart(i); } });
        for (const t of h.turrets.slice(0, 2)) g.combat.spawnTurret(t.pos, t.n);
      });
    },
    *script(g) {
      const ui = g.ui, c = g.combat, C = g.city.centre;
      const left = () => c.targets.filter((t) => t.kind === 'heart').length;
      const say = [
        () => { g.say(V, 'One. That cable is paying out. Somewhere behind us an island has just breathed.'); g.wave(5, g.airNear(500), 90); },
        () => { g.alarm = 1; ui.warn('The city is awake', 4); g.say(W, 'It knows you now. Every Tender on the wall will be coming off it.'); g.wave(7, g.airNear(520), 110); },
        () => { g.say(V, 'The whole place is ringing like a struck glass.'); g.wave(6, g.airNear(480), 100); },
      ];
      yield 1.2;
      ui.card('Chapter III', 'The Tall City', 'Nine hundred metres of iron and old intent', 5.5);
      yield 4.5;
      let n = 4 - left();
      g.objective('Break the four winch hearts', n, 4);
      if (n === 0) {
        g.say(V, 'Four great winches, one behind each bundle of cable. Break their hearts and it cannot haul.');
        g.say(W, 'Mind the walls. It was built for people half again your height, and it has had a long time alone to think.');
      }
      while (left() > 0) {
        const before = left();
        yield () => left() < before;
        n = 4 - left();
        g.objective('Break the four winch hearts', n, 4);
        if (n < 4 && say[n - 1]) say[n - 1]();
      }
      g.say(V, 'That is all four. The cables are slack. Now, if it will only let us...');
      yield 3.5;
      const top = v3(C.x, g.city.max.y + 160, C.z);
      const boss = c.spawnDrone(top, { boss: true, hp: 1500, scale: 8.5, r: 38, speed: 50, dmg: 5 });
      boss.objective = true; boss.label = 'Harbourmaster';
      // what was done to it before a loss stays done
      if (g.cp.boss) boss.hp = Math.max(boss.maxHp * 0.2, Math.min(boss.maxHp, g.cp.boss));
      boss.onHurt = () => { g.cp.boss = boss.hp; };
      ui.warn('Something large has let go of the roof', 5);
      g.say(W, 'That will be the Harbourmaster. It kept the docks, when there were ships to keep them for.');
      g.objective('Bring down the Harbourmaster');
      yield () => !boss.alive || boss.hp < boss.maxHp * 0.62;
      if (boss.alive) { g.wave(4, g.airNear(450), 90); g.say(V, 'It is calling the others in. Ring the Bell when they close.'); }
      yield () => !boss.alive || boss.hp < boss.maxHp * 0.3;
      if (boss.alive) g.wave(5, g.airNear(450), 90);
      yield () => !boss.alive;
      g.alarm = 0.15;
      for (const dr of c.drones) c.hurt(dr, 999);
      g.audio.sting(true);
      g.say(V, 'Down. Oh, well flown.');
      g.say(W, 'There is a square low on the western face, with lamps. Set her down there, gently. There is a white spire in that square, older than any post of ours.');
      yield g.talkDone; yield 1;
      g.complete();
    },
  },
  {
    numeral: 'IV', title: 'The Square', sub: 'Lamps', time: 344,
    setup(g) {
      const P = g.sites.dock.approach;
      g.ship.place(P.pos.clone(), P.yaw);
      for (const c of g.cables.verd) c.hide();
      g.freeIsland(0, 1, true);
      for (let i = 0; i < 4; i++) g.slackHeart(i, true);
      g.alarm = 0.12;
      g.setTime(372, 80);
    },
    *script(g) {
      const ui = g.ui, D = g.sites.dock;
      yield 1.2;
      ui.card('Chapter IV', 'The Square', 'Slowly, now', 5.5);
      yield 4.5;
      g.markers.push({ pos: D.pos, label: 'Lamp square' });
      g.objective('Set the Long Gallery down in the lamp square');
      g.say(V, 'No Tenders. It has stopped fighting. I am not sure it ever understood that it was.');
      yield () => g.ship.pos.distanceTo(D.pos) < 520;
      ui.hint(g.input.mode === 'pad' ? 'Hold B to slow for the landing' : g.input.mode === 'touch' ? 'Ease in: she lands herself when you are close and slow' : `Hold ${K('Ctrl')} or ${K('C')} to slow. She settles herself when you are close.`, 10);
      yield () => g.ship.pos.distanceTo(D.pos) < 150 && g.ship.speed < 46;
      g.markers.length = 0;
      g.dock();
      yield () => g.docked;
      g.objective('The lamp square');
      g.say(V, 'Lamps. All this time, and it still keeps the lamps lit.');
      g.say(W, 'The white spire in front of you is a bell, Idris. Twenty plates made a chord, and the city heard its own name for the first time in an age.');
      g.say(W, 'It has been hauling its garden home ever since. Nobody ever told it that it could stop.');
      g.say(V, 'Then let us tell it. Ring the Bell.');
      yield g.talkDone;
      g.objective('Ring the Bell');
      g.combat.bellT = 0; g.awaitBell = true;
      ui.hint(g.input.mode === 'pad' ? 'X rings the Bell' : g.input.mode === 'touch' ? 'Press Bell' : `${K('Right click')} or ${K('E')}`, 60);
      yield () => g.bellRung;
      ui.hint('', 0.01); g.objective('');
      g.finale();
      yield 6; g.say(W, 'Oh. Oh, listen to that.');
      yield 7; g.say(V, 'Every window. Halloway, it has lit every window.');
      yield 9; g.say(W, 'It is not hauling any more. It is only holding on. The way you hold a kite.');
      yield 9; g.say(V, 'Enter it in the log. The Tall City, Meridian plate twenty one. Found by listening.');
      yield g.talkDone; yield 5;
      g.finish();
    },
  },
];

export const FREE = {
  numeral: '', title: 'Free flight', sub: 'After the Bell', time: 20,
  setup(g) {
    const d = g.dirCity, C = g.city.centre;
    g.ship.place(v3(C.x - d.x * 1500, 380, C.z - d.z * 1500), Math.atan2(d.x, d.z));
    for (const c of g.cables.verd) c.hide();
    g.freeIsland(0, 1, true);
    for (let i = 0; i < 4; i++) g.slackHeart(i, true);
    g.alarm = 0; U.uCityGlow.value = 1; g.landmarks && (g.landmarks.chordTarget = 1);
    if (g.bell) { g.bell.goal = 1; g.bell.lit = 1; }
    g.freeTime = true;
  },
  *script(g) { yield 1; g.objective('The Driftlands are yours'); g.ui.card('', 'Free flight', 'The lances still work, if you miss them', 5); yield 1e9; },
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
