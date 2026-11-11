// Local admin server: the dashboard at /, the admin page at /admin/, and a small JSON API
// that runs scripts/admin_tool.py and edits the files in config/.
// Usage: node scripts/admin-server.mjs [port]   (default 8081)
//
// It listens on 127.0.0.1 only, so nothing is reachable from other computers. Every config
// write first copies the old file to config/backup/. Nothing is pushed until the Publish to
// GitHub tab is used, and that commits only config/ and data/web/.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';

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

// Runs admin_tool.py (or another tool script). The job object fills in as it runs: progress
// lines in log, then the tool's JSON result (its last line of output) and a status of done or failed.
function runTool(args, input, script = 'admin_tool.py') {
  const job = { status: 'running', log: [], result: null };
  job.finished = new Promise((done) => {
    const child = spawn(python, [join(root, 'scripts', script), ...args], { cwd: root });
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

// ------------------------------------------------------------ survey review and Google Drive

// Uploaded files are copied here; build_survey.py reads every JSON file under for claude/survey.
const driveInbox = join(inbox, 'survey', 'drive');
// The only paths the upload script writes; anything else in the folder is not copied.
const drivePath = /^(brin_survey_[A-Za-z0-9_-]+\.json|originals\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+)$/;
const driveErrors = {
  code: 'Google refused the admin code.',
  'admin-not-configured': 'The Google script has no ADMIN_CODE yet (or it equals UPLOAD_CODE). See docs/DRIVE_UPLOAD_SETUP.md.',
  'not-found': 'A file disappeared from the Drive folder during the download.'
};

async function driveCall(body) {
  const layers = await readConfig('layers');
  const url = layers.datasets.find((d) => d.id === 'brin-survey')?.uploadUrl;
  if (!url) throw new Error('No uploadUrl for brin-survey in config/layers.json.');
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Google gave no usable answer (HTTP ${response.status}). Is the script deployed as a new version?`);
  }
  if (!data.ok) throw new Error(driveErrors[data.error] ?? `Google script error: ${data.error}`);
  return data;
}

// ------------------------------------------------------------ GitHub

// The only folders the admin page commits. Raw data, the owner's folder and review decisions
// are outside them (and git-ignored), so they can never be pushed from here.
const publicPaths = ['config', 'data/web'];
// GitHub warns above 50 MB and refuses files above 100 MB.
const maxFileBytes = 50 * 1024 * 1024;

// Runs git without a shell, so a commit message cannot run anything. A sign-in window from Git
// Credential Manager may still appear; a text prompt is turned off so the server never hangs.
function git(args, timeoutMs = 120000) {
  return new Promise((done) => {
    const child = spawn('git', ['-c', 'core.quotepath=off', ...args], { cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', (error) => { clearTimeout(timer); done({ code: -1, out, err: error.message }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code, out, err }); });
  });
}

async function gitOrFail(args, timeoutMs) {
  const result = await git(args, timeoutMs);
  if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${(result.err || result.out).trim() || `exit ${result.code}`}`);
  return result.out;
}

// Changed, added and removed files in the public folders, with their sizes.
async function publicChanges() {
  const out = await gitOrFail(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...publicPaths]);
  const fields = out.split('\0').filter(Boolean);
  const changes = [];
  for (let i = 0; i < fields.length; i += 1) {
    const status = fields[i].slice(0, 2);
    const path = fields[i].slice(3);
    if (status.startsWith('R')) i += 1; // a rename is followed by its old path
    const full = join(root, path);
    changes.push({ status: status.trim(), path, size: existsSync(full) ? (await stat(full)).size : null });
  }
  return changes;
}

async function gitState() {
  const branch = (await gitOrFail(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const upstream = await git(['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`]);
  const [behind, ahead] = upstream.code === 0 ? upstream.out.trim().split(/\s+/).map(Number) : [null, null];
  const unpushed = ahead ? (await gitOrFail(['log', '--format=%h %s', `origin/${branch}..HEAD`])).trim().split('\n') : [];
  return { branch, behind, ahead, unpushed, changes: await publicChanges() };
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

  // Copies new and changed files from the Drive upload folder. Nothing in Drive is changed.
  'POST /api/survey/sync': async (body) => {
    const { files } = await driveCall({ adminCode: body.adminCode, action: 'list' });
    const counts = { fetched: 0, unchanged: 0, ignored: 0, total: files.length };
    for (const file of files) {
      if (!drivePath.test(file.path)) {
        counts.ignored += 1;
        continue;
      }
      const target = join(driveInbox, ...file.path.split('/'));
      if (existsSync(target) && (await stat(target)).size === file.size) {
        counts.unchanged += 1;
        continue;
      }
      const { data } = await driveCall({ adminCode: body.adminCode, action: 'get', fileId: file.id });
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(data, 'base64'));
      counts.fetched += 1;
    }
    return counts;
  },

  // Every record with its review state. Holds informant names: this server is local only.
  'GET /api/survey': async () => (await runTool(['list'], null, 'survey_review.py').finished).result,

  'PUT /api/survey/review': async (body) => (await runTool(['save'], body, 'survey_review.py').finished).result,

  // Publishing writes data/web/ only; committing and pushing stay separate steps.
  'POST /api/survey/publish': async () => {
    const id = String(nextJob++);
    jobs.set(id, runTool(['publish'], null, 'survey_review.py'));
    return { job: id };
  },

  'GET /api/git': async () => gitState(),

  // Commits the changes in config/ and data/web/ (only those), then pushes main to GitHub.
  'POST /api/git/push': async (body) => {
    const message = String(body.message || '').trim();
    const before = await gitState();
    if (before.branch !== 'main') throw new Error(`This copy is on branch ${before.branch}, not main; ask Claude.`);
    const tooBig = before.changes.filter((c) => c.size > maxFileBytes);
    if (tooBig.length) throw new Error(`Too large for GitHub (over 50 MB): ${tooBig.map((c) => c.path).join(', ')}.`);
    let committed = null;
    if (before.changes.length) {
      if (!message) throw new Error('Write a short message describing the change.');
      await gitOrFail(['add', '--all', '--', ...publicPaths]);
      // A pathspec limits the commit to these folders even if other files were staged by hand.
      await gitOrFail(['commit', '-m', message, '--', ...publicPaths]);
      committed = (await gitOrFail(['log', '-1', '--format=%h %s'])).trim();
    } else if (!before.ahead) {
      return { committed: null, pushed: false, note: 'Nothing to publish: no changes and nothing waiting.' };
    }
    const push = await git(['push', 'origin', 'main'], 180000);
    if (push.code !== 0) {
      const reason = (push.err || push.out).trim();
      const hint = /rejected|fetch first|non-fast-forward/.test(reason)
        ? ' GitHub has newer changes than this computer; ask Claude to bring them in first.'
        : /resolve host|unable to access|timed out/i.test(reason) ? ' Check the internet connection and try again.' : '';
      // git's own "hint:" lines are generic; show the line that says what went wrong.
      const lines = reason.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('hint:'));
      const detail = lines.find((l) => /rejected|error|fatal/i.test(l)) ?? lines.pop() ?? '';
      throw new Error(`${committed ? `Committed ${committed}, but the push failed.` : 'The push failed.'}${hint} (${detail})`);
    }
    return { committed, pushed: true, head: (await gitOrFail(['rev-parse', '--short', 'HEAD'])).trim() };
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
