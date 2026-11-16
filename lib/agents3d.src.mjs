// 3D figures for the two tools on the board: a mage for Claude, a hooded rogue for Cursor.
// Models: KayKit Adventurers by Kay Lousberg, CC0 (public/board/agents/LICENSE.txt), cut down to the clips used here
// (the list is in scripts/prune-figures.mjs).
// Built into public/board/agents/agents3d.js by `npm run build-agents`; the board page loads it after first paint.
//
// The page re-renders its HTML often, so the canvases live here and are re-attached to the
// `<span class="bot" data-bot="claude|cursor">` placeholders on every sync(); the WebGL contexts survive.
//
// A figure has a base pose (a looping clip chosen from the card's state and the run's role) and, on top of it,
// short one-shot clips: a strike when the agent prints a new line, a reaction to a click, a fidget when idle.
// It runs into the card when it gets work and takes a lap after a finished run.
import {
  AnimationMixer, Box3, Clock, DirectionalLight, HemisphereLight, LoopOnce, LoopRepeat, PerspectiveCamera,
  Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const V = '2';
const COMMON = { queued: '2H_Melee_Idle', idle: 'Idle', off: 'Lie_Idle', cheer: 'Cheer', sad: 'Death_A', blocked: 'Blocking', limit: 'Sit_Floor_Idle' };
const FIGURES = {
  claude: {
    file: `/board/agents/mage.glb?v=${V}`,
    items: ['Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff'],
    hold: { default: ['2H_Staff'], 'working:qa': ['1H_Wand'], 'working:seo': ['Spellbook_open'], 'working:idea': ['Spellbook_open'], limit: [] },
    clips: { ...COMMON, working: 'Spellcasting', 'working:qa': '1H_Ranged_Aiming', 'working:seo': 'Sit_Floor_Idle', 'working:idea': 'Sit_Floor_Idle' },
    pulse: { default: 'Spellcast_Shoot', 'working:qa': '1H_Ranged_Shoot', 'working:seo': 'Use_Item', 'working:idea': 'Use_Item' },
  },
  cursor: {
    file: `/board/agents/rogue.glb?v=${V}`,
    items: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'],
    hold: { default: ['Knife', 'Knife_Offhand'], 'working:qa': ['2H_Crossbow'], 'working:seo': [], 'working:idea': [], limit: [] },
    clips: { ...COMMON, working: 'Dualwield_Melee_Attack_Chop', 'working:qa': '2H_Ranged_Aiming', 'working:seo': 'Interact', 'working:idea': 'Interact' },
    pulse: { default: 'Dualwield_Melee_Attack_Slice', 'working:qa': '2H_Ranged_Shoot', 'working:seo': 'Use_Item', 'working:idea': 'Use_Item' },
  },
};
const POKES = ['Hit_A', 'Dodge_Backward', 'Jump_Full_Short', 'Cheer'];
const FIDGETS = ['Use_Item', 'PickUp', 'Throw', 'sit', 'Interact'];
const SIZE = 132; // CSS px, square
const still = matchMedia('(prefers-reduced-motion: reduce)');
const figs = {};
let raf = 0;
const clock = new Clock();
const rand = (a, b) => a + Math.random() * (b - a);

function make(tool) {
  const cfg = FIGURES[tool];
  const canvas = document.createElement('canvas');
  canvas.className = 'bot3d';
  canvas.setAttribute('aria-hidden', 'true');
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0x8a8577, 2.2));
  const sun = new DirectionalLight(0xfff1dd, 2.4);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const camera = new PerspectiveCamera(30, 1, 0.1, 50);
  const fig = { tool, cfg, canvas, renderer, scene, camera, key: '', turn: 0, turnTo: 0, face: 0, moves: [], busy: null, clicks: [], nextFidget: 0, ready: false, dirty: true };
  new GLTFLoader().load(cfg.file, (gltf) => {
    const model = gltf.scene;
    scene.add(model);
    // Frame the standing figure once; lying and jumping clips stay inside the same frame.
    const box = new Box3().setFromObject(model);
    const h = box.max.y - box.min.y;
    fig.lookAt = new Vector3(0, h * 0.5, 0);
    fig.dist = h * 2.55;
    fig.edge = h * 1.3; // just outside the canvas, left or right
    fig.model = model;
    fig.parts = Object.fromEntries(cfg.items.map((n) => [n, model.getObjectByName(n)]));
    fig.mixer = new AnimationMixer(model);
    fig.actions = Object.fromEntries(gltf.animations.map((c) => [c.name, fig.mixer.clipAction(c)]));
    fig.mixer.addEventListener('finished', (e) => {
      if (!fig.busy || fig.busy.action !== e.action) return;
      const then = fig.busy.then;
      fig.busy = null;
      then ? then() : toBase(fig);
    });
    fig.ready = true;
    canvas.classList.add('on');
    const want = fig.key; fig.key = ''; setState(fig, want || 'idle', true);
    kick();
  }, undefined, () => { canvas.closest('.bot')?.classList.add('no3d'); });
  return fig;
}

