precision highp float;

varying vec3 vColor;
varying float vAlpha;
varying float vGlow;

void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 26.0);
  float halo = exp(-r2 * 5.0) * (0.16 + 0.12 * vGlow);
  float a = (core + halo) * (1.0 - smoothstep(0.7, 1.0, r2)) * vAlpha;
  gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.5) * a, 0.0);
}
