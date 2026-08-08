/* The play/pause/step control around lib/dsa-anim.js.

   Mounted, not rendered inline: renderMarkdown returns a string, so an answer
   carries only a placeholder <div data-dsa="pattern-id"> and this fills it once
   the card is in the DOM. That also means the language toggle, which replaces
   .answer-body wholesale, can re-mount by calling mountDsaPlayers again.

   Interface text is English like the rest of the chrome (CLAUDE.md); the step
   captions come from the animation data and follow the content language. */
import { renderFrame, frameExtent, DEFAULT_STEP_MS, MIN_STEP_MS, MAX_STEP_MS } from '../lib/dsa-anim.js';
import { fetchJson, localizedRecord } from '../lib/i18n.js';
import { Content } from '../lib/content.js';

const DATA_URL = 'data/dsa-animations.json';
let cache = null;
let loadPromise = null;

/* One player instance per placeholder; kept so a re-mount can stop its timer
   instead of leaving an interval running against a detached node. */
const live = new WeakMap();

const SPEEDS = [
  { label: '0.5×', ms: Math.min(MAX_STEP_MS, DEFAULT_STEP_MS * 2) },
  { label: '1×', ms: DEFAULT_STEP_MS },
  { label: '2×', ms: Math.max(MIN_STEP_MS, Math.round(DEFAULT_STEP_MS / 2)) }
];

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

async function loadAnimations() {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = fetchJson(DATA_URL)
      .then(d => { cache = d; return d; })
      .catch(e => { loadPromise = null; throw e; });
  }
  return loadPromise;
}

const ICON = {
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  pause: '<path d="M9 5.5h3.2v13H9zM15.8 5.5H19v13h-3.2z"/>',
  prev: '<path d="M15.5 6v12L7 12zM17.5 6h1.6v12h-1.6z"/>',
  next: '<path d="M8.5 6v12L17 12zM5 6h1.6v12H5z"/>',
  replay: '<path d="M12 6a6 6 0 1 1-5.6 8.2" fill="none" stroke="currentColor" stroke-width="1.9"/>'
    + '<path d="M12 3.2v5.2l4-2.6z"/>'
};
const btnIcon = (name) => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
  + ICON[name] + '</svg>';

function shell(anim, frames) {
  const speedBtns = SPEEDS.map((s, i) =>
    '<button type="button" class="da-speed' + (i === 1 ? ' on' : '') + '" data-ms="' + s.ms + '">'
    + s.label + '</button>').join('');
  return '<figure class="da" data-dsa-ready="1">'
    + '<div class="da-stage">'
    + '<svg class="da-svg" role="img" aria-live="polite" aria-atomic="true"></svg>'
    + '</div>'
    + '<div class="da-bar">'
    + '<button type="button" class="da-btn da-play" aria-label="Play the animation">'
    + btnIcon('play') + '</button>'
    + '<button type="button" class="da-btn da-prev" aria-label="Previous step">' + btnIcon('prev') + '</button>'
    + '<button type="button" class="da-btn da-next" aria-label="Next step">' + btnIcon('next') + '</button>'
    + '<input class="da-scrub" type="range" min="0" max="' + (frames.length - 1) + '" value="0" step="1"'
    + ' aria-label="Step through the animation">'
    + '<span class="da-count"><b class="da-i">1</b>/<span class="da-n">' + frames.length + '</span></span>'
    + '<span class="da-speeds" role="group" aria-label="Playback speed">' + speedBtns + '</span>'
    + '</div>'
    + '<figcaption class="da-note-box"><span class="da-note-text"></span></figcaption>'
    + '</figure>';
}

