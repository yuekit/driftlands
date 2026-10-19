// Golden views: fixed cameras and times of day used to judge every lighting change, and the benchmark flight.
// t = seconds into the day cycle (day 0-300, dusk 300-355, night 355-515, dawn 515-570).
export const GOLDEN = [
  { name: 'verdigris-day', p: [230, 205, -150], t: [0, 160, 0], fov: 55, time: 60 },
  { name: 'verdigris-arch', p: [70, 178, 85], t: [0, 158, 0], fov: 60, time: 120 },
  { name: 'ochre-sunface', p: [790, 270, -90], t: [560, 175, -330], fov: 50, time: 90 },
  { name: 'into-sun', p: [-180, 215, -260], t: [260, 250, 260], fov: 62, time: 200 },
  { name: 'coral-dusk', p: [-60, 185, 590], t: [-260, 150, 760], fov: 55, time: 318 },
  { name: 'verdigris-night', p: [230, 205, -150], t: [0, 160, 0], fov: 55, time: 420 },
  { name: 'cloud-sea', p: [120, 48, 120], t: [450, 20, 520], fov: 65, time: 150 },
  { name: 'stilt-close', creature: 'stilt', off: [18, 9, 14], fov: 50, time: 100 },
  { name: 'verdigris-pool', p: [-2, 162, 52], t: [-36, 146, 14], fov: 60, time: 140 },
  { name: 'night-glade', p: [60, 166, 40], t: [10, 150, 0], fov: 60, time: 430 },
  { name: 'under-verdigris', p: [150, 95, -170], t: [0, 120, 0], fov: 60, time: 150 },
  { name: 'windgate-ring', p: [360, 275, -690], t: [100, 225, -920], fov: 55, time: 120 },
  { name: 'glasswing-spires', p: [1410, 220, 530], t: [1160, 200, 330], fov: 55, time: 160 },
  { name: 'ember-dusk', p: [890, 270, 860], t: [640, 120, 1080], fov: 55, time: 322 },
  { name: 'ember-night', p: [890, 270, 860], t: [640, 120, 1080], fov: 55, time: 430 },
  { name: 'mire-lake', p: [-600, 210, -10], t: [-860, 110, 170], fov: 55, time: 110 },
  { name: 'under-rootfall', p: [-440, 70, -460], t: [-660, 110, -640], fov: 60, time: 140 },
  { name: 'glasswing-night', p: [1300, 190, 450], t: [1160, 180, 330], fov: 60, time: 440 },
  { name: 'fog-bank', p: [520, 270, -480], t: [0, 170, 0], fov: 55, time: 110, weather: { type: 'fog', s: -120, angle: 0 } },
  { name: 'rain-mire', p: [-600, 210, -10], t: [-860, 110, 170], fov: 55, time: 110, weather: { type: 'rain', s: 60, angle: 1.5708 } },
  { name: 'crosswind', p: [260, 240, -260], t: [0, 200, 0], fov: 60, time: 120, weather: { type: 'wind', s: 0, angle: 0.4 } },
];

// waypoints for the benchmark: a loop around all three islands, about 60 s at 1x
export const BENCH = [
  [260, 210, -40], [420, 230, -420], [700, 220, -260], [380, 200, 160], [-80, 190, 520],
  [-380, 210, 820], [-160, 200, 960], [-40, 205, 320], [180, 200, 60], [260, 210, -40],
];
