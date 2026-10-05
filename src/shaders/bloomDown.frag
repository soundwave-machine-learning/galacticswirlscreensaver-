// 13-tap downsample (Jimenez, "Next Generation Post Processing in CoD:AW").
// The first pass also applies a soft-knee threshold and a Karis-style
// luminance weight so isolated bright pixels never flicker into fireflies.
precision highp float;

uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
uniform float uFirst;

in vec2 vUv;
out vec4 fragColor;

vec3 tap(vec2 o) { return texture(uSrc, vUv + o * uTexel).rgb; }

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 karis(vec3 c) { return c / (1.0 + luma(c)); }

vec3 prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * contrib;
}

void main() {
  vec3 a = tap(vec2(-2.0, 2.0)), b = tap(vec2(0.0, 2.0)), c = tap(vec2(2.0, 2.0));
  vec3 d = tap(vec2(-2.0, 0.0)), e = tap(vec2(0.0, 0.0)), f = tap(vec2(2.0, 0.0));
  vec3 g = tap(vec2(-2.0, -2.0)), h = tap(vec2(0.0, -2.0)), i = tap(vec2(2.0, -2.0));
  vec3 j = tap(vec2(-1.0, 1.0)), k = tap(vec2(1.0, 1.0));
  vec3 l = tap(vec2(-1.0, -1.0)), m = tap(vec2(1.0, -1.0));

  vec3 col;
  if (uFirst > 0.5) {
    // Partial Karis average over the five 2x2 blocks.
    vec3 c0 = karis((j + k + l + m) * 0.25);
    vec3 c1 = karis((a + b + d + e) * 0.25);
    vec3 c2 = karis((b + c + e + f) * 0.25);
    vec3 c3 = karis((d + e + g + h) * 0.25);
    vec3 c4 = karis((e + f + h + i) * 0.25);
    col = c0 * 0.5 + (c1 + c2 + c3 + c4) * 0.125;
    col = col / max(1.0 - luma(col), 1e-3);
    col = prefilter(col);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  fragColor = vec4(max(col, 0.0), 1.0);
}
