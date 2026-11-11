// Generates src/title.html (title screen markup) from the art definitions below. Run: node tools/gen-title.cjs
const fs = require('fs'), path = require('path');
const word = JSON.parse(fs.readFileSync(path.join(__dirname, 'wordmark.json'), 'utf8'));
const INK = '#4B2E3A';
const BODY = 'M236 330H420C520 330 588 400 588 492C588 590 520 667 430 667H236Z';
const COUNTER = 'M313 400H410C465 400 500 440 500 492C500 548 465 585 410 585H313Z';
const EXTR = 'M236 667L251 684H445C535 684 603 607 603 509C603 417 535 347 435 347H251Z';
const HOLE2 = 'M328 417H425C480 417 515 457 515 509C515 565 480 602 425 602H328Z';
const wave = (y, a) => `M210 ${y}q50 ${a} 100 0t100 0t100 0t100 0t100 0`;
const band = (y, a, fill) => `<path d="${wave(y, a)}V720H210Z" fill="${fill}"/>`;
const stripe = (y, a, h, fill) => `<path d="${wave(y, a)}v${h}q-50 ${a} -100 0t-100 0t-100 0t-100 0t-100 0Z" fill="${fill}"/>`;
const strata = `<rect x="210" y="300" width="420" height="420" fill="#F3CDA9"/>${stripe(358, -6, 8, '#EABB93')}${band(387, 7, '#D9805F')}${band(437, -7, '#EFB998')}${stripe(470, 6, 7, '#E6A683')}${band(512, 7, '#B5593C')}${band(558, -6, '#E59A73')}${stripe(590, 6, 7, '#D98964')}${band(623, 6, '#9C4830')}`;
const VB = '170 176 480 654';
const svg = (cls, inner) => `<svg class="${cls}" viewBox="${VB}" aria-hidden="true" focusable="false">${inner}</svg>`;

const back = svg('ts-i-back', `
<g class="ts-pop" style="--d:.34s"><g class="ts-sway" style="--d:-1.2s"><path d="M349 324C349.6 315 350.4 308 351 301h5C356.6 308 357.4 315 358 324Z" fill="#F7E9D4" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/><path d="M339 303Q345 290 353.5 290Q362 290 368 303Q353.5 307 339 303Z" fill="#EE8C7C" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/><circle cx="349" cy="297" r="1.9" fill="#FBEFE3"/><circle cx="358" cy="299" r="1.6" fill="#FBEFE3"/></g></g>
<g class="ts-pop" style="--d:0s"><g class="ts-sway">
<path d="M313 324C315.5 294 318 266 319 240H331C332 266 334.5 294 337 324Z" fill="#F7E9D4" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round"/><path d="M327 244C328 268 330.5 296 333 322h2.6C333 294 330.6 268 329.6 244Z" fill="#DCC6BC"/>
<path d="M259 242Q287 203 325 203Q363 203 391 242Q325 254 259 242Z" fill="#EE8C7C" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round"/><path d="M262.5 241.6Q325 252 387.5 241.6Q381 232 374 225Q326 243 268 234Z" fill="#DC7265"/>
<g fill="#FBEFE3"><ellipse cx="302" cy="220" rx="7.5" ry="6.8"/><ellipse cx="337" cy="208" rx="6.4" ry="5.4"/><ellipse cx="360" cy="226" rx="5.6" ry="5"/><circle cx="283" cy="231" r="3.2"/><circle cx="322" cy="226" r="2.8"/></g></g></g>
<g class="ts-pop" style="--d:.18s"><g class="ts-sway" style="--d:-2.6s"><path d="M500.5 340C501 322 502.6 307 503.4 294H510.6C511.4 307 512.4 322 513.5 340Z" fill="#F7E9D4" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M475 295Q488 273 507 273Q526 273 539 295Q507 302 475 295Z" fill="#7CC6BF" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M477.5 294.6Q507 300.4 536.5 294.6Q533 288.6 529 284.4Q507 293.4 480 290.2Z" fill="#5FAFA9"/></g></g>
<g class="ts-spores" fill="#FBEFE3">${[[300, 200, 0], [322, 192, 1.7], [346, 197, 3.1], [362, 208, 4.6], [284, 212, 5.8]].map(([x, y, d]) => `<circle class="ts-spore" style="--d:${-d}s" cx="${x}" cy="${y}" r="2.3"/>`).join('')}</g>
<g class="ts-pop ts-rock" style="--d:.5s"><g class="ts-rbob"><path d="M183 556h30q2 9 -5 17q-6 7 -9 15q-4 -9 -10 -15q-8 -8 -6 -17Z" fill="#E59A73" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/><path d="M184.4 565.5h27.6q-1.8 4.4 -4.4 7.6h-18.4q-3.4 -3.6 -4.8 -7.6Z" fill="#B5593C"/><path d="M182 555.5h32" stroke="${INK}" stroke-width="8.6" stroke-linecap="round"/><path d="M182 555.5h32" stroke="#7DA36C" stroke-width="4.2" stroke-linecap="round"/></g></g>
<g class="ts-pop ts-rock" style="--d:.62s"><g class="ts-rbob" style="--d:-3s"><path d="M616 612h20q1 7 -4 12q-4 5 -6 10q-3 -6 -7 -10q-5 -6 -3 -12Z" fill="#EFB998" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/><path d="M615 611.5h22" stroke="${INK}" stroke-width="7.6" stroke-linecap="round"/><path d="M615 611.5h22" stroke="#7DA36C" stroke-width="3.6" stroke-linecap="round"/></g></g>`);

