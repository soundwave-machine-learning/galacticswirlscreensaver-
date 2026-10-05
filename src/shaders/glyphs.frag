precision highp float;

uniform sampler2D uAtlas;

varying vec2 vUv;
varying float vAlpha;
varying float vHue;

void main() {
  float a = texture2D(uAtlas, vUv).a * vAlpha;
  if (a < 0.001) discard;
  vec3 col = mix(vec3(1.0, 0.87, 0.64), vec3(0.62, 0.9, 1.0), step(0.5, vHue));
  gl_FragColor = vec4(col * a, 0.0);
}
