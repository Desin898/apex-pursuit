// ─────────────────────────────────────────────────────────────────────────────
// Host an online race (4C.2). Started by "Host online race.bat" / host-online.sh.
//
//   node server/host.mjs            asks: Internet (friends at home) or Same Wi-Fi
//   node server/host.mjs --internet
//   node server/host.mjs --lan
//
// It starts the relay (server/relay.mjs). For Internet it also starts a free Cloudflare
// "quick tunnel" (cloudflared): a temporary public https address that forwards to the relay on
// this PC. No account, no router settings. cloudflared is downloaded once, with your OK, from
// Cloudflare's official GitHub releases into tools/bin/. The address changes every time.
// ─────────────────────────────────────────────────────────────────────────────
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, chmodSync, renameSync, unlinkSync } from 'node:fs';
import { get } from 'node:https';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { networkInterfaces, platform, arch } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = Number(process.env.PORT) || 8080;
const ROOM = (process.env.ROOM || 'friends').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'friends';

const ask = (q) =>
  new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => {
      rl.close();
      res(a.trim());
    });
  });

function copy(text) {
  try {
    const p = platform();
    const r = p === 'win32' ? spawnSync('clip', { input: text }) : p === 'darwin' ? spawnSync('pbcopy', { input: text }) : spawnSync('xclip', ['-selection', 'clipboard'], { input: text });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}

function open(url) {
  const p = platform();
  try {
    if (p === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else spawn(p === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* the link is printed anyway */
  }
}

/** cloudflared's release file for this computer */
function cloudflaredAsset() {
  const p = platform();
  const a = arch();
  if (p === 'win32') return { file: 'cloudflared.exe', asset: a === 'arm64' ? 'cloudflared-windows-arm64.exe' : 'cloudflared-windows-amd64.exe' };
  if (p === 'darwin') return { file: 'cloudflared', asset: a === 'arm64' ? 'cloudflared-darwin-arm64.tgz' : 'cloudflared-darwin-amd64.tgz', tgz: true };
  return { file: 'cloudflared', asset: a === 'arm64' ? 'cloudflared-linux-arm64' : 'cloudflared-linux-amd64' };
}

function download(url, dest, hops = 0) {
  return new Promise((res, rej) => {
    get(url, { headers: { 'user-agent': 'apex-pursuit-host' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && hops < 6) {
        r.resume();
        res(download(r.headers.location, dest, hops + 1));
        return;
      }
      if (r.statusCode !== 200) {
        r.resume();
        rej(new Error(`download failed (HTTP ${r.statusCode})`));
        return;
      }
      const total = Number(r.headers['content-length']) || 0;
      let got = 0;
      let last = 0;
      const out = createWriteStream(dest);
      r.on('data', (c) => {
        got += c.length;
        const pct = total ? Math.floor((got / total) * 100) : 0;
        if (pct >= last + 10) {
          last = pct;
          process.stdout.write(`  ${pct}%`);
        }
      });
      r.pipe(out);
      out.on('finish', () => {
        process.stdout.write('\n');
        out.close(() => res());
      });
      out.on('error', rej);
    }).on('error', rej);
  });
}

/** find cloudflared: on PATH, or in tools/bin; download it (with permission) if missing */
async function findCloudflared() {
  const onPath = spawnSync(platform() === 'win32' ? 'where' : 'which', ['cloudflared'], { encoding: 'utf8' });
  if (onPath.status === 0 && onPath.stdout.trim()) return onPath.stdout.trim().split(/\r?\n/)[0];
  const { file, asset, tgz } = cloudflaredAsset();
  const bin = join(root, 'tools', 'bin');
  const dest = join(bin, file);
  if (existsSync(dest)) return dest;
  console.log('');
  console.log('  To give you a link friends can use from home, this uses Cloudflare\'s free "cloudflared"');
  console.log('  tool (about 40 MB, downloaded once from github.com/cloudflare/cloudflared into tools\\bin).');
  const ok = (await ask('  Download it now? [Y/n] ')).toLowerCase();
  if (ok === 'n' || ok === 'no') return null;
  mkdirSync(bin, { recursive: true });
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
  console.log(`  Downloading ${asset}…`);
  const tmp = dest + '.part';
  try {
    if (tgz) {
      await download(url, tmp + '.tgz');
      spawnSync('tar', ['-xzf', tmp + '.tgz', '-C', bin]);
      unlinkSync(tmp + '.tgz');
    } else {
      await download(url, tmp);
      renameSync(tmp, dest);
    }
    if (platform() !== 'win32') chmodSync(dest, 0o755);
    return dest;
  } catch (e) {
    console.log(`  Couldn't download cloudflared: ${e.message}`);
    try {
      unlinkSync(tmp);
    } catch {
      /* nothing to clean */
    }
    return null;
  }
}

function startRelay() {
  const relay = spawn(process.execPath, [join(here, 'relay.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  relay.stdout.on('data', () => {}); // its own banner is replaced by ours
  relay.on('exit', (code) => {
    console.log(`\n  The race server stopped (code ${code}).`);
    process.exit(code ?? 1);
  });
  return relay;
}

function lanLinks() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(`http://${n.address}:${PORT}/?room=${ROOM}`);
  return out;
}

async function main() {
  let mode = process.argv.includes('--internet') ? 'internet' : process.argv.includes('--lan') ? 'lan' : '';
  console.log('');
  console.log('  APEX PURSUIT · host an online race');
  console.log('  ──────────────────────────────────');
  if (!mode) {
    console.log('  1  Internet: friends play from their own homes (recommended)');
    console.log('  2  Same Wi-Fi: everyone on this network');
    const a = await ask('  Choose 1 or 2 [1]: ');
    mode = a === '2' ? 'lan' : 'internet';
  }
  const relay = startRelay();
  const mine = `http://localhost:${PORT}/?room=${ROOM}`;
  await new Promise((r) => setTimeout(r, 600));

  if (mode === 'lan') {
    console.log('');
    console.log('  Race server running. Keep this window open while you play.');
    console.log(`  You:      ${mine}`);
    for (const l of lanLinks()) console.log(`  Friends:  ${l}`);
    console.log('  (If Windows asks about the firewall, allow private networks.)');
    open(mine);
    return;
  }

  const cf = await findCloudflared();
  if (!cf) {
    console.log('');
    console.log('  No internet link without cloudflared. The race server still runs for this Wi-Fi:');
    for (const l of lanLinks()) console.log(`  Friends on your Wi-Fi:  ${l}`);
    console.log('  Other ways for friends at home: README → "Play online with friends at home".');
    open(mine);
    return;
  }
  console.log('  Opening a public link (this takes a few seconds)…');
  const tunnel = spawn(cf, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let shown = false;
  const scan = (buf) => {
    const m = String(buf).match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/i); // not api.trycloudflare.com (that's in its error lines)
    if (m && !shown) {
      shown = true;
      const link = `${m[0]}/?room=${ROOM}`;
      const copied = copy(link);
      console.log('');
      console.log('  ┌──────────────────────────────────────────────────────────────');
      console.log('  │ Send this link to your friends' + (copied ? ' (it is already copied):' : ':'));
      console.log(`  │   ${link}`);
      console.log('  │ They open it in Chrome or Edge, or paste it into the game:');
      console.log('  │   Online with friends → Join a friend.');
      console.log('  └──────────────────────────────────────────────────────────────');
      console.log('  Keep this window open while you race. Closing it ends the race server.');
      console.log('  (A new link is made every time you start hosting.)');
      open(mine);
    }
  };
  tunnel.stdout.on('data', scan);
  tunnel.stderr.on('data', scan);
  let ended = false;
  tunnel.on('exit', (code) => {
    ended = true;
    if (!shown) console.log(`\n  The tunnel could not start (code ${code}). Check your internet connection and try again.`);
    else console.log('\n  The public link closed.');
  });
  setTimeout(() => {
    if (!shown && !ended) console.log('  Still waiting for Cloudflare… (a firewall or antivirus can block cloudflared)');
  }, 20000);
  const stop = () => {
    tunnel.kill();
    relay.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();