const lookup = (map, key) => map[key] ?? map[key.split(':')[0]] ?? map.default;

/** Crossfade to a clip. */
function play(fig, name, { once = false, fade = 0.3 } = {}) {
  const next = fig.actions[name] || fig.actions.Idle;
  next.reset();
  next.setLoop(once ? LoopOnce : LoopRepeat, Infinity);
  next.clampWhenFinished = once;
  if (fig.current && fig.current !== next) next.crossFadeFrom(fig.current, fade, false);
  next.play();
  fig.current = next;
  fig.dirty = true;
  return next;
}
/** Back to the looping pose of the current state, with the hand items that pose uses. */
function toBase(fig) {
  const held = fig.cfg.hold[fig.key] ?? fig.cfg.hold[fig.key.split(':')[0]] ?? fig.cfg.hold.default;
  for (const [name, part] of Object.entries(fig.parts)) if (part) part.visible = held.includes(name);
  play(fig, lookup(fig.cfg.clips, fig.key) || 'Idle', { once: fig.key === 'sad' });
  fig.zoom = fig.key === 'off' ? 1.25 : 1;
  fig.nextFidget = performance.now() + rand(12000, 30000);
}
/** A short clip over the base pose; the base pose returns when it ends. False when one is already playing. */
function oneShot(fig, name, { force = false, then = null } = {}) {
  if (!fig.ready || still.matches || !fig.actions[name] || fig.moves.length || (fig.busy && !force)) return false;
  fig.busy = { action: play(fig, name, { once: true, fade: 0.15 }), then };
  kick();
  return true;
}
function run(fig, from, to, dur, clip) { fig.moves.push({ from, to, dur, clip, t: 0 }); }

function setState(fig, key, first = false) {
  if (fig.key === key) return;
  const prev = fig.key.split(':')[0];
  fig.key = key;
  if (!fig.ready) return;
  const now = key.split(':')[0];
  fig.busy = null;
  fig.moves = [];
  fig.model.position.x = 0;
  if (still.matches || first) {
    toBase(fig);
    if (still.matches) fig.mixer.update(now === 'sad' ? 5 : 0.6);
  } else if ((now === 'working' || now === 'queued') && ['idle', 'blocked', 'limit', 'off'].includes(prev)) {
    // Got work: runs into the card.
    toBase(fig); play(fig, 'Running_A', { fade: 0.1 });
    run(fig, -fig.edge, 0, 0.9, 'Running_A');
  } else if (now === 'idle' && prev === 'cheer') {
    // Celebration over: a lap out of the card and a walk back to its post.
    toBase(fig); play(fig, 'Running_A', { fade: 0.1 });
    run(fig, 0, fig.edge, 0.9, 'Running_A');
    run(fig, -fig.edge, 0, 1.7, 'Walking_A');
  } else toBase(fig);
  kick();
}

function step(fig, dt) {
  const now = performance.now();
  // movement across the card
  const m = fig.moves[0];
  if (m) {
    if (m.t === 0 && m.clip && fig.current !== fig.actions[m.clip]) play(fig, m.clip, { fade: 0.15 });
    m.t += dt;
    const k = Math.min(1, m.t / m.dur);
    fig.model.position.x = m.from + (m.to - m.from) * k;
    fig.rotTo = Math.sign(m.to - m.from) * Math.PI / 2 - 0.45;
    if (k >= 1) { fig.moves.shift(); if (!fig.moves.length) toBase(fig); }
  } else fig.rotTo = fig.face;
  fig.model.rotation.y += ((fig.rotTo || 0) - fig.model.rotation.y) * Math.min(1, dt * 10);
  // a pause in a chain of clips (sitting for a while)
  if (fig.busy?.until && now > fig.busy.until) { const then = fig.busy.then; fig.busy = null; then(); }
  // idle life
  if (fig.key === 'idle' && !fig.busy && !m && now > fig.nextFidget) {
    fig.nextFidget = now + rand(18000, 40000);
    const pick = FIDGETS[Math.floor(Math.random() * FIDGETS.length)];
    if (pick === 'sit') {
      oneShot(fig, 'Sit_Floor_Down', { then: () => {
        play(fig, 'Sit_Floor_Idle');
        fig.busy = { until: performance.now() + rand(5000, 9000), then: () => { fig.busy = null; oneShot(fig, 'Sit_Floor_StandUp'); } };
      } });
    } else oneShot(fig, pick);
  }
}

