// 3D figures for the two tools on the board: a mage for Claude, a hooded rogue for Cursor.
// Models: KayKit Adventurers by Kay Lousberg, CC0 (public/board/agents/LICENSE.txt), cut down to the clips used here.
// Built into public/board/agents/agents3d.js by `npm run build-agents`; the board page loads it after first paint.
//
// The page re-renders its HTML often, so the canvases live here and are re-attached to the
// `<span class="bot" data-bot="claude|cursor">` placeholders on every sync(); the WebGL contexts survive.
import {
  AnimationMixer, Box3, Clock, DirectionalLight, HemisphereLight, LoopOnce, LoopRepeat, PerspectiveCamera,
  Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const V = '1';
const FIGURES = {
  claude: {
    file: `/board/agents/mage.glb?v=${V}`,
    show: ['2H_Staff'], // the other hand items of the pack stay hidden
    hide: ['Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff'],
    clips: { working: 'Spellcasting', queued: '2H_Melee_Idle', idle: 'Idle', off: 'Lie_Idle', cheer: 'Cheer', sad: 'Death_A' },
  },
  cursor: {
    file: `/board/agents/rogue.glb?v=${V}`,
    show: ['Knife', 'Knife_Offhand'],
    hide: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'],
    clips: { working: 'Dualwield_Melee_Attack_Chop', queued: '2H_Melee_Idle', idle: 'Idle', off: 'Lie_Idle', cheer: 'Cheer', sad: 'Death_A' },
  },
};
const SIZE = 132; // CSS px, square
const still = matchMedia('(prefers-reduced-motion: reduce)');
const figs = {};
let raf = 0;
const clock = new Clock();

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
  const fig = { tool, cfg, canvas, renderer, scene, camera, state: '', turn: 0, turnTo: 0, ready: false, dirty: true };
  new GLTFLoader().load(cfg.file, (gltf) => {
    const model = gltf.scene;
    model.traverse((o) => { if (cfg.hide.includes(o.name)) o.visible = cfg.show.includes(o.name); });
    scene.add(model);
    // Frame the standing figure once; lying and jumping clips stay inside the same frame.
    const box = new Box3().setFromObject(model);
    const h = box.max.y - box.min.y;
    fig.lookAt = new Vector3(0, h * 0.5, 0);
    fig.dist = h * 2.55;
    fig.model = model;
    fig.mixer = new AnimationMixer(model);
    fig.actions = Object.fromEntries(gltf.animations.map((c) => [c.name, fig.mixer.clipAction(c)]));
    fig.ready = true;
    canvas.classList.add('on');
    const want = fig.state; fig.state = ''; setState(fig, want || 'idle');
    kick();
  }, undefined, () => { canvas.closest('.bot')?.classList.add('no3d'); });
  return fig;
}

function setState(fig, state) {
  if (fig.state === state) return;
  fig.state = state;
  if (!fig.ready) return;
  const next = fig.actions[fig.cfg.clips[state]] || fig.actions.Idle;
  const once = state === 'sad';
  next.reset();
  next.setLoop(once ? LoopOnce : LoopRepeat, Infinity);
  next.clampWhenFinished = once;
  if (fig.current && fig.current !== next) next.crossFadeFrom(fig.current, 0.35, false);
  next.play();
  fig.current = next;
  // A lying figure is long, not tall: step back so it fits.
  fig.zoom = state === 'off' ? 1.25 : 1;
  if (still.matches) { fig.mixer.update(state === 'sad' ? 5 : 0.6); }
  fig.dirty = true;
  kick();
}

function draw(fig, dt) {
  if (!fig.ready) return;
  if (!still.matches) fig.mixer.update(dt);
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
    const moving = !still.matches || fig.dirty || Math.abs(fig.turnTo - fig.turn) > 0.002;
    if (moving) draw(fig, dt);
    if (!still.matches || Math.abs(fig.turnTo - fig.turn) > 0.002) again = true;
  }
  if (again && !document.hidden) raf = requestAnimationFrame(frame);
}
function kick() { if (!raf && !document.hidden) { clock.getDelta(); raf = requestAnimationFrame(frame); } }
document.addEventListener('visibilitychange', kick);

/** Put each canvas into its placeholder and set the pose from the card's state classes. */
export function sync(root = document) {
  for (const slot of root.querySelectorAll('.bot[data-bot]')) {
    const tool = slot.dataset.bot;
    if (!FIGURES[tool]) continue;
    let fig = figs[tool];
    if (!fig) { try { fig = figs[tool] = make(tool); } catch { slot.classList.add('no3d'); continue; } }
    if (fig.canvas.parentElement !== slot) { slot.append(fig.canvas); fig.dirty = true; }
    const card = slot.closest('.agent');
    const cl = card?.classList;
    const state = !cl ? 'idle' : cl.contains('cheer') ? 'cheer' : cl.contains('sad') ? 'sad'
      : cl.contains('is-working') ? 'working' : cl.contains('is-queued') ? 'queued' : cl.contains('is-off') ? 'off' : 'idle';
    setState(fig, state);
    if (card && !card.dataset.turns) {
      card.dataset.turns = '1';
      card.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; const r = card.getBoundingClientRect(); fig.turnTo = ((e.clientX - r.left) / r.width - 0.5) * -1.4; kick(); });
      card.addEventListener('pointerleave', () => { fig.turnTo = 0; kick(); });
    }
  }
  kick();
}
