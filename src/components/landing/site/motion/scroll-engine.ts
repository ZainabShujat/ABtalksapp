"use client";

export function clamp(v: number, min: number, max: number) {
  return v < min ? min : v > max ? max : v;
}

export function norm(value: number, from: number, to: number) {
  if (to === from) return 0;
  return clamp((value - from) / (to - from), 0, 1);
}

export function smoothstep(t: number) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function envelope(
  p: number,
  a: number,
  b: number,
  c: number,
  d: number,
) {
  if (p <= a) return 0;
  if (p < b) return smoothstep(norm(p, a, b));
  if (p <= c) return 1;
  if (p < d) return 1 - smoothstep(norm(p, c, d));
  return 0;
}

type Scene = {
  el: HTMLElement;
  update: (p: number) => void;
  pinned: boolean;
  last: number;
  start: number;
  length: number;
};

const scenes: Scene[] = [];
let ticking = false;
let viewportH = 0;
let listening = false;

function measure(scene: Scene) {
  const rect = scene.el.getBoundingClientRect();
  const top = rect.top + window.scrollY;
  const height = scene.el.offsetHeight;
  scene.start = top;
  scene.length = Math.max(1, height - (scene.pinned ? viewportH : 0));
}

function render() {
  const y = window.scrollY;
  for (const scene of scenes) {
    const p = clamp((y - scene.start) / scene.length, 0, 1);
    if (p !== scene.last) {
      scene.last = p;
      scene.update(p);
    }
  }
  ticking = false;
}

function requestTick() {
  if (ticking) return;
  ticking = true;
  window.requestAnimationFrame(render);
}

function measureAll() {
  viewportH = window.innerHeight;
  scenes.forEach(measure);
  render();
}

function attach() {
  if (listening) return;
  listening = true;
  window.addEventListener("scroll", requestTick, { passive: true });
  window.addEventListener("resize", measureAll);
  window.addEventListener("orientationchange", measureAll);
  if (document.fonts?.ready) void document.fonts.ready.then(measureAll);
  window.addEventListener("load", measureAll);
}

function detach() {
  if (!listening) return;
  listening = false;
  window.removeEventListener("scroll", requestTick);
  window.removeEventListener("resize", measureAll);
  window.removeEventListener("orientationchange", measureAll);
  window.removeEventListener("load", measureAll);
}

export const ScrollEngine = {
  add(el: HTMLElement, update: (p: number) => void, pinned = true) {
    const scene: Scene = {
      el,
      update,
      pinned,
      last: -1,
      start: 0,
      length: 1,
    };
    scenes.push(scene);
    attach();
    measure(scene);
    scene.update(
      clamp((window.scrollY - scene.start) / scene.length, 0, 1),
    );
    return () => {
      const index = scenes.indexOf(scene);
      if (index >= 0) scenes.splice(index, 1);
      if (scenes.length === 0) detach();
    };
  },
  refresh: measureAll,
};
