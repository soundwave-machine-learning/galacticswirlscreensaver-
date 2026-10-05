// SPIRAL FIELD
//
// Samples the source paintings through a polar vortex displacement:
//   radius = length(uv - center), angle = atan(y, x)
//   angle += vortexStrength * falloff(radius) * time
//
// Differential (radius-dependent) rotation would wind the image up without
// bound over a 60-minute session, so the monotonic part runs through a
// two-phase flow map: two samples whose accumulated twist resets half a
// cycle apart, each weighted to zero at the instant it resets. Uniform
// rotation (which causes no distortion) is applied exactly on top, and a
// bounded oscillating twist adds slow differential motion with no reset.
//
// Transitions are not crossfades: the incoming painting surfaces first
// through its own brightest structures and a slow noise front, with a
// faint luminous rim and a transient distortion field.

precision highp float;

uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform vec2 uTexCenterA;       // painted vortex centre (GL texture space)
uniform vec2 uTexCenterB;
uniform float uMix;             // eased dominance of B, 0..1
uniform float uEmergence;       // transient distortion / energy, 0..1

uniform vec2 uAspect;           // resolution / min(resolution)
uniform float uTime;            // simulation seconds
uniform float uFlowPhase;       // 0..1
uniform float uFlowPeriod;      // seconds per flow-map cycle

uniform float uRotation;        // uniform rotation of the whole field (rad)
uniform float uVortexStrength;  // rad/s of differential spin at the core
uniform float uVortexRadius;    // falloff radius, field units
uniform float uTwist;           // bounded twist at the core (rad)
uniform vec2 uCenter;           // vortex centre, field units
uniform float uNoiseAmount;
uniform float uChromaticDispersion;
uniform float uCover;           // field units spanned by one texture width
uniform vec4 uCamera;           // xy pan, z zoom, w roll
uniform vec3 uSeedOffset;       // decorrelates noise between seeds

uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uHighlightLift;
uniform float uVoid;

in vec2 vUv;
out vec4 fragColor;

#include <noise>

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Smooth non-linear falloff: 1 at the core, easing to 0 at the perimeter.
float falloff(float r) {
  float x = r / max(uVortexRadius, 1e-3);
  return 1.0 / (1.0 + x * x * (0.6 + 0.4 * x));
}

vec3 samplePainting(sampler2D tex, vec2 center, vec2 q, float twist, float disp) {
  float s = 1.0 / uCover;
  float tr = twist * (1.0 + disp);
  float tb = twist * (1.0 - disp);
  vec2 qg = rot(q, -twist);
  vec2 qr = rot(q, -tr);
  vec2 qb = rot(q, -tb);
  // A hair of radial spread keeps dispersion from reading as pure rotation.
  qr *= 1.0 + disp * 0.04;
  qb *= 1.0 - disp * 0.04;
  return vec3(
    texture(tex, center + qr * s).r,
    texture(tex, center + qg * s).g,
    texture(tex, center + qb * s).b
  );
}

vec3 flowSample(sampler2D tex, vec2 center, vec2 q, float baseTwist, float flow, float disp) {
  float ph1 = uFlowPhase;
  float ph2 = fract(uFlowPhase + 0.5);
  float w1 = 1.0 - abs(2.0 * ph1 - 1.0);
  vec3 c1 = samplePainting(tex, center, q, baseTwist + flow * (ph1 - 0.5), disp);
  vec3 c2 = samplePainting(tex, center, q, baseTwist + flow * (ph2 - 0.5), disp);
  return mix(c2, c1, w1);
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 grade(vec3 col, vec2 q) {
  float l = luma(col);
  col = mix(vec3(l), col, uSaturation);
  // Gentle power contrast around a low pivot keeps blacks deep.
  col = 0.18 * pow(max(col, 0.0) / 0.18, vec3(uContrast));

  // Ascension: highlights lean toward pale gold or cyan, by their own hue.
  float hl = smoothstep(0.18, 0.85, l);
  float coolness = smoothstep(-0.08, 0.12, 0.5 * (col.b + col.g) - col.r);
  vec3 tint = mix(vec3(1.0, 0.82, 0.52), vec3(0.55, 0.92, 1.0), coolness);
  col = mix(col, col * tint * 1.45 + tint * 0.02, hl * uHighlightLift);

  // Void: only fragments of the painting survive in a near-black field.
  if (uVoid > 0.001) {
    float n = fbm(vec3(q * 0.9 + uSeedOffset.xy, uTime * 0.006 + uSeedOffset.z)) * 0.5 + 0.5;
    float keep = smoothstep(0.58, 0.82, n + (l - 0.25) * 0.55);
    float fragments = mix(1.0, keep * 0.85, uVoid);
    col *= fragments * mix(1.0, 0.75, uVoid);
  }
  return col * uExposure;
}

void main() {
  vec2 p = (vUv * 2.0 - 1.0) * uAspect;

  // Camera: imperceptible zoom drift, roll and pan.
  vec2 q = rot(p, -uCamera.w) / uCamera.z + uCamera.xy - uCenter;

  // Organic low-frequency domain warp; stronger while a field emerges.
  vec3 np = vec3(q * 1.15 + uSeedOffset.xy, uTime * 0.011 + uSeedOffset.z);
  vec2 warp = vec2(fbm(np), fbm(np + vec3(31.7, -12.4, 7.3)));
  float warpAmount = uNoiseAmount * (1.0 + 1.6 * uEmergence);
  q += warp * warpAmount;

  float r = length(q);
  float f = falloff(r);
  q = rot(q, -uRotation);

  float baseTwist = uTwist * f;
  float flow = uVortexStrength * f * uFlowPeriod;
  float disp = uChromaticDispersion * smoothstep(0.05, 0.9, r);

  vec3 colA = flowSample(uTexA, uTexCenterA, q, baseTwist, flow, disp);
  vec3 col = colA;

  if (uMix > 0.0005) {
    // The incoming field swirls in slightly against the current one.
    float twistB = baseTwist - 0.25 * uEmergence * f;
    vec3 colB = flowSample(uTexB, uTexCenterB, q, twistB, flow, disp);

    // Emergence mask: bright structures of B and a slow noise front
    // arrive first. Exactly 0 at mix = 0 and exactly 1 at mix = 1.
    float n = fbm(vec3(q * 1.6 - uSeedOffset.yx, uTime * 0.02)) * 0.5 + 0.5;
    float m = clamp(0.55 * smoothstep(0.05, 0.6, luma(colB)) + 0.45 * n, 0.0, 1.0);
    const float spread = 0.42;
    float w = clamp(uMix * (1.0 + 2.0 * spread) - spread + spread * (2.0 * m - 1.0), 0.0, 1.0);
    w = w * w * (3.0 - 2.0 * w);

    col = mix(colA, colB, w);
    // Faint luminous rim where the new field is breaking through.
    float rim = 4.0 * w * (1.0 - w);
    col += colB * rim * 0.18 * uEmergence;
  }

  fragColor = vec4(grade(col, q), 1.0);
}
