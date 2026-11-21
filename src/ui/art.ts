// Where the key art lives. The single-file build injects the images as data URIs
// (window.__APEX_ART__); the published page loads them as its own files next to index.html.
export type ArtKey = 'hero-16x9' | 'hero-9x16' | 'load-1' | 'load-2';
export function artUrl(key: ArtKey): string {
  const inline = (window as unknown as { __APEX_ART__?: Record<string, string> }).__APEX_ART__;
  return inline && inline[key] ? inline[key] : `art/${key}.webp`;
}
