/**
 * Website-builder funnel backdrop: soft floating "bokeh" light, like candle
 * glow at a reception, tinted to the chosen website style.
 *
 * Lightweight by design (UI UX Pro Max three.js rules):
 *  - one WebGLRenderer for the page, alpha, no antialias, low-power GPU
 *  - ~90 points on phones / ~170 on desktop, one ShaderMaterial draw call
 *  - pixel ratio capped at 1.5; pauses when the tab is hidden
 *  - three.js (pinned 0.160.0, ~135 KB brotli) is only fetched after the
 *    page is idle, and never for reduced-motion / Save-Data / no-WebGL
 *    visitors: they keep the static CSS gradient underneath.
 * Pointer and touch move the camera a little for depth (parallax).
 */
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';

function canAnimate() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (navigator.connection && navigator.connection.saveData) return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

const VERT = /* glsl */`
  attribute float aScale;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    // slow upward drift, wrapped inside the box, plus a gentle sway
    float rise = mod(p.y + uTime * (0.06 + aPhase * 0.05) + 6.0, 12.0) - 6.0;
    p.y = rise;
    p.x += sin(uTime * 0.25 + aPhase * 6.2831) * 0.35;
    p.z += cos(uTime * 0.2 + aPhase * 4.0) * 0.25;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aScale * uPixelRatio * (34.0 / -mv.z);
    vColor = aColor;
    // fade in/out near the top and bottom of the box, twinkle softly
    vAlpha = smoothstep(6.0, 4.0, abs(rise)) * (0.55 + 0.45 * sin(uTime * 0.8 + aPhase * 12.0));
  }
`;
const FRAG = /* glsl */`
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    // soft out-of-focus disc, no hard core: candle-light bokeh that stays
    // behind the content instead of competing with it
    float soft = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(vColor, soft * soft * 0.34 * vAlpha);
  }
`;

export async function startBackdrop(canvas, palette) {
  if (!canvas || !canAnimate()) return null;
  let THREE;
  try { THREE = await import(THREE_URL); } catch { return null; } // CDN down: keep CSS gradient

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
  camera.position.set(0, 0, 9);

  const mobile = window.matchMedia('(max-width: 760px)').matches;
  const COUNT = mobile ? 60 : 110;
  const pos = new Float32Array(COUNT * 3);
  const scale = new Float32Array(COUNT);
  const phase = new Float32Array(COUNT);
  const color = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 16;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 12;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 6 - 1;
    // a few big out-of-focus orbs, mostly small glints
    scale[i] = Math.random() < 0.18 ? 46 + Math.random() * 60 : 8 + Math.random() * 14;
    phase[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aScale', new THREE.BufferAttribute(scale, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const colorAttr = new THREE.BufferAttribute(color, 3);
  geo.setAttribute('aColor', colorAttr);

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: dpr } },
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
  });
  scene.add(new THREE.Points(geo, mat));

  function setPalette(hexes) {
    // Lift every tint toward warm white: the backdrop should read as light
    // in the room, never as coloured dots on top of the page.
    const warm = new THREE.Color('#fff4e8');
    const cols = (hexes && hexes.length ? hexes : ['#c45a3a', '#f0a37a', '#d9a441'])
      .map(h => new THREE.Color(h).lerp(warm, 0.45));
    for (let i = 0; i < COUNT; i++) {
      const c = cols[i % cols.length];
      color[i * 3] = c.r; color[i * 3 + 1] = c.g; color[i * 3 + 2] = c.b;
    }
    colorAttr.needsUpdate = true;
  }
  setPalette(palette);

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  // parallax target from mouse or touch, eased in the loop
  const target = { x: 0, y: 0 };
  const onMove = (x, y) => {
    target.x = (x / window.innerWidth - 0.5) * 1.2;
    target.y = (y / window.innerHeight - 0.5) * -0.8;
  };
  window.addEventListener('pointermove', e => onMove(e.clientX, e.clientY), { passive: true });
  window.addEventListener('touchmove', e => { const t = e.touches[0]; if (t) onMove(t.clientX, t.clientY); }, { passive: true });

  let running = true, raf = 0, last = performance.now(), time = 0;
  function frame(now) {
    if (!running) return;
    time += Math.min(0.05, (now - last) / 1000); // no jump after a pause
    last = now;
    mat.uniforms.uTime.value = time;
    camera.position.x += (target.x - camera.position.x) * 0.03;
    camera.position.y += (target.y - camera.position.y) * 0.03;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  const onVis = () => {
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  };
  document.addEventListener('visibilitychange', onVis);
  raf = requestAnimationFrame(frame);
  canvas.classList.add('on');

  return {
    setPalette,
    stop() {
      running = false; cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', resize);
      geo.dispose(); mat.dispose(); renderer.dispose();
      canvas.classList.remove('on');
    },
  };
}