function draw(fig, dt) {
  if (!fig.ready) return;
  if (!still.matches) { step(fig, dt); fig.mixer.update(dt); }
  fig.turn += (fig.turnTo - fig.turn) * Math.min(1, dt * 8);
  const a = 0.45 + fig.turn;
  const d = fig.dist * (fig.zoom || 1);
  fig.camera.position.set(Math.sin(a) * d, fig.lookAt.y + d * 0.22, Math.cos(a) * d);
  fig.camera.lookAt(fig.lookAt);
  fig.renderer.render(fig.scene, fig.camera);
  fig.dirty = false;
}

function frame() {
  raf = 0;
  const dt = Math.min(clock.getDelta(), 0.1);
  let again = false;
  for (const fig of Object.values(figs)) {
    if (!fig.canvas.isConnected) continue;
    const turning = Math.abs(fig.turnTo - fig.turn) > 0.002;
    if (!still.matches || fig.dirty || turning) draw(fig, dt);
    if (!still.matches || turning) again = true;
  }
  if (again && !document.hidden) raf = requestAnimationFrame(frame);
}
function kick() { if (!raf && !document.hidden) { clock.getDelta(); raf = requestAnimationFrame(frame); } }
document.addEventListener('visibilitychange', kick);

/** The agent printed a new line: one strike (or shot, or page turn) over the working pose. */
export function pulse(tool) {
  const fig = figs[tool];
  if (fig?.key.startsWith('working')) oneShot(fig, lookup(fig.cfg.pulse, fig.key));
}
/** A click on the figure: it flinches, dodges, jumps or cheers; five clicks in three seconds knock it over. */
export function poke(tool) {
  const fig = figs[tool];
  if (!fig?.ready || ['off', 'sad'].includes(fig.key)) return;
  const now = performance.now();
  fig.clicks = fig.clicks.filter((t) => now - t < 3000).concat(now);
  if (fig.clicks.length >= 5) { fig.clicks = []; oneShot(fig, 'Death_A', { force: true, then: () => { fig.busy = { until: performance.now() + 1400, then: () => toBase(fig) }; } }); return; }
  oneShot(fig, POKES[Math.floor(Math.random() * POKES.length)], { force: true });
}

/** Put each canvas into its placeholder and set the pose from the card: state classes and data-role. */
export function sync(root = document) {
  const seen = {};
  for (const slot of root.querySelectorAll('.bot[data-bot]')) {
    const tool = slot.dataset.bot;
    if (!FIGURES[tool]) continue;
    let fig = figs[tool];
    if (!fig) { try { fig = figs[tool] = make(tool); } catch { slot.classList.add('no3d'); continue; } }
    if (fig.canvas.parentElement !== slot) { slot.prepend(fig.canvas); fig.dirty = true; }
    const card = slot.closest('.agent');
    const cl = card?.classList;
    const has = (c) => cl?.contains(c);
    const state = has('cheer') ? 'cheer' : has('sad') ? 'sad' : has('is-working') ? 'working' : has('is-limit') ? 'limit'
      : has('is-queued') ? 'queued' : has('is-blocked') ? 'blocked' : has('is-off') ? 'off' : 'idle';
    setState(fig, state === 'working' && card.dataset.role ? `working:${card.dataset.role}` : state);
    seen[tool] = fig;
    if (!slot.dataset.wired) {
      slot.dataset.wired = '1';
      slot.addEventListener('click', () => poke(tool));
      card?.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; const r = card.getBoundingClientRect(); fig.turnTo = ((e.clientX - r.left) / r.width - 0.5) * -1.4; kick(); });
      card?.addEventListener('pointerleave', () => { fig.turnTo = 0; kick(); });
    }
  }
  // Two free tools turn to each other (Claude's card is on the left).
  const both = seen.claude?.key === 'idle' && seen.cursor?.key === 'idle';
  if (seen.claude) seen.claude.face = both ? 0.75 : 0;
  if (seen.cursor) seen.cursor.face = both ? -0.95 : 0;
  kick();
}
