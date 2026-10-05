precision highp float;

attribute float aAlpha;
attribute vec3 aColor;

varying float vAlpha;
varying vec3 vColor;

void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
  vAlpha = aAlpha;
  vColor = aColor;
}
