// GALACTIC MATRIX
//
// A barely-visible computational geometry living *inside* the vortex:
// orbit arcs, radial spokes, a slowly turning celestial-sphere graticule
// with an ecliptic, coordinate ticks and sparse survey marks. Everything is
// analytic and anti-aliased to ~1 device pixel, follows part of the vortex
// rotation, and takes its colour from the painting underneath.
// Drawn additively; each element family has its own slow envelope.

precision highp float;

uniform vec2 uAspect;
uniform vec4 uCamera;
uniform vec2 uCenter;
uniform float uRotation;
uniform float uTwist;
uniform float uVortexRadius;
uniform float uPixelsPerUnit;

uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform vec2 uTexCenterA;
uniform vec2 uTexCenterB;
uniform float uMix;
uniform float uCover;

uniform float uOpacity;   // overall, already includes breath + reveal
uniform vec4 uWeights;    // rings, spokes, sphere, ticks
uniform float uMarks;
uniform vec3 uSphere;     // yaw, tilt, roll
uniform float uSweep;     // slow phase driving arc sweeps
uniform float uSeed;

in vec2 vUv;
out vec4 fragColor;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const float RING_BASE = 0.16;
const float RING_RATIO = 1.32;

float gPx; // field units per pixel

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float falloff(float r) {
  float x = r / max(uVortexRadius, 1e-3);
  return 1.0 / (1.0 + x * x * (0.6 + 0.4 * x));
}

// Coverage of a line of `w` pixels at signed distance d (field units).
float lineAA(float d, float w) {
  float hw = 0.5 * max(w, 1.0) * gPx;
  return (1.0 - smoothstep(hw * 0.35, hw + 0.75 * gPx, abs(d))) * min(w, 1.0);
}

// Same, for a periodic parameter x with line centres at integers.
float gridAA(float x, float w) {
  float d = abs(fract(x + 0.5) - 0.5);
  float fw = min(fwidth(x), 0.1);
  return (1.0 - smoothstep(fw * 0.35 * w, fw * (0.5 * w + 0.75), d)) * min(w, 1.0);
}

// Partial arc: visible over `len` (0..1 of a turn) starting at `start`.
float arcMask(float a, float start, float len) {
  float u = fract(a / TAU + 0.5 - start);
  return smoothstep(0.0, 0.06, u) * (1.0 - smoothstep(len - 0.06, len, u));
}

float ringIndex(float r) {
  return floor(log(max(r, 1e-4) / RING_BASE) / log(RING_RATIO) + 0.5);
}

float rings(float r, float a) {
  float i = ringIndex(r);
  if (i < 0.0 || i > 9.0) return 0.0;
  float rk = RING_BASE * pow(RING_RATIO, i);
  float h = hash11(i * 7.13 + uSeed);
  float h2 = hash11(i * 3.71 + uSeed + 1.0);
  float d = r - rk;
  float line = lineAA(d, 0.75 + 0.5 * h);
  if (h > 0.62) line = max(line, 0.55 * lineAA(d - 5.0 * gPx, 0.7)); // hairline companion
  float dir = h2 > 0.5 ? 1.0 : -1.0;
  float start = fract(h * 13.7 + dir * uSweep * (0.25 + 0.6 * h2));
  float arc = arcMask(a, start, 0.3 + 0.55 * h2);
  if (h2 > 0.72) {
    float dash = fract((a / TAU) * floor(24.0 + 60.0 * rk));
    arc *= smoothstep(0.2, 0.3, dash) * (1.0 - smoothstep(0.7, 0.8, dash));
  }
  return line * arc * (0.5 + 0.5 * h) * (1.0 - smoothstep(1.55, 2.05, rk));
}

float spokes(float r, float a) {
  const float N = 24.0;
  float seg = TAU / N;
  float j = floor(a / seg + 0.5);
  float d = r * sin(a - j * seg);
  float h = hash11(j * 1.71 + uSeed * 0.37);
  bool major = abs(mod(j, 6.0)) < 0.5;
  float rIn = major ? 0.08 : 0.3 + 0.25 * h;
  float rOut = major ? 1.55 : 0.85 + 0.6 * h;
  float band = smoothstep(rIn, rIn + 0.18, r) * (1.0 - smoothstep(rOut - 0.35, rOut, r));
  float vis = smoothstep(0.25, 0.95, 0.5 + 0.5 * sin(uSweep * 2.3 * (0.5 + h) + h * 40.0));
  return lineAA(d, major ? 0.85 : 0.65) * band * (major ? 0.8 : vis * 0.65);
}

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1, 0, 0, 0, c, s, 0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0, -s, 0, 1, 0, s, 0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0, -s, c, 0, 0, 0, 1); }

