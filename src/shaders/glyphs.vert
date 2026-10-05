// Tiny numeric markers and glyphs, engraved along the matrix geometry.
// Each instance lives a long, individually random cycle: it appears at a
// tick or ring intersection, holds, fades, and returns elsewhere later.

precision highp float;

attribute vec4 aGlyph;   // x: phase seed, y: life rand, z: placement seed, w: rank

uniform float uTime;
uniform vec2 uAspect;
uniform vec4 uCamera;
uniform vec2 uCenter;
uniform float uRotation;
uniform float uTwist;
uniform float uVortexRadius;
uniform float uOpacity;
uniform float uDensity;
uniform vec2 uGrid;        // atlas columns, rows
uniform float uCells;      // used atlas cells
uniform float uCellAspect; // cell width / height
uniform float uSize;       // glyph height, field units

varying vec2 vUv;
varying float vAlpha;
varying float vHue;

const float PI = 3.14159265359;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float falloff(float r) {
  float x = r / max(uVortexRadius, 1e-3);
  return 1.0 / (1.0 + x * x * (0.6 + 0.4 * x));
}

void main() {
  float life = mix(28.0, 85.0, aGlyph.y);
  float t = uTime / life + aGlyph.x * 13.0;
  float cycle = floor(t);
  float age = fract(t);

  float h1 = hash11(cycle * 1.91 + aGlyph.z * 97.3);
  float h2 = hash11(cycle * 3.17 + aGlyph.z * 41.9);
  float h3 = hash11(cycle * 5.03 + aGlyph.x * 63.1);

  // Placement: outer tick scale (every 10 degrees) or a ring/spoke crossing.
  float r, theta;
  if (h2 < 0.45) {
    r = 1.08 + 0.05;
    theta = floor(h3 * 36.0) * (PI / 18.0);
  } else {
    float ring = 2.0 + floor(h2 * 6.0);
    r = 0.16 * pow(1.32, ring) + 0.012;
    theta = floor(h3 * 24.0) * (PI / 12.0) + 0.03;
  }

  // Follow the same partial rotation as the matrix geometry.
  float gridRot = uRotation * 0.5 + uTwist * falloff(r) * 0.3;
  float ang = theta + gridRot;
  vec2 anchor = r * vec2(cos(ang), sin(ang));

  // Read outward along the radius; flip on the left so text is never upside down.
  bool flip = cos(ang + uCamera.w) < 0.0;
  float orient = flip ? ang + PI : ang;
  vec2 corner = position.xy;            // x 0..1 along text, y -0.5..0.5
  vec2 local = vec2(flip ? corner.x - 1.0 : corner.x, corner.y);
  local *= vec2(uSize * uCellAspect, uSize);
  vec2 world = anchor + rot(local, orient) + uCenter;

  vec2 screen = rot((world - uCamera.xy) * uCamera.z, uCamera.w);
  gl_Position = vec4(screen / uAspect, 0.0, 1.0);

  float cell = floor(h1 * uCells);
  vec2 cellXY = vec2(mod(cell, uGrid.x), floor(cell / uGrid.x));
  vUv = (cellXY + vec2(corner.x, 0.5 - corner.y)) / uGrid;
  vUv.y = 1.0 - vUv.y;

  float visible = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.42, 0.56, age));
  float cull = 1.0 - smoothstep(uDensity - 0.08, uDensity, aGlyph.w);
  vAlpha = visible * cull * uOpacity * (0.6 + 0.4 * h3);
  vHue = h1;
}
