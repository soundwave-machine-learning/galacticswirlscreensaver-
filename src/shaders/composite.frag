precision highp float;

uniform sampler2D uScene;
uniform float uExposure;
uniform float uTime;

in vec2 vUv;
out vec4 fragColor;

vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// Interleaved gradient noise - breaks up banding in deep dark gradients.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec3 col = texture(uScene, vUv).rgb * uExposure;
  col = linearToSrgb(col);
  col += (ign(gl_FragCoord.xy + fract(uTime * 7.0) * 61.0) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
