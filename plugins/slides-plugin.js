// Vite plugin for the deck.
//  1. `virtual:slides`  an array of { file, html } built from the slides folder.
//  2. Hot update        a change in slides/ swaps the slides without a page reload.
//  3. /api/slides       small local API the editor uses to read and write files.
import fs from 'node:fs';
import path from 'node:path';
import { toSlide } from './slide-format.js';

const VIRTUAL_ID = 'virtual:slides';
const RESOLVED_ID = '\0' + VIRTUAL_ID;
const FILE_RE = /^[a-z0-9][a-z0-9._-]*\.(html|md)$/i;

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const MAX_UPLOAD = 30 * 1024 * 1024;

const NEW_HTML =`<section data-layout="blank">
  <h2>New slide</h2>
  <p>Lorem ipsum dolor sit amet.</p>

  <aside class="notes">Speaker notes go here.</aside>
</section>
`;
const NEW_MD = `<!-- .slide: data-transition="fade" -->

## New slide

Lorem ipsum dolor sit amet.

Note: Speaker notes go here.
`;

export default function slidesPlugin() {
  let slidesDir;
  let assetsDir;

  const listFiles = () =>
    fs.existsSync(slidesDir)
      ? fs
          .readdirSync(slidesDir)
          .filter((f) => FILE_RE.test(f) && fs.statSync(path.join(slidesDir, f)).isFile())
          .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
      : [];

  const readSlides = () =>
    listFiles().map((file) => toSlide(file, fs.readFileSync(path.join(slidesDir, file), 'utf8')));

  const isSlideFile = (file) => {
    const rel = path.relative(slidesDir, file);
    return !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.includes(path.sep) && FILE_RE.test(rel);
  };

  // --- file helpers for the API -------------------------------------------

  const safePath = (name) => {
    if (typeof name !== 'string' || !FILE_RE.test(name) || name !== path.basename(name)) {
      throw httpError(400, 'Invalid file name');
    }
    return path.join(slidesDir, name);
  };

  const stripPrefix = (name) => name.replace(/^\d+[-_]?/, '');
  const pad = (n, total) => String(n).padStart(Math.max(2, String(total).length), '0');

  // Renames every file so its numeric prefix matches its place in `order`.
  const renumber = (order) => {
    const renames = order
      .map((file, i) => ({ from: file, to: `${pad(i + 1, order.length)}-${stripPrefix(file) || 'slide.html'}` }))
      .filter((r) => r.from !== r.to);
    // Two passes through temporary names, so swaps never collide.
    renames.forEach((r, i) => {
      r.tmp = `.tmp-${process.pid}-${i}`;
      fs.renameSync(path.join(slidesDir, r.from), path.join(slidesDir, r.tmp));
    });
    renames.forEach((r) => fs.renameSync(path.join(slidesDir, r.tmp), path.join(slidesDir, r.to)));
    return Object.fromEntries(renames.map((r) => [r.from, r.to]));
  };

  const slugify = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'slide';

  const uniqueName = (base, ext) => {
    const taken = new Set(listFiles().map((f) => stripPrefix(f)));
    let name = `${base}.${ext}`;
    for (let i = 2; taken.has(name); i++) name = `${base}-${i}.${ext}`;
    return name;
  };

  // Puts `file` right after `after` (or at the end) and renumbers. Returns the final name.
  const placeAfter = (file, after) => {
    const order = listFiles().filter((f) => f !== file);
    const at = after ? order.indexOf(after) : -1;
    order.splice(at === -1 ? order.length : at + 1, 0, file);
    const map = renumber(order);
    return map[file] || file;
  };

  const api = {
    list: () => ({ slides: listFiles() }),

    read: (file) => ({ file, content: fs.readFileSync(safePath(file), 'utf8') }),

    write: (file, body) => {
      if (typeof body.content !== 'string') throw httpError(400, 'Missing content');
      const target = safePath(file);
      if (!fs.existsSync(target)) throw httpError(404, 'No such slide');
      fs.writeFileSync(target, body.content, 'utf8');
      return { file };
    },

    create: (body) => {
      const ext = body.ext === 'md' ? 'md' : 'html';
      const name = `00-${uniqueName(slugify(body.name), ext)}`;
      fs.mkdirSync(slidesDir, { recursive: true });
      const content = typeof body.content === 'string' ? body.content : ext === 'md' ? NEW_MD : NEW_HTML;
      fs.writeFileSync(safePath(name), content, { encoding: 'utf8', flag: 'wx' });
      return { file: placeAfter(name, body.after) };
    },

    duplicate: (file) => {
      const src = safePath(file);
      const ext = path.extname(file).slice(1);
      const base = stripPrefix(file).replace(/\.(html|md)$/i, '').replace(/-copy(-\d+)?$/, '');
      const name = `00-${uniqueName(`${base}-copy`, ext)}`;
      fs.copyFileSync(src, safePath(name), fs.constants.COPYFILE_EXCL);
      return { file: placeAfter(name, file) };
    },

    // Deleted slides are moved to slides/.trash so a wrong click is recoverable.
    remove: (file) => {
      const src = safePath(file);
      const trash = path.join(slidesDir, '.trash');
      fs.mkdirSync(trash, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.renameSync(src, path.join(trash, `${stamp}__${file}`));
      renumber(listFiles());
      return { ok: true };
    },

    reorder: (body) => {
      const current = listFiles();
      const order = Array.isArray(body.order) ? body.order : [];
      const same = order.length === current.length && current.every((f) => order.includes(f));
      if (!same) throw httpError(409, 'Slide list is out of date, reload the editor');
      return { renamed: renumber(order), slides: listFiles() };
    },
  };

  // --- images for the editor: list what is in assets/, save an upload there ---

  const listAssets = () =>
    fs.existsSync(assetsDir)
      ? fs
          .readdirSync(assetsDir)
          .filter((f) => IMAGE_RE.test(f))
          .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
      : [];

  const handleAssets = async (req) => {
    if (req.method === 'GET') return { assets: listAssets() };
    if (req.method !== 'POST') throw httpError(404, 'Unknown endpoint');

    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) throw httpError(403, 'Cross-origin request refused');
    if (!req.headers['x-fogya-upload']) throw httpError(403, 'Missing upload header');

    const wanted = new URL(req.url, 'http://localhost').searchParams.get('name') || 'image.png';
    const ext = (wanted.match(IMAGE_RE)?.[1] || '').toLowerCase();
    if (!ext) throw httpError(415, 'Only png, jpg, gif, webp, avif and svg images');

    const base = slugify(wanted.replace(IMAGE_RE, ''));
    fs.mkdirSync(assetsDir, { recursive: true });
    let name = `${base}.${ext}`;
    for (let i = 2; fs.existsSync(path.join(assetsDir, name)); i++) name = `${base}-${i}.${ext}`;

    fs.writeFileSync(path.join(assetsDir, name), await readBuffer(req, MAX_UPLOAD), { flag: 'wx' });
    return { name, url: `/assets/${name}` };
  };

  const handle = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); // after /api/slides
    const [file, action] = parts;
    const method = req.method;

    if (method !== 'GET') {
      // Only this machine may write files, and only from this dev server's own pages.
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw httpError(403, 'Cross-origin request refused');
      if (!/^application\/json/.test(req.headers['content-type'] || '')) throw httpError(415, 'JSON only');
    }
    const body = method === 'GET' ? {} : await readJson(req);

    if (!file) {
      if (method === 'GET') return api.list();
      if (method === 'POST') return api.create(body);
    } else if (file === '_reorder' && method === 'POST') {
      return api.reorder(body);
    } else if (action === 'duplicate' && method === 'POST') {
      return api.duplicate(file);
    } else if (!action) {
      if (method === 'GET') return api.read(file);
      if (method === 'PUT') return api.write(file, body);
      if (method === 'DELETE') return api.remove(file);
    }
    throw httpError(404, 'Unknown endpoint');
  };

  return {
    name: 'fogya-slides',

    configResolved(config) {
      slidesDir = path.resolve(config.root, 'slides');
      assetsDir = path.resolve(config.root, 'assets');
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },

    load(id) {
      if (id !== RESOLVED_ID) return;
      return `export default ${JSON.stringify(readSlides())};`;
    },

    configureServer(server) {
      const refresh = (file) => {
        if (!isSlideFile(file)) return;
        server.ws.send({ type: 'custom', event: 'slides:files', data: { slides: listFiles() } });
      };
      server.watcher.add(slidesDir);
      server.watcher.on('add', refresh);
      server.watcher.on('unlink', refresh);
      server.watcher.on('change', refresh);

      server.middlewares.use('/api/slides', (req, res) => {
        handle(req, res)
          .then((data) => send(res, 200, data))
          .catch((err) => {
            // A file that was just renamed or deleted is "not found", not a server fault.
            const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
            send(res, status, { error: err.code === 'ENOENT' ? 'No such slide' : err.message });
          });
      });

      server.middlewares.use('/api/assets', (req, res) => {
        handleAssets(req)
          .then((data) => send(res, 200, data))
          .catch((err) => send(res, err.status || 500, { error: err.message }));
      });

      // /editor (no trailing slash) should open the editor page.
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/editor' || req.url?.startsWith('/editor?')) req.url = req.url.replace('/editor', '/editor/');
        next();
      });
    },

    // A saved .html file would normally make Vite reload the whole page.
    // Slide files are data for virtual:slides, so the change is routed to that
    // module instead. src/main.js accepts the update and swaps the slides in place.
    hotUpdate({ file }) {
      if (this.environment.name !== 'client' || !isSlideFile(file)) return;
      const mod = this.environment.moduleGraph.getModuleById(RESOLVED_ID);
      return mod ? [mod] : [];
    },
  };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function readBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(httpError(413, 'Image is too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 5_000_000) reject(httpError(413, 'Too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(httpError(400, 'Bad JSON'));
      }
    });
    req.on('error', reject);
  });
}