function attach(host, anim, frames) {
  const extent = frameExtent(frames);
  host.innerHTML = shell(anim, frames);

  const svg = host.querySelector('.da-svg');
  const playBtn = host.querySelector('.da-play');
  const scrub = host.querySelector('.da-scrub');
  const iEl = host.querySelector('.da-i');
  const noteEl = host.querySelector('.da-note-text');
  svg.setAttribute('viewBox', '0 0 ' + extent.w + ' ' + extent.h);

  const state = { i: 0, timer: null, ms: DEFAULT_STEP_MS };

  const paint = () => {
    const f = frames[state.i];
    svg.innerHTML = renderFrame(f);
    // The caption is the accessible name: a screen reader hears the step, not
    // a description of the drawing.
    svg.setAttribute('aria-label', 'Step ' + (state.i + 1) + ' of ' + frames.length
      + '. ' + (f.note || ''));
    noteEl.textContent = f.note || '';
    scrub.value = String(state.i);
    iEl.textContent = String(state.i + 1);
    host.classList.toggle('at-end', state.i === frames.length - 1);
  };

  const stop = () => {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    playBtn.innerHTML = btnIcon(state.i === frames.length - 1 ? 'replay' : 'play');
    playBtn.setAttribute('aria-label', state.i === frames.length - 1
      ? 'Replay the animation' : 'Play the animation');
    playBtn.classList.remove('on');
  };

  const play = () => {
    if (state.timer) return;
    if (state.i === frames.length - 1) state.i = 0;   // replay from the top
    paint();
    playBtn.innerHTML = btnIcon('pause');
    playBtn.setAttribute('aria-label', 'Pause the animation');
    playBtn.classList.add('on');
    state.timer = setInterval(() => {
      if (state.i >= frames.length - 1) { stop(); return; }
      state.i++;
      paint();
    }, state.ms);
  };

  const go = (i) => {
    stop();
    state.i = Math.max(0, Math.min(frames.length - 1, i));
    paint();
  };

  playBtn.addEventListener('click', () => (state.timer ? stop() : play()));
  host.querySelector('.da-prev').addEventListener('click', () => go(state.i - 1));
  host.querySelector('.da-next').addEventListener('click', () => go(state.i + 1));
  scrub.addEventListener('input', () => go(Number(scrub.value)));

  host.querySelectorAll('.da-speed').forEach(b => {
    b.addEventListener('click', () => {
      state.ms = Number(b.dataset.ms) || DEFAULT_STEP_MS;
      host.querySelectorAll('.da-speed').forEach(o => o.classList.toggle('on', o === b));
      if (state.timer) { stop(); play(); }   // apply immediately while playing
    });
  });

  // Arrow keys step when the focus is inside the figure. The scrub input
  // handles its own arrows, so let that through rather than double-stepping.
  host.addEventListener('keydown', (e) => {
    if (e.target === scrub) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(state.i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(state.i - 1); }
  });

  // A card can be collapsed or the language flipped while playing; either way
  // the interval must not outlive the node.
  live.set(host, { stop });
  paint();
  stop();
  return { stop };
}

/* Fill every [data-dsa] under `root`. Safe to call repeatedly.
   `lang` overrides the global content language, because a question card has its
   own EN/VI switch that flips one card without touching Content.lang. */
export async function mountDsaPlayers(root, lang) {
  const scope = root || document;
  const hosts = [...scope.querySelectorAll('[data-dsa]')];
  if (!hosts.length) return;

  // Stop players being replaced before their nodes are dropped.
  for (const h of hosts) live.get(h)?.stop?.();

  let data;
  try {
    data = await loadAnimations();
  } catch (e) {
    for (const h of hosts) {
      h.innerHTML = '<p class="da-error">This animation could not be loaded.</p>';
    }
    return;
  }

  const active = lang || Content.lang;
  for (const host of hosts) {
    const anim = (data.animations || {})[host.dataset.dsa];
    if (!anim) { host.innerHTML = '<p class="da-error">Unknown animation.</p>'; continue; }
    // Frames are shared; only the captions differ, so a translation cannot
    // drift out of step with the drawing.
    const notes = localizedRecord(anim, active).notes || {};
    const frames = (anim.frames || []).map((f, i) => ({
      ...f,
      note: notes[i] != null ? notes[i] : f.note
    }));
    if (!frames.length) { host.innerHTML = '<p class="da-error">This animation has no steps.</p>'; continue; }
    attach(host, anim, frames);
    if (prefersReducedMotion()) host.classList.add('da-static');
  }
}

/** Stop every player under `root` — called before a view is torn down. */
export function stopDsaPlayers(root) {
  for (const h of (root || document).querySelectorAll('[data-dsa]')) live.get(h)?.stop?.();
}