float graticule(vec3 P) {
  float lon = atan(P.x, P.z);
  float lat = asin(clamp(P.y, -1.0, 1.0));
  float mer = gridAA(lon / (PI / 6.0), 0.8) * (1.0 - smoothstep(1.15, 1.45, abs(lat)));
  float par = gridAA(lat / (PI / 6.0), 0.8);
  // Ecliptic: great circle inclined 23.44 degrees.
  vec3 n = vec3(0.0, cos(0.4091), sin(0.4091));
  float e = asin(clamp(dot(P, n), -1.0, 1.0));
  float ecl = 1.0 - smoothstep(0.0, min(fwidth(e), 0.05) * 1.4, abs(e));
  return mer * 0.75 + par * 0.6 + ecl * 0.9;
}

float sphere(vec2 g, float r) {
  const float R = 0.8;
  // No early return: derivatives (fwidth) must be evaluated in uniform flow.
  float inside = step(r, R);
  float z = sqrt(max(R * R - r * r, 0.0)) / R;
  mat3 orient = rotY(-uSphere.x) * rotX(-uSphere.y) * rotZ(-uSphere.z);
  vec3 front = orient * vec3(g / R, z);
  vec3 back = orient * vec3(g / R, -z);
  float limbFade = smoothstep(0.0, 0.5, z);
  float lines = graticule(front) + graticule(back) * 0.22;
  return mix(lineAA(r - R, 0.7) * 0.35, lines * limbFade, inside);
}

float ticks(float r, float a, float R0, float outward, float arcStart, float arcLen) {
  float deg = a * (180.0 / PI);
  float m = deg / 2.0;
  float idx = floor(m + 0.5);
  float dArc = (m - idx) * 2.0 * (PI / 180.0) * r;
  float len = 0.009;
  if (abs(mod(idx, 5.0)) < 0.5) len = 0.02;
  if (abs(mod(idx, 15.0)) < 0.5) len = 0.034;
  float radial = (r - R0) * outward;
  float inBand = smoothstep(-gPx, 0.0, radial) * (1.0 - smoothstep(len - gPx, len, radial));
  float t = lineAA(dArc, 0.7) * inBand;
  float base = lineAA(r - R0, 0.7) * 0.7;
  return max(t, base) * arcMask(a, arcStart, arcLen);
}

float marks(vec2 g, float r, float a) {
  float i = ringIndex(r);
  if (i < 1.0 || i > 8.0) return 0.0;
  float seg = TAU / 24.0;
  float j = floor(a / seg + 0.5);
  float h = hash12(vec2(i, j) + uSeed);
  if (h < 0.84) return 0.0;
  float rk = RING_BASE * pow(RING_RATIO, i);
  float aj = j * seg;
  vec2 l = rot(g - rk * vec2(cos(aj), sin(aj)), -aj);
  float s = 0.012;
  float armX = lineAA(l.y, 0.8) * (1.0 - smoothstep(s - gPx, s, abs(l.x)));
  float armY = lineAA(l.x, 0.8) * (1.0 - smoothstep(s - gPx, s, abs(l.y)));
  float m = max(armX, armY);
  if (h > 0.94) m = max(m, lineAA(length(l) - 0.0065, 0.8));
  float life = 0.5 + 0.5 * sin(uSweep * 3.1 * (0.6 + h) + h * 91.0);
  return m * smoothstep(0.55, 0.95, life);
}

void main() {
  vec2 p = (vUv * 2.0 - 1.0) * uAspect;
  vec2 q = rot(p, -uCamera.w) / uCamera.z + uCamera.xy - uCenter;
  gPx = 1.0 / (uPixelsPerUnit * uCamera.z);

  float r = length(q);
  // The geometry follows half the field rotation and a little of its twist,
  // so it reads as structure inside the vortex rather than an overlay.
  vec2 g = rot(q, -(uRotation * 0.5 + uTwist * falloff(r) * 0.3));
  float a = atan(g.y, g.x);

  float m = 0.0;
  m += rings(r, a) * uWeights.x;
  m += spokes(r, a) * uWeights.y;
  m += sphere(g, r) * uWeights.z;
  m += ticks(r, a, 1.08, 1.0, fract(uSweep * 0.4), 0.62) * uWeights.w;
  m += ticks(r, a, 0.52, -1.0, fract(0.5 - uSweep * 0.3), 0.4) * uWeights.w * 0.7;
  m += marks(g, r, a) * uMarks;

  // Keep the very core and the far corners quiet.
  m *= smoothstep(0.04, 0.16, r) * (1.0 - smoothstep(1.7, 2.3, r));

  // Colour from the painting underneath (very blurred), leaning pale gold / cyan.
  vec2 qa = rot(q, -uRotation);
  vec3 ta = textureLod(uTexA, uTexCenterA + qa / uCover, 6.0).rgb;
  vec3 tb = textureLod(uTexB, uTexCenterB + qa / uCover, 6.0).rgb;
  vec3 t = mix(ta, tb, uMix);
  vec3 hue = t / max(max(t.r, max(t.g, t.b)), 0.04);
  vec3 pale = mix(vec3(1.0, 0.86, 0.62), vec3(0.6, 0.9, 1.0), 0.5 + 0.5 * sin(a + uSweep * 0.7));
  vec3 col = mix(pale, hue, 0.45);

  fragColor = vec4(col * m * uOpacity, 0.0);
}
