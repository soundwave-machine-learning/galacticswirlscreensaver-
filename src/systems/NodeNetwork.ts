import * as THREE from 'three';
import nodesVert from '../shaders/nodes.vert?raw';
import nodesFrag from '../shaders/nodes.frag?raw';
import linksVert from '../shaders/links.vert?raw';
import linksFrag from '../shaders/links.frag?raw';
import { ADDITIVE, type SharedUniforms } from '../renderer/uniforms';
import { deriveSeed, mulberry32, smoothstep } from '../util/random';

const SEGMENTS = 14; // per link, so links can bend gently with the flow
const MAX_LINKS = 16;
const PALETTE_SIZE = 5;

interface NodeSeed {
  phase: number;
  life: number;
  depth: number;
  speed: number;
  dir: number;
  size: number;
  palette: number;
  rank: number;
  salt: number;
}

interface Link {
  a: number;
  b: number;
  age: number;
  fadeIn: number;
  hold: number;
  fadeOut: number;
  /** When set, the link is leaving early, fading from this level. */
  leavingFrom?: number;
  leaveAge?: number;
  color: THREE.Color;
}

const PALETTE = [
  new THREE.Color(1.0, 0.86, 0.58),
  new THREE.Color(0.58, 0.9, 1.0),
  new THREE.Color(0.42, 0.95, 0.86),
  new THREE.Color(0.5, 0.62, 1.0),
  new THREE.Color(1.0, 0.5, 0.3),
];

function hash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/**
 * Rare bright nodes orbiting in pseudo-3D. Occasionally a few nearby nodes
 * are joined by extremely thin lines that fade in slowly, hold for several
 * seconds and fade out - a neural constellation briefly revealing itself.
 */
export class NodeNetwork {
  readonly points: THREE.Points;
  readonly lines: THREE.LineSegments;
  private readonly nodeMaterial: THREE.ShaderMaterial;
  private readonly lineMaterial: THREE.ShaderMaterial;
  private readonly seeds: NodeSeed[];
  private readonly clip: Float32Array;
  private readonly world: Float32Array;
  private readonly alpha: Float32Array;
  private readonly glow: Float32Array;
  private links: Link[] = [];
  private rand: () => number;
  private spawnTimer = 0;

  constructor(
    private readonly shared: SharedUniforms,
    count: number,
    seed: number,
  ) {
    const rand = mulberry32(deriveSeed(seed, 'nodes'));
    this.rand = mulberry32(deriveSeed(seed, 'links'));
    this.seeds = Array.from({ length: count }, () => {
      const p = rand();
      return {
        phase: rand() * 10,
        life: 70 + rand() * 160,
        depth: 0.8 + rand() * 2.2,
        speed: 0.006 + rand() * 0.012,
        dir: rand() < 0.3 ? -1 : 1,
        size: 2.2 + rand() * 2.6,
        palette: p < 0.34 ? 0 : p < 0.62 ? 1 : p < 0.82 ? 2 : p < 0.95 ? 3 : 4,
        rank: rand(),
        salt: rand() * 1000,
      };
    });
    this.clip = new Float32Array(count * 3);
    this.world = new Float32Array(count * 2);
    this.alpha = new Float32Array(count);
    this.glow = new Float32Array(count);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.clip, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute(
      'aNode',
      new THREE.BufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage),
    );
    this.nodeMaterial = new THREE.ShaderMaterial({
      vertexShader: nodesVert,
      fragmentShader: nodesFrag,
      uniforms: { uBrightness: { value: 1 } },
      ...ADDITIVE,
    });
    this.points = new THREE.Points(geo, this.nodeMaterial);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;

