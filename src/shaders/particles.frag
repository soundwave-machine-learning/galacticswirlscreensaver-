precision highp float;

uniform float uSoftness;   // 0 = crisp star core, 1 = soft dust mote

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * mix(9.0, 3.0, uSoftness));
  float edge = 1.0 - smoothstep(0.6, 1.0, r2);
  float a = core * edge * vAlpha;
  gl_FragColor = vec4(vColor * a, a);
}
