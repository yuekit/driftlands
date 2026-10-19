// Convergences: the progression spine. Finishing the survey of two neighbouring islands lets a current carry
// one into the other (b drifts into a); the fused seam breeds a hybrid species.
import { SPECIES } from './creatures.js';

export const CONVERGENCES = [
  {
    key: 'ochre', a: 'verdigris', b: 'ochre', hybrid: 'hybrid', dur: 52,
    begin: 'The Ochre Table has caught a current and is drifting toward Verdigris Reach.',
    met: ['The islands have met', 'Something new is walking where the rock fused. Go and see.'],
    history: 'appeared only after the Ochre Table drifted into Verdigris Reach and the two islands fused',
  },
  {
    key: 'kiln', a: 'glasswing', b: 'ember', hybrid: 'kiln', dur: 90,
    begin: 'The Ember Caldera has broken loose and is drifting north-east toward the Glasswing Spires.',
    met: ['Fire has met glass', 'Something is moving on the seam where the caldera fused with the spires.'],
    history: 'appeared after the Ember Caldera drifted into the Glasswing Spires and the hot rock fused with the glass',
  },
  {
    key: 'rootwater', a: 'rootfall', b: 'mire', hybrid: 'bell', dur: 90,
    begin: 'Mirewater Shoal is drifting north toward Rootfall Hollow, its lake slopping over the edge.',
    met: ['The lake has reached the roots', 'Water is dripping through the roots where the islands met. Look underneath.'],
    history: 'appeared after Mirewater Shoal drifted into Rootfall Hollow and lake water seeped down through the roots',
  },
  {
    key: 'gale', a: 'rootfall', b: 'windgate', hybrid: 'rootwing', dur: 90,
    begin: 'Windgate has caught a strong current and is drifting west toward Rootfall Hollow.',
    met: ['The ring has met the roots', 'Something has started flying beneath the seam. Fly under the islands.'],
    history: 'appeared after Windgate drifted into Rootfall Hollow, and learned to fly between the hanging roots',
  },
];

// is this convergence ready to start? The first comes early; the rest once both islands are fully recorded
export function convergenceReady(cv, islands, recorded) {
  if (cv.key === 'ochre') return Object.keys(recorded).length >= 4;
  const idx = [cv.a, cv.b].map((k) => islands.findIndex((I) => I.spec.key === k));
  const native = SPECIES.filter((s) => idx.includes(s.island));
  return native.length > 0 && native.every((s) => recorded[s.id]);
}

export const convergenceFor = (speciesId) => CONVERGENCES.find((c) => c.hybrid === speciesId);
