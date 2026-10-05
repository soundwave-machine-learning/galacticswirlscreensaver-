// Pseudo-3D orbital particles. Every position is a pure function of time
// and per-particle seeds, so the CPU does no per-frame work. Particles are
// re-seeded at the end of each (long, individually random) lifetime, so
// paths never visibly loop.

precision highp float;

attribute vec4 aSeed;     // x,y,z,w: independent uniform randoms
attribute vec4 aParams;   // x: size rand, y: life rand, z: spin dir (+-1), w: rank (density cull)

uniform float uTime;
uniform vec2 uAspect;
uniform vec4 uCamera;     // xy pan, z zoom, w roll
uniform vec2 uCenter;
uniform float uRotation;
uniform float uPixelsPerUnit;

uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform vec2 uTexCenterA;
uniform vec2 uTexCenterB;
uniform float uMix;
uniform float uEmergence;
uniform float uCover;
uniform float uEmergeBoost;   // how strongly this layer heralds the incoming field

// Population shape
uniform vec2 uDepthRange;   // min/max depth (1 = focal plane, larger = farther)
uniform vec2 uSizeRange;    // world size range (field units at depth 1)
uniform vec2 uLifeRange;    // seconds
uniform float uRadiusMax;
uniform float uSpeed;       // base angular speed (rad/s) at the core
uniform float uInflow;      // fractional radial drift per second (+ inward)
uniform float uTintAmount;  // how strongly the painting colours the particle
uniform float uTwinkle;
uniform float uBrightness;
uniform float uDensity;     // 0..1 visible fraction (rank cull, soft)

varying vec3 vColor;
varying float vAlpha;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void main() {
  float life = mix(uLifeRange.x, uLifeRange.y, aParams.y);
  float t = uTime / life + aSeed.w * 7.0;
  float cycle = floor(t);
  float age = fract(t);

  // Fresh orbit every lifetime.
  float h1 = hash11(cycle * 1.37 + aSeed.x * 113.1);
  float h2 = hash11(cycle * 2.11 + aSeed.y * 271.7);
  float r0 = uRadiusMax * pow(mix(0.004, 1.0, h1), 0.8);
  float theta0 = h2 * 6.2831853;
  float depth = mix(uDepthRange.x, uDepthRange.y, aSeed.z);

  float ageSec = age * life;
  float r = r0 * exp(-uInflow * ageSec);
  // Differential, Keplerian-flavoured spin: inner orbits move faster.
  float omega = aParams.z * uSpeed * (0.35 + 0.65 / (1.0 + pow(r / 0.45, 1.4))) / sqrt(depth);
  float theta = theta0 + omega * ageSec;

  vec2 world = r * vec2(cos(theta), sin(theta));
  // A slight orbital tilt reads as depth rather than a flat disc.
  world.y *= mix(0.86, 1.0, aSeed.x);
  world = rot(world, uRotation * 0.6) + uCenter;

  // Parallax: far layers move less with the camera.
  float par = 1.0 / depth;
  vec2 cam = (world - uCamera.xy * par) * mix(1.0, uCamera.z, par);
  vec2 screen = rot(cam, uCamera.w);
  gl_Position = vec4(screen / uAspect, 0.0, 1.0);

  // Colour drawn from the painting underneath. The incoming painting tints
  // particles (and lifts those over its bright structures) before it shows.
  vec2 rel = rot(world - uCenter, -uRotation);
  vec3 texA = textureLod(uTexA, uTexCenterA + rel / uCover, 4.0).rgb;
  vec3 texB = textureLod(uTexB, uTexCenterB + rel / uCover, 4.0).rgb;
  float early = clamp(uMix + uEmergence * uEmergeBoost * 0.7, 0.0, 1.0);
  vec3 tex = mix(texA, texB, early);
  vec3 base = vec3(0.86, 0.9, 1.0);
  vec3 tint = tex * 1.6 / max(max(tex.r, max(tex.g, tex.b)), 0.25);
  vColor = mix(base, tint, uTintAmount);
  float lumB = dot(texB, vec3(0.2126, 0.7152, 0.0722));
  float herald = 1.0 + uEmergence * uEmergeBoost * smoothstep(0.12, 0.55, lumB) * 2.2 * (1.0 - uMix);

  float sizeWorld = mix(uSizeRange.x, uSizeRange.y, aParams.x * aParams.x);
  float px = sizeWorld * uPixelsPerUnit * par * uCamera.z;
  float pxClamped = max(px, 1.6);

  float fade = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.82, 1.0, age));
  float tw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * mix(0.25, 0.9, aSeed.y) + aSeed.x * 40.0));
  float cull = 1.0 - smoothstep(uDensity - 0.06, uDensity, aParams.w);
  // Keep energy constant when the sprite is clamped up to the minimum size.
  float sub = (px * px) / (pxClamped * pxClamped);

  vAlpha = fade * tw * cull * herald * uBrightness * min(1.0, sub + 0.15);
  gl_PointSize = pxClamped;
  if (vAlpha <= 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
  }
}
