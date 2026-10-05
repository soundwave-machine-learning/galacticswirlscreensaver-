// Fullscreen triangle/quad pass-through. Geometry is a 2x2 plane in clip space.
out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
