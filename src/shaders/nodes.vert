// Bright nodes. Positions are projected on the CPU (the node network needs
// them there anyway to decide which nodes to connect).
precision highp float;

attribute vec4 aNode;   // x: alpha, y: size px, z: palette index, w: link glow

uniform float uBrightness;

varying vec3 vColor;
varying float vAlpha;
varying float vGlow;

vec3 palette(float i) {
  if (i < 0.5) return vec3(1.0, 0.86, 0.58);   // pale gold
  if (i < 1.5) return vec3(0.58, 0.9, 1.0);    // cyan
  if (i < 2.5) return vec3(0.42, 0.95, 0.86);  // teal
  if (i < 3.5) return vec3(0.5, 0.62, 1.0);    // deep blue
  return vec3(1.0, 0.5, 0.3);                  // ember
}

void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
  gl_PointSize = aNode.y * (1.0 + 0.6 * aNode.w);
  vColor = palette(aNode.z);
  vAlpha = aNode.x * uBrightness * (1.0 + 0.8 * aNode.w);
  vGlow = aNode.w;
  if (vAlpha < 0.002) gl_PointSize = 0.0;
}
