// The robot pilot shared by play.cjs (whole chapters, no picture) and shoot.cjs (action stills).
// It steers at the nearest enemy or marker, keeps off the walls, leads its shots and rings the Bell in a crowd.
module.exports = `window.__installBot = function (g, GOD) {
    const V3 = g.ship.pos.constructor, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const bot = { away: 0, kills: 0, shots: 0, minHull: 100, crashes: 0 };
    const tmp = new V3(), tmp2 = new V3();
    g.input.read = (dt) => {
      const o = { x: 0, y: 0, fire: false, bell: false, boost: false, brake: false, pause: false, aimX: 0, aimY: 0, lookX: 0, lookY: 0, any: false, confirm: false, back: false, navX: 0, navY: 0 };
      if (g.state !== 'play') return o;
      const s = g.ship; bot.minHull = Math.min(bot.minHull, s.hull);
      if (GOD) s.hull = s.maxHull;
      if (g.awaitBell) { o.bell = true; return o; }
      let goal = null, best = null, bd = 1e9;
      for (const e of g.combat.refresh()) { const d = e.pos.distanceTo(s.pos) * (e.kind === 'drone' ? 1 : e.kind === 'turret' ? 1.4 : 0.7); if (d < bd) { bd = d; best = e; } }
      if (best) goal = best.pos; else if (g.markers.length) goal = g.markers[0].pos;
      if (!goal) goal = tmp2.copy(s.pos).addScaledVector(s.fwd, 300).setY(Math.max(200, Math.min(520, s.pos.y))).clone();
      tmp.copy(goal).sub(s.pos); const dist = tmp.length();
      let wantYaw = Math.atan2(tmp.x, tmp.z), wantPitch = Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z));
      if (best && best.kind !== 'drone' && dist < 170 && bot.away <= 0) bot.away = 5;
      if (bot.away > 0) { bot.away -= dt; if (bot.away > 1.5) { wantYaw += 2.4; wantPitch = 0.15; } }
      // keep off the walls
      let near = 1e9;
      for (const m of [60, 120]) {
        tmp2.copy(s.pos).addScaledVector(s.fwd, m); tmp2.y += 8;
        const d = g.col.sdf(tmp2.x, tmp2.y, tmp2.z); near = Math.min(near, d);
        if (d < 50) { const gr = g.col.grad(tmp2.x, tmp2.y, tmp2.z), k = (50 - d) / 50 * 2.2; const fx = Math.sin(wantYaw) + gr.x * k, fz = Math.cos(wantYaw) + gr.z * k; wantYaw = Math.atan2(fx, fz); wantPitch += gr.y * k * 0.5; }
      }
      let dy = wantYaw - s.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      o.x = clamp(-dy * 1.6, -1, 1); o.y = clamp((wantPitch / 0.62 - 0) , -1, 1);
      o.boost = !best && dist > 500 && near > 80 && !g.markers.some((m) => m.label === 'Lamp square');
      o.brake = (g.markers.some((m) => m.label === 'Lamp square') && dist < 420) || near < 30;
      // aim: put the ring on the target if it is on screen
      if (best) {
        const lead = g.combat.lead(best, s.pos, 540, tmp2).clone().project(g.camera), asp = g.camera.aspect;
        if (lead.z < 1 && Math.abs(lead.x) < 0.95 && Math.abs(lead.y) < 0.95) {
          o.aimX = lead.x * asp; o.aimY = lead.y; const l = Math.hypot(o.aimX, o.aimY); if (l > 0.95) { o.aimX *= 0.95 / l; o.aimY *= 0.95 / l; }
          o.fire = dist < 600; if (o.fire) bot.shots++;
        }
        if (g.combat.bellT <= 0 && g.combat.drones.filter((d) => d.alive && d.pos.distanceTo(s.pos) < 190).length >= 2) o.bell = true;
      }
      return o;
    };
    return bot;
};`;
