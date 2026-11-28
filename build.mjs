// Build script.
//   node build.mjs            → dist/index.html           one self-contained file (Three.js bundled in); works offline
//   node build.mjs --play     → also copies it to play/ApexPursuit.html (the file friends double-click)
//   node build.mjs --cdn      → dist/cdn/index.html       same game, Three.js loaded from a CDN via an import map (small file)
//   node build.mjs --serve    → dev server with rebuild-on-save at http://localhost:5173
import { build, context } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const THREE_VERSION = JSON.parse(readFileSync('node_modules/three/package.json', 'utf8')).version;
const template = readFileSync('index.html', 'utf8');
const ART = existsSync('art') ? readdirSync('art').filter((f) => f.endsWith('.webp')) : [];
// The single-file build carries the key art inline so it still works offline / from the relay.
const inlineArt = () => {
  const map = Object.fromEntries(ART.map((f) => [f.replace(/\.webp$/, ''), `data:image/webp;base64,${readFileSync(`art/${f}`).toString('base64')}`]));
  return `<script>window.__APEX_ART__=${JSON.stringify(map)}</script>`;
};
const args = process.argv.slice(2);
// Escape closing tags so the script can sit inline. (Replacements below use functions, because
// minified code is full of `$` sequences that String.replace would otherwise expand.)
const inline = (js) => js.replace(/<\/script/gi, '<\\/script');

// 5C: the bundled packs (assets/): geometry as bytes, textures as data URLs
const loader = { '.bin': 'binary', '.webp': 'dataurl' };
const common = { entryPoints: ['src/main.ts'], bundle: true, minify: true, target: 'es2020', legalComments: 'none', write: false, loader };

async function buildBundled() {
  const r = await build({ ...common, format: 'iife' });
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/index.html', template.replace('<!--APP-->', () => `${inlineArt()}\n<script>${inline(r.outputFiles[0].text)}</script>`));
  console.log(`dist/index.html  ${(r.outputFiles[0].text.length / 1024).toFixed(0)} kB of script (self-contained)`);
}

async function buildCdn() {
  const r = await build({ ...common, format: 'esm', external: ['three', 'three/examples/jsm/*'] });
  const base = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;
  const map = { imports: { three: `${base}/build/three.module.min.js`, 'three/examples/jsm/': `${base}/examples/jsm/` } };
  // If the engine can't be fetched the module never runs, so show a plain message instead of a black page.
  const guard = `<script>window.addEventListener('error',function(e){if(e.target&&e.target.tagName==='SCRIPT'||/import|module|three/i.test(e.message||'')){var b=document.getElementById('boot-error');if(b){b.hidden=false;document.getElementById('boot-msg').textContent='The 3D engine (three.js) could not be loaded from the CDN. Check the connection and reload.';}}},true);</script>`;
  mkdirSync('dist/cdn/art', { recursive: true });
  for (const f of ART) copyFileSync(`art/${f}`, `dist/cdn/art/${f}`);
  writeFileSync(
    'dist/cdn/index.html',
    template.replace('<!--APP-->', () => `${guard}\n<script type="importmap">${JSON.stringify(map)}</script>\n<script type="module">${inline(r.outputFiles[0].text)}</script>`),
  );
  console.log(`dist/cdn/index.html  ${(r.outputFiles[0].text.length / 1024).toFixed(0)} kB of script (three@${THREE_VERSION} from jsDelivr)`);
}

if (args.includes('--serve')) {
  mkdirSync('dist/dev/art', { recursive: true });
  for (const f of ART) copyFileSync(`art/${f}`, `dist/dev/art/${f}`);
  writeFileSync('dist/dev/index.html', template.replace('<!--APP-->', '<script src="app.js"></script>'));
  const ctx = await context({ entryPoints: ['src/main.ts'], bundle: true, sourcemap: true, target: 'es2020', format: 'iife', outfile: 'dist/dev/app.js', loader });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'dist/dev', port: 5173 });
  console.log(`Apex Pursuit dev server: http://localhost:${port}`);
} else if (args.includes('--cdn')) {
  await buildCdn();
} else {
  await buildBundled();
  // --play: also refresh the prebuilt copy that ships in the repository for friends
  if (args.includes('--play')) {
    mkdirSync('play', { recursive: true });
    copyFileSync('dist/index.html', 'play/ApexPursuit.html');
    console.log('play/ApexPursuit.html updated');
  }
}
