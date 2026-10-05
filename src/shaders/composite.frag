// Final composite: restrained bloom, slight vignette, minimal chromatic
// aberration, gentle highlight shoulder, soft film grain and dithering.
precision highp float;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uAspect;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uVignette;
uniform float uGrain;
uniform float uChromatic;
uniform float uGrainTime;
uniform float uFade;       // global fade from black (start-up / exit)

in vec2 vUv;
out vec4 fragColor;

vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// Leaves the painting untouched below 0.8, rolls off smoothly above.
vec3 shoulder(vec3 c) {
  const float k = 0.8;
  vec3 over = max(c - k, 0.0);
  return min(c, vec3(k)) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 d = vUv - 0.5;
  vec2 dn = d * uAspect / max(uAspect.x, uAspect.y);
  float r2 = dot(dn, dn);

  // Minimal radial chromatic aberration, only towards the edges.
  vec2 off = d * r2 * uChromatic * 0.01;
  vec3 col = vec3(
    texture(uScene, vUv - off).r,
    texture(uScene, vUv).g,
    texture(uScene, vUv + off).b
  );
  col += texture(uBloom, vUv).rgb * uBloomStrength;
  col *= uExposure;

  float vig = 1.0 - uVignette * smoothstep(0.08, 0.62, r2 * 1.6);
  col *= vig;
  col = shoulder(col) * uFade;

  vec3 srgb = linearToSrgb(col);

  // Soft grain: strongest in mid-tones, nearly absent in blacks and highlights.
  float l = dot(srgb, vec3(0.299, 0.587, 0.114));
  float g1 = hash12(gl_FragCoord.xy + uGrainTime * 97.0);
  float g2 = hash12(gl_FragCoord.xy * 1.37 - uGrainTime * 61.0);
  float grain = (g1 + g2 - 1.0) * uGrain * smoothstep(0.0, 0.25, l) * (1.0 - 0.6 * l);
  srgb += grain;

  // Dither to break up 8-bit banding in the deep gradients.
  srgb += (ign(gl_FragCoord.xy + fract(uGrainTime * 7.0) * 61.0) - 0.5) / 255.0;
  fragColor = vec4(srgb, 1.0);
}
