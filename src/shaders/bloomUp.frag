// 9-tap tent upsample of the coarser level, added to the current level.
precision highp float;

uniform sampler2D uLow;
uniform sampler2D uCur;
uniform vec2 uTexel;   // texel of uLow
uniform float uRadius;

in vec2 vUv;
out vec4 fragColor;

void main() {
  vec2 o = uTexel * uRadius;
  vec3 s = texture(uLow, vUv).rgb * 4.0;
  s += (texture(uLow, vUv + vec2(o.x, 0.0)).rgb + texture(uLow, vUv - vec2(o.x, 0.0)).rgb
      + texture(uLow, vUv + vec2(0.0, o.y)).rgb + texture(uLow, vUv - vec2(0.0, o.y)).rgb) * 2.0;
  s += texture(uLow, vUv + o).rgb + texture(uLow, vUv - o).rgb
     + texture(uLow, vUv + vec2(o.x, -o.y)).rgb + texture(uLow, vUv + vec2(-o.x, o.y)).rgb;
  fragColor = vec4(texture(uCur, vUv).rgb + s / 16.0, 1.0);
}