const GRASS = 'M232 318H420C505 318 560 365 570 405';
const mid = svg('ts-i-mid', `<defs>
<clipPath id="ts-c-body"><path clip-rule="evenodd" d="${BODY}${COUNTER}"/></clipPath><clipPath id="ts-c-extr"><path clip-rule="evenodd" d="${EXTR}${HOLE2}"/></clipPath><clipPath id="ts-c-hole"><path d="${COUNTER}"/></clipPath>
<mask id="ts-m-wall" maskUnits="userSpaceOnUse" x="300" y="390" width="220" height="210"><path d="${COUNTER}" fill="#fff"/><path d="${COUNTER}" transform="translate(15 17)" fill="#000"/></mask>
<pattern id="ts-hatch" width="46" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)"><path d="M0 4H29M37 4H46M0 12H9M18 12H46" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/></pattern>
<g id="ts-strata">${strata}</g></defs>
<path fill-rule="evenodd" d="${EXTR}${HOLE2}" fill="#803C37" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round"/>
<g clip-path="url(#ts-c-extr)"><use href="#ts-strata" transform="translate(8 9)"/><path d="${EXTR}" fill="#3E2147" opacity=".34"/><path d="${EXTR}" fill="url(#ts-hatch)" opacity=".5"/></g>
<g mask="url(#ts-m-wall)"><use href="#ts-strata" transform="translate(8 9)"/><rect x="300" y="390" width="220" height="210" fill="#3E2147" opacity=".34"/><rect x="300" y="390" width="220" height="210" fill="url(#ts-hatch)" opacity=".5"/></g>
<path d="${COUNTER}" transform="translate(15 17)" clip-path="url(#ts-c-hole)" fill="none" stroke="${INK}" stroke-width="2.4"/>
<g clip-path="url(#ts-c-body)"><use href="#ts-strata"/></g>
<path fill-rule="evenodd" d="${BODY}${COUNTER}" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round"/>
<path d="M252 312l3.5 -13l4.5 12M286 311l5 -16l4 15M392 311l3 -12l5 11M446 315l6 -13l2 15M276 311l2 -8l4 7" fill="#7DA36C" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
<path d="${GRASS}" fill="none" stroke="${INK}" stroke-width="30.8" stroke-linecap="round"/>
<path d="M246 324q7 22 15 0M283 324q5 14 11 0M338 324q8 25 17 0M371 324q5 13 11 0M405 325q7 19 15 1M449 329q9 20 14 5M487 340q8 19 13 7M522 362q9 15 11 7" fill="#7DA36C" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>
<path d="${GRASS}" fill="none" stroke="#7DA36C" stroke-width="24" stroke-linecap="round"/>
<path d="M236 324.5H420C499 324.5 551 368 563 404" fill="none" stroke="#688F5E" stroke-width="5.5" stroke-linecap="round"/>
<path d="M238 312H420C488 312 536 342 556 376" fill="none" stroke="#9DC188" stroke-width="5" stroke-linecap="round"/>`);

