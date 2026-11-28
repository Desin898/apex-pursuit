// 5C: bundled assets (esbuild loaders in build.mjs): geometry as bytes, textures as data URLs.
declare module '*.bin' {
  const bytes: Uint8Array;
  export default bytes;
}
declare module '*.webp' {
  const url: string;
  export default url;
}
