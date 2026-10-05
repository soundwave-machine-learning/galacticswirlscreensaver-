import noise from '../shaders/noise.glsl?raw';

const CHUNKS: Record<string, string> = { noise };

/**
 * Resolves project-local `#include <name>` directives before the source is
 * handed to three.js (which would otherwise try to resolve them against its
 * own ShaderChunk library), and prepends `#define`s.
 */
export function buildShader(src: string, defines: Record<string, string | number> = {}): string {
  const header = Object.entries(defines)
    .map(([k, v]) => `#define ${k} ${v}`)
    .join('\n');
  const body = src.replace(/^[ \t]*#include +<([\w-]+)>/gm, (match, name: string) => {
    const chunk = CHUNKS[name];
    return chunk ?? match;
  });
  return header ? `${header}\n${body}` : body;
}
