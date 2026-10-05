// SPIRAL FIELD
// Samples the source painting through a polar vortex displacement:
//   radius = length(uv - center), angle = atan(y, x)
//   angle += vortexStrength * falloff(radius) * time
// Differential (radius-dependent) rotation would wind the image up forever,
// so the monotonic part runs through a two-phase flow map: two samples whose
// twist resets out of phase, cross-weighted so each resets while invisible.
// Uniform rotation (no distortion) is applied exactly on top.

precision highp float;

uniform sampler2D uTex;
uniform vec2 uTexCenter;        // painted vortex centre in texture uv

uniform vec2 uAspect;           // resolution / min(resolution)
uniform float uTime;            // simulation seconds (wrapped on CPU)
uniform float uFlowPhase;       // 0..1, flow-map phase
uniform float uFlowPeriod;      // seconds per flow-map cycle

uniform float uRotation;        // uniform rotation of the whole field (rad)
uniform float uVortexStrength;  // rad/s of differential spin at the core
uniform float uVortexRadius;    // falloff radius in field units
uniform float uTwist;           // bounded (oscillating) extra twist, rad
uniform vec2 uCenter;           // vortex centre in field units
uniform float uNoiseAmount;
uniform float uChromaticDispersion;
uniform float uCover;           // field units spanned by the texture (cover fit / zoom)

uniform vec4 uCamera;           // xy pan, z zoom, w roll

in vec2 vUv;
out vec4 fragColor;

#include <noise>

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Smooth, non-linear falloff: ~1 at the core, gently -> 0 at the perimeter.
float falloff(float r) {
  float x = r / max(uVortexRadius, 1e-3);
  return 1.0 / (1.0 + x * x * (0.6 + 0.4 * x));
}

vec3 sampleField(vec2 q, float twist) {
  float r = length(q);
  float a = atan(q.y, q.x);
  float disp = uChromaticDispersion * smoothstep(0.05, 0.9, r);
  vec2 qr = r * vec2(cos(a - twist * (1.0 + disp)), sin(a - twist * (1.0 + disp)));
  vec2 qg = r * vec2(cos(a - twist), sin(a - twist));
  vec2 qb = r * vec2(cos(a - twist * (1.0 - disp)), sin(a - twist * (1.0 - disp)));
  float s = 1.0 / uCover;
  return vec3(
    texture(uTex, uTexCenter + qr * s).r,
    texture(uTex, uTexCenter + qg * s).g,
    texture(uTex, uTexCenter + qb * s).b
  );
}

void main() {
  vec2 p = (vUv * 2.0 - 1.0) * uAspect;

  // Camera: imperceptible zoom drift, roll and pan.
  vec2 q = rot(p, -uCamera.w) / uCamera.z + uCamera.xy - uCenter;

  // Organic low-frequency domain warp.
  vec3 np = vec3(q * 1.15, uTime * 0.011);
  vec2 warp = vec2(fbm(np), fbm(np + vec3(31.7, -12.4, 7.3)));
  q += warp * uNoiseAmount;

  float r = length(q);
  float f = falloff(r);

  // Uniform rotation is exact; differential twist is bounded.
  q = rot(q, -uRotation);
  float baseTwist = uTwist * f;

  float ph1 = uFlowPhase;
  float ph2 = fract(uFlowPhase + 0.5);
  float w1 = 1.0 - abs(2.0 * ph1 - 1.0);
  float flow = uVortexStrength * f * uFlowPeriod;

  vec3 c1 = sampleField(q, baseTwist + flow * (ph1 - 0.5));
  vec3 c2 = sampleField(q, baseTwist + flow * (ph2 - 0.5));
  vec3 col = mix(c2, c1, w1);

  fragColor = vec4(col, 1.0);
}
