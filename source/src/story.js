// The light story: letters from the Institute that arrive as the survey grows, and pages of the previous
// surveyor's notebook, found under cairns beside four of the listening posts.
import { SPECIES } from './creatures.js';
import { CONVERGENCES } from './convergence.js';

export const LETTERS = [
  {
    id: 'commission', kind: 'letter', title: 'Letter of commission', from: 'The Meridian Institute',
    when: () => true,
    body: [
      'Surveyor,',
      'The Institute has no plates from above the cloud sea. We have one notebook, half of it rained on, from the surveyor we sent before you. It describes eight islands and animals that should not be able to stand up. Then it stops.',
      'Your commission is simple. Fly out. Find what lives on each island and bring it back as a plate in your journal. Twenty kinds, if the notebook is right.',
      'One more thing. Your predecessor raised a listening post on every island. We never learned what they were listening for. If you find any loose pages, read them before I do.',
    ],
    sign: 'Idris Vane, Keeper of Plates',
  },
  {
    id: 'page1', kind: 'page', camp: 'verdigris', title: 'Notebook page, day 9', from: 'Found under a cairn on Verdigris',
    body: [
      'Verdigris is not where I left it.',
      'I staked my camp to the plateau and paced it out to the arch last night: two hundred steps. This morning, two hundred steps again. So the island has not changed. But the bearing to the Ochre Shelf has, by a finger\'s width against the ringed moon.',
      'The islands are not drifting on the wind. Wind does not hold a heading for nine days.',
      'I am going to build something to listen with.',
    ],
    sign: 'W. H.',
  },
  {
    id: 'page2', kind: 'page', camp: 'windgate', title: 'Notebook page, day 31', from: 'Found under a cairn at the Windgate',
    body: [
      'The posts work. Each island hums, low, under hearing, and each on its own note. I think it is the roots. They hang a long way down into the cloud, and the air moves through them like breath through a reed.',
      'Here is the part I did not expect. When I finish a plate, the post on that island grows louder. As if being looked at properly is something an island can feel.',
      'I know how that sounds. I am writing it down anyway.',
    ],
    sign: 'W. H.',
  },
  {
    id: 'drift', kind: 'letter', title: 'On the collision', from: 'The Meridian Institute',
    when: (j) => CONVERGENCES.some((c) => j.conv && j.conv[c.key]),
    body: [
      'Surveyor,',
      'Your last packet arrived with a note that two islands had met. The Board asked me whether you were well. I told them you were the second surveyor to report this, and that I had stopped being surprised.',
      'Here is what we believe. Each island is held up, and held together, by its roots, and the roots of one island can sense the roots of another. They reach. Slowly, across years, the islands pull themselves toward the neighbours whose life suits theirs.',
      'You seem to hurry them along. Keep the plates coming. I should like to see what grows on the seam.',
    ],
    sign: 'I. V.',
  },
  {
    id: 'page3', kind: 'page', camp: 'mire', title: 'Notebook page, day 58', from: 'Found under a cairn on the Mire',
    body: [
      'Two islands touched today, and by evening there was an animal on the seam I had never drawn. Legs from one island, back from the other. Not a visitor from either. A new thing.',
      'So that is what the reaching is for. An island alone keeps what it has. Two islands together make something neither could.',
      'I have stopped thinking of this as a survey of eight places. It is one place that has not finished arriving.',
    ],
    sign: 'W. H.',
  },
  {
    id: 'gallery', kind: 'letter', title: 'A request from the Board', from: 'The Meridian Institute',
    when: (j) => Object.keys(j.recorded).length >= 12,
    body: [
      'Surveyor,',
      'Twelve plates. The Board has hung them in the long gallery, and for the first time in my tenure people are queueing to get into a room full of natural history.',
      'They ask, with some urgency, what became of your predecessor. The last page we hold ends in the middle of a sentence. If the remaining camps have anything to say, I would count it a personal kindness.',
      'Also: the gallery guard reports that plates from neighbouring islands, hung side by side, are fading toward the same colours. I have told him it is the light.',
    ],
    sign: 'I. V.',
  },
  {
    id: 'page4', kind: 'page', camp: 'ember', title: 'Notebook page, the last', from: 'Found under a cairn on the Ember',
    body: [
      'I am out of plates and nearly out of ink, and I find I do not mind.',
      'The posts are all singing a little tonight. When every island has been properly seen, I think they will sing together, and the roots will know which way to reach. I will not be the one to finish it. Twenty kinds is more than one glider\'s season.',
      'Whoever reads this: I did not fall. I stayed. There is a warm ledge under Rootfall where the whales pass close.',
      'Finish the plates. Then listen.',
    ],
    sign: 'Wren Halloway',
  },
  {
    id: 'chord', kind: 'letter', title: 'The Chord', from: 'The Meridian Institute',
    when: (j) => Object.keys(j.recorded).length >= SPECIES.length,
    body: [
      'Surveyor,',
      'Twenty plates. The gallery is full and I have run out of wall.',
      'Last night every instrument in the Institute that can hum did so, at once, for a little under a minute. The glass in the plate room rang. I am told the same note was heard at sea.',
      'I think your islands have found each other. I think they will be a long time arriving, and that what stands there at the end will be one country, with twenty kinds of animal and more on the way.',
      'There is no further commission. The glider is yours. Fly as long as you like, and if you pass a warm ledge under Rootfall, give my regards.',
    ],
    sign: 'Idris Vane, Keeper of Plates',
  },
];
export const letterById = (id) => LETTERS.find((l) => l.id === id);
export const PAGES = LETTERS.filter((l) => l.kind === 'page');

export const CREDITS = [
  ['Driftlands', 'A naturalist\'s glider game'],
  ['Design and direction', 'Yue-Kit'],
  ['Code, art direction, creatures, world, sound and words', 'Claude'],
  ['Models sculpted in', 'Blender'],
  ['Drawn in the browser with', 'three.js and WebGL 2'],
  ['Typefaces', 'Bricolage Grotesque, Instrument Sans, Instrument Serif, IBM Plex Mono'],
  ['With thanks to', 'Everyone who flew the early builds'],
];
