// npm run pdf  ->  fogya-tech-deck.pdf (one page per slide, 1920x1080)
//
// Starts the deck on a free local port, lets decktape click through every
// slide in a headless browser, and writes the PDF. Works offline: it uses the
// Chrome or Edge already installed on this computer.
//
//   npm run pdf                  default file name
//   npm run pdf -- my-talk.pdf   custom file name
//   CHROME_PATH=... npm run pdf  use a specific browser

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(root, process.argv[2] || 'fogya-tech-deck.pdf');

function findBrowser() {
  const env = process.env;
  const candidates = [
    env.CHROME_PATH,
    // Windows
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ];
  return candidates.find((p) => p && existsSync(p));
}

const browser = findBrowser();
if (!browser) {
  console.error('No Chrome or Edge found. Set CHROME_PATH to the browser executable and run again.');
  process.exit(1);
}

const server = await createServer({ root, logLevel: 'warn', server: { port: 5199, strictPort: false } });
await server.listen();
const { port } = server.httpServer.address();
// ?export: no animations, background jumps straight to each frame.
const url = `http://127.0.0.1:${port}/?export`;

const decktape = createRequire(import.meta.url).resolve('decktape/decktape.js');
const args = [decktape, 'reveal', '--size', '1920x1080', '--pause', '400', '--load-pause', '1500', '--chrome-path', browser, url, output];

console.log(`Exporting ${url}\n  with ${browser}\n  to   ${output}\n`);

const child = spawn(process.execPath, args, { stdio: 'inherit' });
child.on('exit', async (code) => {
  await server.close();
  if (code === 0) console.log(`\nDone: ${output}`);
  process.exit(code ?? 1);
});