const root = (d, shade, dd, sd) => `<g class="ts-drip" style="--d:${dd}s"><g class="ts-rsway" style="--d:${sd}s"><path d="${d}" fill="url(#ts-g-root)"/><path d="${shade}" fill="#803C37"/><path d="${d}" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/></g></g>`;
const front = svg('ts-i-front', `<defs><linearGradient id="ts-g-root" gradientUnits="userSpaceOnUse" x1="0" y1="672" x2="0" y2="712"><stop offset="0" stop-color="#803C37"/><stop offset="1" stop-color="#9C4830"/></linearGradient></defs>
<g class="ts-drip" style="--d:.5s" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"><path d="M346 682q5 20 -1 40"/><path d="M419 683q-4 16 2 30"/><path d="M262 682q-3 12 2 22"/><path d="M524 664q4 14 -2 26"/></g>
${root('M279 676C283 716 303 752 300 803C312 762 320 716 331 676', 'M331 676C320 716 312 762 300 803C306 760 310 714 314 676Z', 0.1, 0)}
${root('M361 678C364 704 378 728 379 753C385 730 390 704 397 678', 'M397 678C390 704 385 730 379 753C381 728 382 702 384 678Z', 0.26, -1.4)}
${root('M442 681C446 710 466 740 463 771C474 744 486 708 497 672', 'M497 672C486 708 474 744 463 771C469 740 474 708 478 676Z', 0.18, -2.7)}
<g class="ts-drops">${[[300, 809, 0], [379, 759, -1.9], [463, 777, -3.6]].map(([x, y, d]) => `<path class="ts-drop" style="--d:${d}s" d="M${x} ${y - 6}q4.4 5.4 4.4 8.4a4.4 4.4 0 0 1 -8.8 0q0 -3 4.4 -8.4Z" fill="#D8EEF0" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>`).join('')}</g>`);

const [x1, y1, x2, y2] = word.box;
const wordSvg = `<svg viewBox="${x1 - 2} ${y1 - 3} ${(x2 - x1 + 4).toFixed(1)} ${(y2 - y1 + 6).toFixed(1)}" aria-hidden="true" focusable="false">${word.letters.map((l, i) => `<path class="ts-l" style="--i:${i}" d="${l.d}"/>`).join('')}</svg>`;
const wordSym = `<symbol id="dl-word" viewBox="${x1 - 2} ${y1 - 3} ${(x2 - x1 + 4).toFixed(1)} ${(y2 - y1 + 6).toFixed(1)}"><path d="${word.letters.map((l) => l.d).join('')}"/></symbol>`;

const planet = `<svg class="ts-planet ts-par" style="--z:.18" viewBox="-190 -120 380 240" aria-hidden="true" focusable="false"><defs><clipPath id="ts-c-pl"><circle r="62"/></clipPath></defs>
<g transform="rotate(-17)"><g fill="none" stroke="#F6EEE8"><path d="M-152 0A152 35 0 0 1 152 0" stroke-width="3.2" opacity=".85"/><path d="M-130 0A130 29 0 0 1 130 0" stroke-width="2" opacity=".7"/><path d="M-112 0A112 24 0 0 1 112 0" stroke-width="1.4" opacity=".6"/></g>
<circle r="62" fill="#F5ECE8"/><g clip-path="url(#ts-c-pl)"><path d="M-70 -38h140v9h-140zM-70 -14h140v5h-140zM-70 8h140v12h-140zM-70 34h140v6h-140z" fill="#EADBDD"/><path d="M14 -70A70 70 0 0 1 14 70A120 120 0 0 0 14 -70Z" transform="translate(22 0)" fill="#C7B9DD" opacity=".6"/></g>
<g fill="none" stroke="#F6EEE8"><path d="M-152 0A152 35 0 0 0 152 0" stroke-width="3.2" opacity=".95"/><path d="M-130 0A130 29 0 0 0 130 0" stroke-width="2" opacity=".8"/><path d="M-112 0A112 24 0 0 0 112 0" stroke-width="1.4" opacity=".7"/></g></g>
<circle cx="-146" cy="-74" r="7" fill="#F5ECE8"/><circle cx="128" cy="84" r="4" fill="#F5ECE8" opacity=".85"/></svg>`;

