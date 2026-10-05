precision highp float;

uniform float uOpacity;

varying float vAlpha;
varying vec3 vColor;

void main() {
  float a = vAlpha * uOpacity;
  gl_FragColor = vec4(vColor * a, 0.0);
}