    const lineVerts = MAX_LINKS * SEGMENTS * 2;
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(lineVerts * 3), 3).setUsage(THREE.DynamicDrawUsage),
    );
    lgeo.setAttribute(
      'aAlpha',
      new THREE.BufferAttribute(new Float32Array(lineVerts), 1).setUsage(THREE.DynamicDrawUsage),
    );
    lgeo.setAttribute(
      'aColor',
      new THREE.BufferAttribute(new Float32Array(lineVerts * 3), 3).setUsage(THREE.DynamicDrawUsage),
    );
    lgeo.setDrawRange(0, 0);
    this.lineMaterial = new THREE.ShaderMaterial({
      vertexShader: linksVert,
      fragmentShader: linksFrag,
      uniforms: { uOpacity: { value: 0.5 } },
      ...ADDITIVE,
    });
    this.lines = new THREE.LineSegments(lgeo, this.lineMaterial);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 4;
  }

  get activeLinks() {
    return this.links.length;
  }

  update(
    dt: number,
    time: number,
    opts: { density: number; brightness: number; maxLinks: number; pixelScale: number; veil: number },
  ) {
    const s = this.shared;
    const cam = s.uCamera.value;
    const aspect = s.uAspect.value;
    const center = s.uCenter.value;
    const rotation = s.uRotation.value * 0.6;
    const cr = Math.cos(rotation);
    const sr = Math.sin(rotation);
    const croll = Math.cos(cam.w);
    const sroll = Math.sin(cam.w);
    const nodeAttr = this.points.geometry.getAttribute('aNode') as THREE.BufferAttribute;
    const nodeData = nodeAttr.array as Float32Array;

    for (let i = 0; i < this.seeds.length; i++) {
      const n = this.seeds[i];
      const t = time / n.life + n.phase;
      const cycle = Math.floor(t);
      const age = t - cycle;
      const r0 = 0.12 + 1.55 * Math.pow(hash(cycle * 1.37 + n.salt), 0.85);
      const th0 = hash(cycle * 2.11 + n.salt * 1.7) * Math.PI * 2;
      const ageSec = age * n.life;
      const r = r0 * Math.exp(-0.0008 * ageSec);
      const omega = (n.dir * n.speed * (0.35 + 0.65 / (1 + Math.pow(r / 0.45, 1.4)))) / Math.sqrt(n.depth);
      const th = th0 + omega * ageSec;
      const lx = r * Math.cos(th);
      const ly = r * Math.sin(th) * 0.92;
      const wx = cr * lx - sr * ly + center.x;
      const wy = sr * lx + cr * ly + center.y;
      this.world[i * 2] = wx;
      this.world[i * 2 + 1] = wy;

      const par = 1 / n.depth;
      const zoom = 1 + (cam.z - 1) * par;
      const cx = (wx - cam.x * par) * zoom;
      const cy = (wy - cam.y * par) * zoom;
      const sx = croll * cx - sroll * cy;
      const sy = sroll * cx + croll * cy;
      this.clip[i * 3] = sx / aspect.x;
      this.clip[i * 3 + 1] = sy / aspect.y;

      const fade = smoothstep(0, 0.1, age) * (1 - smoothstep(0.85, 1, age));
      const cull = 1 - smoothstep(opts.density - 0.06, opts.density, n.rank);
      const twinkle = 0.85 + 0.15 * Math.sin(time * (0.3 + n.speed * 20) + n.salt);
      this.alpha[i] = fade * cull * twinkle * opts.veil;
    }

    this.updateLinks(dt, opts.maxLinks);

    // Linked nodes glow a little brighter while their line is visible.
    this.glow.fill(0);
    for (const l of this.links) {
      const env = this.linkEnvelope(l);
      this.glow[l.a] = Math.max(this.glow[l.a], env);
      this.glow[l.b] = Math.max(this.glow[l.b], env);
    }

    for (let i = 0; i < this.seeds.length; i++) {
      const n = this.seeds[i];
      nodeData[i * 4] = this.alpha[i];
      nodeData[i * 4 + 1] = n.size * opts.pixelScale * Math.sqrt(1 / n.depth) * 1.3;
      nodeData[i * 4 + 2] = n.palette;
      nodeData[i * 4 + 3] = this.glow[i];
    }
    nodeAttr.needsUpdate = true;
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.nodeMaterial.uniforms.uBrightness.value = opts.brightness;

    this.writeLinkGeometry(opts.veil);
  }

  private distance(a: number, b: number) {
    const dx = this.world[a * 2] - this.world[b * 2];
    const dy = this.world[a * 2 + 1] - this.world[b * 2 + 1];
    return Math.hypot(dx, dy);
  }

  private linkEnvelope(l: Link) {
    if (l.leavingFrom !== undefined && l.leaveAge !== undefined) {
      return l.leavingFrom * (1 - smoothstep(0, l.fadeOut, l.age - l.leaveAge));
    }
    if (l.age < l.fadeIn) return smoothstep(0, l.fadeIn, l.age);
    if (l.age < l.fadeIn + l.hold) return 1;
    return 1 - smoothstep(0, l.fadeOut, l.age - l.fadeIn - l.hold);
  }

  private updateLinks(dt: number, maxLinks: number) {
    const MAX_DIST = 0.42;
    for (const l of this.links) {
      l.age += dt;
      const env = this.linkEnvelope(l);
      const tooFar = this.distance(l.a, l.b) > MAX_DIST * 1.5;
      const dying = this.alpha[l.a] < 0.25 || this.alpha[l.b] < 0.25;
      if ((tooFar || dying) && l.leavingFrom === undefined) {
        l.leavingFrom = env;
        l.leaveAge = l.age;
        l.fadeOut = 3.5;
      }
    }
    this.links = this.links.filter((l) => {
      if (l.leavingFrom !== undefined) return l.age - (l.leaveAge ?? 0) < l.fadeOut;
      return l.age < l.fadeIn + l.hold + l.fadeOut;
    });

    const cap = Math.min(MAX_LINKS, Math.max(0, Math.round(maxLinks)));
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0 || this.links.length >= cap || dt <= 0) return;
    this.spawnTimer = 0.6 + this.rand() * 1.6;

    // Grow from an existing constellation sometimes, otherwise start a new one.
    const n = this.seeds.length;
    let a = Math.floor(this.rand() * n);
    if (this.links.length > 0 && this.rand() < 0.55) {
      const l = this.links[Math.floor(this.rand() * this.links.length)];
      a = this.rand() < 0.5 ? l.a : l.b;
    }
    if (this.alpha[a] < 0.6) return;
    let best = -1;
    let bestD = MAX_DIST;
    for (let j = 0; j < n; j++) {
      if (j === a || this.alpha[j] < 0.6) continue;
      if (this.links.some((l) => (l.a === a && l.b === j) || (l.a === j && l.b === a))) continue;
      const d = this.distance(a, j);
      if (d > 0.07 && d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best < 0) return;
    const color = PALETTE[this.seeds[a].palette % PALETTE_SIZE]
      .clone()
      .lerp(PALETTE[this.seeds[best].palette % PALETTE_SIZE], 0.5)
      .lerp(new THREE.Color(0.85, 0.9, 1), 0.3);
    this.links.push({
      a,
      b: best,
      age: 0,
      fadeIn: 3 + this.rand() * 2.5,
      hold: 4 + this.rand() * 7,
      fadeOut: 3.5 + this.rand() * 3,
      color,
    });
  }

  private writeLinkGeometry(veil: number) {
    const geo = this.lines.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const alp = geo.getAttribute('aAlpha') as THREE.BufferAttribute;
    const col = geo.getAttribute('aColor') as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const A = alp.array as Float32Array;
    const C = col.array as Float32Array;
    let v = 0;
    for (const l of this.links) {
      const env = this.linkEnvelope(l) * Math.min(this.alpha[l.a], this.alpha[l.b]) * veil;
      const ax = this.clip[l.a * 3];
      const ay = this.clip[l.a * 3 + 1];
      const bx = this.clip[l.b * 3];
      const by = this.clip[l.b * 3 + 1];
      // Gentle bend, like a filament following the flow.
      const mx = (ax + bx) / 2 - (by - ay) * 0.12;
      const my = (ay + by) / 2 + (bx - ax) * 0.12;
      for (let s = 0; s < SEGMENTS; s++) {
        for (const k of [s, s + 1]) {
          const t = k / SEGMENTS;
          const u = 1 - t;
          P[v * 3] = u * u * ax + 2 * u * t * mx + t * t * bx;
          P[v * 3 + 1] = u * u * ay + 2 * u * t * my + t * t * by;
          P[v * 3 + 2] = 0;
          // Brighter near the nodes, softly dimmer mid-span.
          A[v] = env * (0.55 + 0.45 * Math.pow(Math.abs(2 * t - 1), 1.5));
          C[v * 3] = l.color.r;
          C[v * 3 + 1] = l.color.g;
          C[v * 3 + 2] = l.color.b;
          v++;
        }
      }
    }
    geo.setDrawRange(0, v);
    pos.needsUpdate = true;
    alp.needsUpdate = true;
    col.needsUpdate = true;
  }

  setOpacity(o: number) {
    this.lineMaterial.uniforms.uOpacity.value = o;
  }

  dispose() {
    this.points.geometry.dispose();
    this.lines.geometry.dispose();
    this.nodeMaterial.dispose();
    this.lineMaterial.dispose();
  }
}
