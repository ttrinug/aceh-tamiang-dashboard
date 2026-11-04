// Local admin server: the dashboard at /, the admin page at /admin/, and a small JSON API
// that runs scripts/admin_tool.py and edits the files in config/.
// Usage: node scripts/admin-server.mjs [port]   (default 8081)
//
// It listens on 127.0.0.1 only, so nothing is reachable from other computers. Every config
// write first copies the old file to config/backup/. Nothing is published or pushed.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.argv[2]) || 8081;
const inbox = join(root, 'for claude');
const python = [join(root, '.venv/Scripts/python.exe'), join(root, '.venv/bin/python')].find(existsSync);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};
// Only these parts of the project are served; raw data and the owner's folder are not.
const servable = ['index.html', 'assets/', 'config/', 'data/web/', 'admin/', 'templates/'];
const sourceTypes = ['.shp', '.gpkg', '.geojson', '.tif', '.tiff', '.xlsx'];

// ------------------------------------------------------------ JSON files

// Pretty-prints JSON, keeping short objects and arrays on one line so the config files stay
// readable and diffs stay small.
function pretty(value, indent = '') {
  const inline = (v) => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
    const entries = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`);
    return entries.length ? `{ ${entries.join(', ')} }` : '{}';
  };
  const flat = inline(value);
  if (value === null || typeof value !== 'object' || flat.length + indent.length <= 140) return flat;
  const inner = indent + '  ';
  if (Array.isArray(value)) return `[\n${value.map((v) => inner + pretty(v, inner)).join(',\n')}\n${indent}]`;
  return `{\n${Object.entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${pretty(v, inner)}`).join(',\n')}\n${indent}}`;
}

const configPath = (name) => join(root, 'config', `${name}.json`);
const readConfig = async (name) => JSON.parse(await readFile(configPath(name), 'utf8'));

async function writeConfig(name, data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await mkdir(join(root, 'config/backup'), { recursive: true });
  await copyFile(configPath(name), join(root, 'config/backup', `${name}-${stamp}.json`));
  await writeFile(configPath(name), pretty(data) + '\n', 'utf8');
}

// ------------------------------------------------------------ Python jobs

// Runs admin_tool.py. The job object fills in as it runs: progress lines in log, then the
// tool's JSON result (its last line of output) and a status of done or failed.
function runTool(args, input) {
  const job = { status: 'running', log: [], result: null };
  job.finished = new Promise((done) => {
    const child = spawn(python, [join(root, 'scripts/admin_tool.py'), ...args], { cwd: root });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => job.log.push(...String(chunk).split(/\r?\n/).filter(Boolean)));
    child.on('close', () => {
      try {
        job.result = JSON.parse(stdout.trim().split(/\r?\n/).pop());
      } catch {
        job.result = { ok: false, error: 'The tool gave no result; see the log.' };
      }
      job.status = job.result.ok ? 'done' : 'failed';
      done(job);
    });
    child.stdin.end(input ? JSON.stringify(input) : '');
  });
  return job;
}

// Processing can take minutes, so it runs as a job the admin page polls.
const jobs = new Map();
let nextJob = 1;

// ------------------------------------------------------------ API

async function listInbox(dir = inbox) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listInbox(full));
    else if (sourceTypes.includes(extname(entry.name).toLowerCase())) {
      files.push({ path: relative(inbox, full).split(sep).join('/'), size: (await stat(full)).size });
    }
  }
  return files;
}

const validId = (id) => typeof id === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id);

// Adds or replaces options by id in one of the cards.json lists.
function upsert(list, items) {
  for (const item of items) {
    const index = list.findIndex((o) => o.id === item.id);
    if (index >= 0) list[index] = item;
    else list.push(item);
  }
}

const api = {
  'GET /api/state': async () => ({
    layers: await readConfig('layers'),
    cards: await readConfig('cards'),
    text: await readConfig('text'),
    inbox: existsSync(inbox) ? await listInbox() : []
  }),

  'POST /api/inspect': async (body) => (await runTool(['inspect', body.path]).finished).result,

  'POST /api/jobs': async (body) => {
    if (!validId(body.id)) throw new Error('The dataset id must be lower-case letters, digits and hyphens.');
    const id = String(nextJob++);
    jobs.set(id, runTool(['process'], body));
    return { job: id };
  },

  // Adds or updates a dataset in layers.json, with any chart and table options in cards.json.
  'POST /api/datasets': async (body) => {
    const { dataset, chartOptions = [], tableOptions = [] } = body;
    if (!validId(dataset?.id)) throw new Error('The dataset id must be lower-case letters, digits and hyphens.');
    const layers = await readConfig('layers');
    if (!layers.groups.some((g) => g.id === dataset.group)) throw new Error(`Unknown group ${dataset.group}.`);
    const index = layers.datasets.findIndex((d) => d.id === dataset.id);
    if (index >= 0) layers.datasets[index] = { ...layers.datasets[index], ...dataset };
    else layers.datasets.push(dataset);
    await writeConfig('layers', layers);
    if (chartOptions.length || tableOptions.length) {
      const cards = await readConfig('cards');
      upsert(cards.chartOptions, chartOptions);
      upsert(cards.tableOptions, tableOptions);
      await writeConfig('cards', cards);
    }
    return { saved: dataset.id };
  },

  // Removes a dataset and its chart and table options. Its data files are left in place.
  'DELETE /api/datasets': async (body) => {
    const cards = await readConfig('cards');
    const usedBy = [...cards.population, ...cards.impact, ...cards.percentages, ...cards.infrastructure]
      .filter((c) => [c.dataset, c.damagedDataset, c.totalDataset].includes(body.id));
    if (usedBy.length) throw new Error(`Used by the cards ${usedBy.map((c) => c.id).join(', ')}; it cannot be removed here.`);
    const layers = await readConfig('layers');
    layers.datasets = layers.datasets.filter((d) => d.id !== body.id);
    cards.chartOptions = cards.chartOptions.filter((o) => o.dataset !== body.id);
    cards.tableOptions = cards.tableOptions.filter((o) => o.dataset !== body.id);
    await writeConfig('layers', layers);
    await writeConfig('cards', cards);
    return { removed: body.id };
  },

  'PUT /api/text': async (body) => {
    if (!body.text?.title?.id) throw new Error('The text file looks incomplete; not saved.');
    await writeConfig('text', body.text);
    return { saved: 'text' };
  }
};

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = decodeURIComponent(url.pathname);

  if (path.startsWith('/api/')) {
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    try {
      if (req.method === 'GET' && path.startsWith('/api/jobs/')) {
        const job = jobs.get(path.slice('/api/jobs/'.length));
        return job ? send(200, { status: job.status, log: job.log, result: job.result }) : send(404, { error: 'No such job.' });
      }
      const handler = api[`${req.method} ${path}`];
      if (!handler) return send(404, { error: 'Unknown request.' });
      return send(200, await handler(await readBody(req)));
    } catch (error) {
      return send(400, { error: error.message });
    }
  }

  const file = join(root, normalize(path.endsWith('/') ? path + 'index.html' : path));
  const inside = relative(root, file).split(sep).join('/');
  if (!file.startsWith(root) || !servable.some((prefix) => inside === prefix || inside.startsWith(prefix))) {
    res.writeHead(403).end('Not served');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Admin: http://localhost:${port}/admin/   Dashboard: http://localhost:${port}/`);
  if (!python) console.log('Warning: no Python found in .venv; processing will not work. See README.');
});