const glider = `<div class="ts-glider"><div><svg viewBox="0 0 120 56" aria-hidden="true" focusable="false"><path d="M58 33q-12 -5 -22 1t-20 -1" fill="none" stroke="#D9805F" stroke-width="2.6" stroke-linecap="round"/><path d="M4 30L64 12L116 24L66 23Z" fill="#4A3B5C"/><path d="M40 19.2l9.6 4.5 8 -.3L47 17.1ZM84 16.6l5 6.6 8.5 .1L91 18.2Z" fill="#F6EEE8" opacity=".85"/><path d="M62 22l-3 10M68 22l2 10" stroke="#4A3B5C" stroke-width="1.4"/><ellipse cx="64" cy="34" rx="10" ry="3.6" fill="#4A3B5C"/></svg></div></div>`;

const far = (cls, z) => `<div class="ts-far ${cls} ts-par" style="--z:${z}"><svg aria-hidden="true" focusable="false"><use href="#dl-mark"/></svg></div>`;
const out = `<!-- Title, loading and intro screen. Generated by tools/gen-title.cjs: edit the generator, not this file. -->
  <div class="layer" id="title">
    <div class="ts-stars" aria-hidden="true">${[[8, 9, 0], [19, 22, 1.2], [31, 6, 2.1], [44, 15, .6], [57, 8, 2.8], [66, 24, 1.7], [88, 7, .3], [94, 28, 2.4], [12, 34, 3.2], [73, 4, 1]].map(([x, y, d]) => `<i style="left:${x}%;top:${y}%;--d:${-d}s"></i>`).join('')}</div>
    ${planet}
    <div class="ts-lent ts-lent-a ts-par" style="--z:.3" aria-hidden="true"><i></i></div>
    <div class="ts-lent ts-lent-b ts-par" style="--z:.36" aria-hidden="true"><i></i></div>
    ${far('ts-far-a', 0.5)}
    ${far('ts-far-b', 0.44)}
    ${far('ts-far-c', 0.34)}
    ${glider}
    <div class="ts-cl ts-cl-back ts-par" style="--z:.55" aria-hidden="true"><i></i></div>
    <div class="ts-stage">
      <div class="ts-isle ts-par" style="--z:.8" role="img" aria-label="A floating island in the shape of the letter D, with a grass top, mushrooms and hanging roots"><div class="ts-rise"><div class="ts-pose"><div class="ts-bob">
${back}
${mid}
${front}
      </div></div></div></div>
      <div class="ts-text">
        <h1 class="ts-word" aria-label="Driftlands">${wordSvg}</h1>
        <p class="ts-tag">A gliding naturalist game</p>
        <nav class="ts-menu" id="t-menu" aria-label="Main menu"></nav>
      </div>
    </div>
    <div class="ts-cl ts-cl-mid ts-par" style="--z:1.15" aria-hidden="true"><i></i></div>
    <div class="ts-cl ts-cl-front ts-par" style="--z:1.5" aria-hidden="true"><i></i></div>
    <div class="ts-grain" aria-hidden="true"></div>
    <div class="ts-status" id="t-load" role="status"><span id="t-load-text">Raising the islands</span></div>
    <div class="ts-foot" id="t-foot" aria-hidden="true">
      <span class="for-keys">Mouse or <b id="k-fly">W A S D</b> to fly<i></i><b id="k-lens">Space</b> raises the lens<i></i><b id="k-journal">J</b> opens the journal<i></i><b>Esc</b> pauses</span>
      <span class="for-touch">Drag to steer<i></i>Hold the lens button to study<i></i>Tap to photograph</span>
      <span class="for-pad">Left stick flies<i></i>LT raises the lens<i></i>A takes a photo<i></i>Y opens the journal</span>
    </div>
  </div>
`;
fs.writeFileSync(path.join(__dirname, '..', 'src', 'title.html'), out);
fs.writeFileSync(path.join(__dirname, '..', 'src', 'wordmark-symbol.html'), wordSym + '\n');
console.log('title.html', out.length, 'bytes');
