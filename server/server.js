// Lists & Boards server. Plain Node, no dependencies:
//   node server/server.js
// Environment:
//   PORT         port to listen on (default 8080)
//   HOST         address to bind (default 0.0.0.0, so other devices at home can reach it)
//   LB_DATA      path of the database file (default ./data/lists-boards.db)
//   LB_PASSWORD  optional passphrase; when set, the app asks for it once per browser

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { createOps } from './ops.js';
import { CalendarCache } from './ics.js';
import { addDays } from '../shared/dates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon' };

export function seed(ops, store) {
  if (store.all('domains').length || store.get('settings', 'main')) return;
  ops.run('settings.save', {});
  for (const [name, weight, color] of [['Work', 5, '#5b9cf5'], ['Learning', 4, '#4fb286'], ['Projects', 3, '#b48cf2'], ['Personal', 2, '#e8963a']]) {
    ops.run('domain.save', { name, weight, color });
  }
  ops.run('filter.save', { name: 'Priority 1', query: 'p1' });
  ops.run('filter.save', { name: 'Next 7 days', query: '7 days' });
  ops.run('filter.save', { name: 'Needs an estimate', query: 'no estimate & !subtask' });
  ops.run('filter.save', { name: 'Deadlines this week', query: 'deadline before: +8' });
}

export function createApp({ dataFile, password = '', fetchImpl } = {}) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const store = new Store(dataFile);
  const ops = createOps(store);
  const calendars = new CalendarCache({ fetchImpl });
  seed(ops, store);
  ops.maintenance();
  loadImports();

  // An import file dropped into the data folder (anything ending in
  // "-import.json") is loaded once at start-up, then renamed so it is not
  // read again.
  function loadImports() {
    if (dataFile === ':memory:') return;
    const dir = path.dirname(dataFile);
    for (const name of fs.readdirSync(dir)) {
      if (!/-import\.json$/.test(name)) continue;
      const file = path.join(dir, name);
      try {
        const out = ops.run('import.merge', JSON.parse(fs.readFileSync(file, 'utf8'))).result;
        fs.renameSync(file, file.replace(/\.json$/, '.loaded.json'));
        console.log(`Imported ${name}: ${out.added} tasks added, ${out.skipped} already here.`);
      } catch (err) {
        console.error(`Could not import ${name}: ${err.message}`);
      }
    }
  }

  const token = password ? crypto.createHmac('sha256', password).update('lists-and-boards').digest('hex') : '';
  const streams = new Set();
  const broadcast = () => {
    for (const res of streams) res.write(`data: ${store.rev}\n\n`);
  };

  let lastBackupDay = '';
  function backup() {
    const day = ops.today();
    if (day === lastBackupDay || dataFile === ':memory:') return;
    lastBackupDay = day;
    try {
      const dir = path.join(path.dirname(dataFile), 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${day}.db`);
      if (!fs.existsSync(file)) store.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const old = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
      for (const f of old.slice(0, Math.max(0, old.length - 14))) fs.unlinkSync(path.join(dir, f));
    } catch (err) {
      console.error('backup failed:', err.message);
    }
  }
  const tick = () => {
    try {
      const before = store.rev;
      ops.maintenance();
      if (store.rev !== before) broadcast();
      backup();
    } catch (err) {
      console.error('maintenance failed:', err);
    }
  };
  const timer = setInterval(tick, 30000);
  timer.unref();
  const beat = setInterval(() => { for (const res of streams) res.write(': keep-alive\n\n'); }, 25000);
  beat.unref();
  backup();

  const json = (res, code, body, headers = {}) => {
    const data = JSON.stringify(body);
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
    res.end(data);
  };
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > 20 * 1024 * 1024) {
          reject(new Error('request too large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch {
          reject(new Error('invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  const authed = (req) => {
    if (!token) return true;
    const m = /(?:^|;\s*)lb=([a-f0-9]+)/.exec(req.headers.cookie || '');
    if (!m || m[1].length !== token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(token));
  };

  function serveStatic(req, res, pathname) {
    let rel = pathname === '/' ? '/index.html' : pathname;
    const shared = rel.startsWith('/shared/');
    const base = path.join(ROOT, shared ? 'shared' : 'public');
    if (shared) rel = rel.slice('/shared'.length);
    const file = path.normalize(path.join(base, rel));
    if (!file.startsWith(base + path.sep)) return json(res, 403, { error: 'forbidden' });
    fs.readFile(file, (err, data) => {
      if (err) {
        if (!path.extname(rel)) return serveStatic(req, res, '/');
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('Not found');
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    });
  }

  async function api(req, res, url) {
    const p = url.pathname;
    if (p === '/api/login' && req.method === 'POST') {
      const body = await readBody(req);
      const given = crypto.createHmac('sha256', String(body.password || '')).update('lists-and-boards').digest('hex');
      if (token && !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token))) return json(res, 401, { error: 'Wrong passphrase' });
      return json(res, 200, { ok: true }, { 'set-cookie': `lb=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` });
    }
    if (!authed(req)) return json(res, 401, { error: 'login required' });

    if (p === '/api/sync' && req.method === 'GET') {
      return json(res, 200, { ...store.since(+url.searchParams.get('since') || 0), today: ops.today() });
    }
    if (p === '/api/op' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const out = ops.run(body.name, body.args);
        broadcast();
        return json(res, 200, { result: out.result ?? null, effects: out.effects, delta: { ...store.since(+body.since || 0), today: ops.today() } });
      } catch (err) {
        return json(res, 400, { error: String(err.message || err) });
      }
    }
    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`data: ${store.rev}\n\n`);
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    if (p === '/api/calendar' && req.method === 'GET') {
      const s = ops.settings();
      const from = url.searchParams.get('from') || ops.today();
      const to = url.searchParams.get('to') || addDays(from, 7);
      const out = await calendars.range(s.calendars, from, to, s.tz, url.searchParams.get('force') === '1');
      return json(res, 200, out);
    }
    if (p === '/api/activity' && req.method === 'GET') {
      return json(res, 200, { items: store.activity(Math.min(1000, +url.searchParams.get('limit') || 200)) });
    }
    if (p === '/api/export' && req.method === 'GET') {
      return json(res, 200, store.exportAll(), { 'content-disposition': `attachment; filename="lists-boards-${ops.today()}.json"` });
    }
    if (p === '/api/import' && req.method === 'POST') {
      try {
        store.importAll(await readBody(req));
        broadcast();
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, { error: String(err.message || err) });
      }
    }
    return json(res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      api(req, res, url).catch((err) => {
        console.error(err);
        if (!res.headersSent) json(res, 500, { error: 'server error' });
      });
    } else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, decodeURIComponent(url.pathname));
    else json(res, 405, { error: 'method not allowed' });
  });

  return {
    server,
    store,
    ops,
    close() {
      clearInterval(timer);
      clearInterval(beat);
      for (const res of streams) res.end();
      server.close();
      store.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = +process.env.PORT || 8080;
  const host = process.env.HOST || '0.0.0.0';
  const dataFile = path.resolve(process.env.LB_DATA || path.join(ROOT, 'data', 'lists-boards.db'));
  const app = createApp({ dataFile, password: process.env.LB_PASSWORD || '' });
  app.server.listen(port, host, () => {
    console.log(`Lists & Boards is running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    console.log(`Data file: ${dataFile}`);
  });
  const stop = () => {
    app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
