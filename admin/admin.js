// Local admin page: adds map datasets and kecamatan tables, edits dataset details and the
// dashboard text. Talks to scripts/admin-server.mjs; all processing runs in admin_tool.py.
import { setupSurveyTab } from './survey-review.js';
import { setupGitTab } from './publish-github.js';

let state = { layers: null, cards: null, text: null, inbox: [] };

// ------------------------------------------------------------ helpers

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...[].concat(children).filter((c) => c !== null && c !== undefined));
  return node;
}

async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showMessage(text, isError = false) {
  const node = document.getElementById('message');
  node.textContent = text;
  node.className = isError ? 'message error' : 'message';
  node.hidden = false;
  node.scrollIntoView({ block: 'nearest' });
}

// Runs a button's action with the button disabled, and reports errors.
function action(button, run) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await run();
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

const slug = (text) => String(text || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const both = (id, en) => ({ id, en: en || id });

// Polls a processing job until it ends, showing its progress lines in logNode.
async function waitForJob(job, logNode) {
  logNode.hidden = false;
  for (;;) {
    const status = await api('GET', `/api/jobs/${job}`);
    logNode.textContent = status.log.join('\n') || 'Working…';
    if (status.status !== 'running') {
      if (status.status === 'failed') throw new Error(status.result.error);
      return status.result;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

// ------------------------------------------------------------ form fields

// A small form builder. Each field is { key, label, type, hint, value, options, bilingual }.
// Bilingual fields get an Indonesian and an English input side by side.
function buildFields(container, fields) {
  const grid = el('div', { class: 'fields' });
  for (const field of fields) {
    const id = `f-${container.id}-${field.key}`;
    grid.append(el('label', { htmlFor: id, text: field.label }));
    const input = (lang) => {
      const value = field.bilingual ? field.value?.[lang] ?? '' : field.value ?? '';
      const props = { id: lang === 'en' ? `${id}-en` : id, name: field.key, value, placeholder: field.bilingual ? (lang === 'id' ? 'Bahasa Indonesia' : 'English') : '' };
      if (field.type === 'textarea') return el('textarea', { ...props, text: value });
      if (field.type === 'select') {
        const select = el('select', props, field.options.map((o) => el('option', { value: o.value, text: o.label })));
        select.value = field.value;
        return select;
      }
      if (field.type === 'checkbox') return el('input', { ...props, type: 'checkbox', checked: Boolean(field.value) });
      return el('input', { ...props, type: field.type || 'text' });
    };
    if (field.bilingual) grid.append(input('id'), input('en'));
    else grid.append(el('div', { class: 'wide' }, input()));
    if (field.hint) grid.append(el('p', { class: 'hint', text: field.hint }));
  }
  container.replaceChildren(grid);
}

function readFields(container, fields) {
  const values = {};
  for (const field of fields) {
    const id = `f-${container.id}-${field.key}`;
    const get = (suffix = '') => {
      const node = document.getElementById(id + suffix);
      return node.type === 'checkbox' ? node.checked : node.value.trim();
    };
    values[field.key] = field.bilingual ? both(get(), get('-en')) : get();
  }
  return values;
}

const metaFields = (dataset = {}) => [
  { key: 'label', label: 'Name', bilingual: true, value: dataset.label },
  { key: 'source', label: 'Source (full)', value: dataset.source, hint: 'Shown in "Tentang data" and under the data table.' },
  { key: 'sourceShort', label: 'Source (short)', value: dataset.sourceShort, hint: 'Shown on small cards. Optional.' },
  { key: 'date', label: 'Date', value: dataset.date ?? '', hint: 'For example 2026-03-19 or 2025. Leave empty if not confirmed; the dashboard then says "belum dikonfirmasi".' },
  { key: 'attribution', label: 'Credit line', value: dataset.attribution, hint: 'Shown on the map and in "Tentang data". Required by most licences.' },
  { key: 'method', label: 'Method', type: 'textarea', bilingual: true, value: dataset.method },
  { key: 'methodUrl', label: 'Method link', value: dataset.methodUrl, hint: 'Optional web link to the method or source.' },
  { key: 'publish', label: 'Cleared for publishing', type: 'checkbox', value: dataset.publish === true, hint: 'Leave unticked until the data owner allows it. Unticked datasets say "Hanya lokal".' }
];

// Turns form values into dataset properties, leaving out empty optional ones.
function metaToDataset(values) {
  const dataset = {
    label: values.label,
    source: values.source || null,
    date: values.date || null,
    attribution: values.attribution || values.source || '',
    publish: values.publish
  };
  if (values.sourceShort) dataset.sourceShort = values.sourceShort;
  if (values.method.id) dataset.method = values.method;
  if (values.methodUrl) dataset.methodUrl = values.methodUrl;
  return dataset;
}

// ------------------------------------------------------------ dataset list

function renderDatasetList() {
  const groups = Object.fromEntries(state.layers.groups.map((g) => [g.id, g.label.en]));
  const rows = state.layers.datasets.map((dataset) => {
    const edit = el('button', { type: 'button', text: 'Edit' });
    edit.addEventListener('click', () => openEditor(dataset));
    const remove = el('button', { type: 'button', text: 'Remove' });
    action(remove, async () => {
      if (!confirm(`Remove "${dataset.label.en}" from the dashboard? Its data files stay in data/web/.`)) return;
      await api('DELETE', '/api/datasets', { id: dataset.id });
      await loadState();
      showMessage(`Removed ${dataset.id}.`);
    });
    return el('tr', {}, [
      el('td', {}, [el('strong', { text: dataset.label.id }), el('br'), el('span', { class: 'muted', text: `${dataset.label.en} · ${dataset.id}` })]),
      el('td', { text: groups[dataset.group] || dataset.group }),
      el('td', { text: dataset.file ? (dataset.map ? 'Map' : 'Table') : 'No data yet' }),
      el('td', { text: dataset.file ? (dataset.publish ? 'Yes' : 'Local only') : '' }),
      el('td', {}, [edit, ' ', remove])
    ]);
  });
  document.getElementById('dataset-rows').replaceChildren(...rows);
}

function openEditor(dataset) {
  const dialog = document.getElementById('edit-dialog');
  const container = document.getElementById('edit-fields');
  const fields = [...metaFields(dataset)];
  if (dataset.map) fields.push({ key: 'visible', label: 'On when the dashboard opens', type: 'checkbox', value: dataset.visible === true });
  document.getElementById('edit-title').textContent = `Edit ${dataset.label.en}`;
  buildFields(container, fields);
  dialog.returnValue = '';
  dialog.onclose = async () => {
    if (dialog.returnValue !== 'save') return;
    try {
      const values = readFields(container, fields);
      const meta = metaToDataset(values);
      const updated = { ...dataset, ...meta };
      if (dataset.map) updated.visible = values.visible;
      // Optional details cleared in the form are removed, not kept from before.
      for (const key of ['sourceShort', 'method', 'methodUrl']) if (!(key in meta)) delete updated[key];
      await api('POST', '/api/datasets', { dataset: updated });
      await loadState();
      showMessage(`Saved ${dataset.id}. Reload the dashboard to see it.`);
    } catch (error) {
      showMessage(error.message, true);
    }
  };
  dialog.showModal();
}

// ------------------------------------------------------------ add a map dataset

// Colour sets for new classes: an ordered ramp for 2-5 levels, else distinct colours.
const RAMPS = {
  2: ['#e3b23c', '#9b1c31'],
  3: ['#e3b23c', '#d2652a', '#9b1c31'],
  4: ['#f0d36b', '#e3b23c', '#d2652a', '#9b1c31'],
  5: ['#f0d36b', '#e3b23c', '#d2652a', '#b23a2e', '#7a1426']
};
const DISTINCT = ['#2166ac', '#1b7837', '#d6604d', '#762a83', '#b8860b', '#4d4d4d', '#e7298a', '#66a61e', '#a6761d', '#1f78b4'];
const ESRI_CLASSES = {
  1: ['Air', 'Water', '#419bdf'], 2: ['Pepohonan', 'Trees', '#397d49'], 4: ['Vegetasi tergenang', 'Flooded vegetation', '#7a87c6'],
  5: ['Tanaman pertanian', 'Crops', '#e49635'], 7: ['Area terbangun', 'Built area', '#c4281b'], 8: ['Lahan terbuka', 'Bare ground', '#a59b8f'],
  9: ['Salju/Es', 'Snow/Ice', '#a8ebff'], 10: ['Awan', 'Clouds', '#616161'], 11: ['Padang rumput dan semak', 'Rangeland', '#e3e2c3']
};

let mapInfo = null;
let mapResult = null;

function classRows(values, known = {}) {
  const colours = RAMPS[values.length] || DISTINCT;
  const table = el('table', { class: 'list classes' }, [
    el('thead', {}, el('tr', {}, ['Value', 'Name (ID)', 'Name (EN)', 'Colour'].map((t) => el('th', { text: t }))))
  ]);
  const body = el('tbody');
  values.forEach((value, i) => {
    const [nameId, nameEn, colour] = known[value] || [String(value), String(value), colours[i % colours.length]];
    body.append(el('tr', { 'data-value': JSON.stringify(value) }, [
      el('td', { text: String(value) }),
      el('td', {}, el('input', { type: 'text', value: nameId, 'data-key': 'id' })),
      el('td', {}, el('input', { type: 'text', value: nameEn, 'data-key': 'en' })),
      el('td', {}, el('input', { type: 'color', value: colour, 'data-key': 'color' }))
    ]));
  });
  table.append(body);
  return table;
}

function readClassRows(container) {
  return [...container.querySelectorAll('tbody tr')].map((row) => ({
    value: JSON.parse(row.dataset.value),
    color: row.querySelector('[data-key=color]').value,
    label: both(row.querySelector('[data-key=id]').value.trim(), row.querySelector('[data-key=en]').value.trim())
  }));
}

function renderTypeOptions() {
  const type = document.getElementById('map-type').value;
  const container = document.getElementById('map-type-options');
  container.replaceChildren();
  if (type === 'classes') {
    const candidates = mapInfo.fields?.filter((f) => f.values) ?? [];
    if (!candidates.length) {
      container.append(el('p', { class: 'problems', text: 'No field has a small set of values to use as classes. Choose another type.' }));
      return;
    }
    const select = el('select', { id: 'class-field' }, candidates.map((f) => el('option', { value: f.name, text: `${f.name} (${f.values.join(', ')})` })));
    const holder = el('div', { id: 'class-rows' });
    const fill = () => holder.replaceChildren(classRows(candidates.find((f) => f.name === select.value).values));
    select.addEventListener('change', fill);
    container.append(el('p', { class: 'row' }, ['Class field:', select]), holder);
    fill();
  } else if (type === 'raster-classes') {
    const values = (mapInfo.values ?? []).map((v) => v.value).filter((v) => v !== mapInfo.nodata);
    const esri = values.every((v) => ESRI_CLASSES[v]);
    container.append(
      el('p', { class: 'muted', text: esri ? 'The values match the ESRI land cover classes, so their names and colours are filled in.' : 'Name each value. Values not listed are left out.' }),
      el('div', { id: 'class-rows' }, classRows(values, esri ? ESRI_CLASSES : {}))
    );
  } else if (type === 'raster-sum') {
    container.append(
      el('p', { class: 'row' }, ['Map classes (cell value breaks):', el('input', { id: 'sum-breaks', value: '0, 5, 25, 50, 100', size: 24 })]),
      el('p', { class: 'row' }, ['Colours (one per class):', el('input', { id: 'sum-colours', value: '#dadaeb, #bcbddc, #9e9ac8, #756bb1, #54278f', size: 50 })]),
      el('p', { class: 'row' }, ['Unit (ID / EN):', el('input', { id: 'sum-unit-id', value: 'jiwa', size: 10 }), el('input', { id: 'sum-unit-en', value: 'people', size: 10 })])
    );
  } else if (type === 'extent') {
    container.append(el('p', { class: 'row' }, ['Colour on the map:', el('input', { id: 'extent-colour', type: 'color', value: '#2166ac' })]));
  }
}

const groupOptions = () => state.layers.groups.map((g) => ({ value: g.id, label: `${g.label.en} (${g.label.id})` }));

function mapMetaFields() {
  const type = document.getElementById('map-type').value;
  const name = document.getElementById('map-file').value.split('/').pop().replace(/\.[^.]+$/, '');
  return [
    { key: 'id', label: 'Short id', value: slug(name).slice(0, 40), hint: 'Lower-case letters, digits and hyphens. Used for file names; it cannot be changed later.' },
    { key: 'group', label: 'Group in the layer list', type: 'select', options: groupOptions(), value: type === 'classes' ? 'hazard' : 'reference' },
    ...metaFields(),
    { key: 'visible', label: 'On when the dashboard opens', type: 'checkbox', value: false },
    { key: 'addChart', label: 'Add a chart option', type: 'checkbox', value: true, hint: 'Adds a per-kecamatan bar chart to the top-left chart menu.' },
    { key: 'addTable', label: 'Add to "Data Kecamatan"', type: 'checkbox', value: type !== 'raster-classes', hint: 'Adds the per-kecamatan values to the right-hand table menu.' }
  ];
}

function buildSpec(values) {
  const type = document.getElementById('map-type').value;
  const spec = { id: values.id, type, path: document.getElementById('map-file').value, source: values.source };
  if (type === 'classes') {
    spec.class_field = document.getElementById('class-field').value;
    spec.classes = readClassRows(document.getElementById('class-rows'));
  }
  if (type === 'raster-classes') spec.classes = readClassRows(document.getElementById('class-rows'));
  if (type === 'raster-sum') {
    spec.breaks = document.getElementById('sum-breaks').value.split(',').map(Number);
    spec.colours = document.getElementById('sum-colours').value.split(',').map((c) => c.trim());
    if (spec.colours.length !== spec.breaks.length) throw new Error('Give one colour per break.');
  }
  return spec;
}

function legendFor(spec) {
  if (spec.type === 'classes') return { field: 'class', items: spec.classes };
  if (spec.type === 'raster-classes') return { items: spec.classes };
  if (spec.type === 'extent') return { type: 'fill', color: document.getElementById('extent-colour').value };
  const unit = both(document.getElementById('sum-unit-id').value, document.getElementById('sum-unit-en').value);
  const fmt = (n) => n.toLocaleString('id-ID');
  return {
    items: spec.breaks.map((b, i) => {
      const next = spec.breaks[i + 1];
      const range = next === undefined ? `≥ ${fmt(b)}` : i === 0 ? `< ${fmt(next)}` : `${fmt(b)}–${fmt(next)}`;
      return { color: spec.colours[i], label: i === 0 ? both(`${range} ${unit.id} per sel`, `${range} ${unit.en} per cell`) : both(range, range) };
    })
  };
}

// The chart and table options a processed map dataset adds, per type.
function optionsFor(spec, values, result) {
  const label = values.label;
  const km2 = both('km²', 'km²');
  const perKecamatan = both(`${label.id} per kecamatan`, `${label.en} by kecamatan`);
  const chart = [];
  const table = [];
  if (spec.type === 'classes' || spec.type === 'raster-classes') {
    chart.push({ id: spec.id, kind: 'hazard', dataset: spec.id, field: 'classes_km2', digits: 1, unit: km2, label: perKecamatan,
      note: both('Luas per kelas. Area tanpa kelas tidak ditampilkan.', 'Area per class. Area with no class is not shown.') });
    for (const c of spec.classes) {
      table.push({ id: `${spec.id}-${slug(String(c.value))}`, dataset: spec.id, field: `classes_km2.${c.value}`, digits: 2, unit: km2,
        label: both(`${label.id}: ${c.label.id}`, `${label.en}: ${c.label.en}`) });
    }
  } else if (spec.type === 'extent') {
    chart.push({ id: spec.id, kind: 'kecamatan', dataset: spec.id, field: 'extent_km2', digits: 2, unit: km2, label: perKecamatan });
    table.push({ id: spec.id, dataset: spec.id, field: 'extent_km2', digits: 2, unit: km2, label });
    table.push({ id: `${spec.id}-pct`, dataset: spec.id, field: 'extent_pct', digits: 1, unit: both('%', '%'), label: both(`% ${label.id}`, `% ${label.en}`) });
  } else {
    const unit = both(document.getElementById('sum-unit-id').value, document.getElementById('sum-unit-en').value);
    chart.push({ id: spec.id, kind: 'kecamatan', dataset: spec.id, field: 'total', digits: 0, unit, label: perKecamatan });
    table.push({ id: spec.id, dataset: spec.id, field: 'total', digits: 0, unit, label });
  }
  return { chartOptions: values.addChart ? chart : [], tableOptions: values.addTable ? table : [] };
}

function summaryTable(result) {
  const rows = Object.values(result.kecamatan);
  const keys = Object.keys(rows[0]).filter((k) => k !== 'name');
  const cell = (value) => (value && typeof value === 'object' ? Object.entries(value).map(([k, v]) => `${k}: ${v}`).join(', ') : value ?? '—');
  return el('table', { class: 'list' }, [
    el('thead', {}, el('tr', {}, ['Kecamatan', ...keys].map((k) => el('th', { text: k })))),
    el('tbody', {}, rows.map((row) => el('tr', {}, [el('td', { text: row.name }), ...keys.map((k) => el('td', { text: String(cell(row[k])) }))])))
  ]);
}

function setupMapTab() {
  const files = state.inbox.filter((f) => !f.path.toLowerCase().endsWith('.xlsx'));
  document.getElementById('map-file').replaceChildren(...files.map((f) => el('option', { value: f.path, text: `${f.path} (${(f.size / 1e6).toFixed(1)} MB)` })));

  action(document.getElementById('map-inspect'), async () => {
    const info = document.getElementById('map-info');
    info.hidden = false;
    info.textContent = 'Reading the file…';
    mapInfo = await api('POST', '/api/inspect', { path: document.getElementById('map-file').value });
    const { ok, suggested_types: suggested, fields, ...rest } = mapInfo;
    info.textContent = JSON.stringify(rest, null, 1) + (fields ? '\nFields: ' + fields.map((f) => `${f.name} [${f.dtype}${f.values ? ': ' + f.values.join(', ') : ''}]`).join('; ') : '');
    document.getElementById('map-type').value = suggested[0];
    document.getElementById('map-type-step').hidden = false;
    document.getElementById('map-meta-step').hidden = false;
    document.getElementById('map-result-step').hidden = true;
    renderTypeOptions();
    buildFields(document.getElementById('map-meta'), mapMetaFields());
  });

  document.getElementById('map-type').addEventListener('change', () => {
    renderTypeOptions();
    buildFields(document.getElementById('map-meta'), mapMetaFields());
  });

  let lastSpec = null;
  let lastValues = null;
  action(document.getElementById('map-process'), async () => {
    const fields = mapMetaFields();
    lastValues = readFields(document.getElementById('map-meta'), fields);
    if (!lastValues.label.id) throw new Error('Give the dataset a name.');
    if (state.layers.datasets.some((d) => d.id === lastValues.id) && !confirm(`A dataset "${lastValues.id}" exists. Replace it?`)) return;
    lastSpec = buildSpec(lastValues);
    document.getElementById('map-result-step').hidden = false;
    document.getElementById('map-save').hidden = true;
    document.getElementById('map-summary').replaceChildren();
    const { job } = await api('POST', '/api/jobs', lastSpec);
    mapResult = await waitForJob(job, document.getElementById('map-log'));
    document.getElementById('map-summary').replaceChildren(
      el('p', { text: 'Check these numbers per kecamatan before adding the dataset.' }),
      summaryTable(mapResult)
    );
    document.getElementById('map-save').hidden = false;
  });

  action(document.getElementById('map-save'), async () => {
    const dataset = {
      id: lastSpec.id,
      group: lastValues.group,
      map: true,
      renderer: mapResult.renderer,
      ...metaToDataset(lastValues),
      file: mapResult.file,
      stats: mapResult.stats,
      visible: lastValues.visible,
      legend: legendFor(lastSpec)
    };
    if (mapResult.image) dataset.image = mapResult.image;
    await api('POST', '/api/datasets', { dataset, ...optionsFor(lastSpec, lastValues, mapResult) });
    await loadState();
    document.getElementById('map-save').hidden = true;
    showMessage(`Added "${lastValues.label.en}". Reload the dashboard to see it.`);
  });
}

// ------------------------------------------------------------ kecamatan tables

let tableInfo = null;

function setupTableTab() {
  const files = state.inbox.filter((f) => f.path.toLowerCase().endsWith('.xlsx'));
  const select = document.getElementById('table-file');
  select.replaceChildren(...(files.length ? files.map((f) => el('option', { value: f.path, text: f.path })) : [el('option', { value: '', text: 'No .xlsx files in "for claude" yet' })]));

  const metaContainer = document.getElementById('table-meta');
  let fields = [];

  action(document.getElementById('table-inspect'), async () => {
    if (!select.value) throw new Error('Save a filled template in "for claude" first.');
    tableInfo = await api('POST', '/api/inspect', { path: select.value });
    const check = document.getElementById('table-check');
    check.replaceChildren(
      el('p', { class: 'check', text: `${tableInfo.columns.length} columns, ${Object.keys(tableInfo.kecamatan).length} kecamatan rows, ${tableInfo.filled_cells} filled cells.` }),
      tableInfo.problems.length
        ? el('ul', { class: 'problems' }, tableInfo.problems.map((p) => el('li', { text: p })))
        : el('p', { class: 'check', text: 'No problems found.' })
    );
    const info = tableInfo.info || {};
    fields = [
      { key: 'id', label: 'Short id', value: slug(info.nama_dataset || select.value.split('/').pop().replace(/\.xlsx$/i, '')).slice(0, 40), hint: 'Lower-case letters, digits and hyphens.' },
      ...metaFields({ label: both(info.nama_dataset || '', ''), source: info.sumber || '', date: info.tanggal ? String(info.tanggal).slice(0, 10) : '' })
    ];
    buildFields(metaContainer, fields);
    const columnTable = el('table', { class: 'list' }, [
      el('thead', {}, el('tr', {}, ['Column', 'Name', 'Unit', 'In "Data Kecamatan"', 'As a chart'].map((t) => el('th', { text: t })))),
      el('tbody', {}, tableInfo.columns.map((c) => el('tr', { 'data-field': c.field }, [
        el('td', { text: c.field }),
        el('td', { text: `${c.label.id} / ${c.label.en}` }),
        el('td', { text: c.unit.id }),
        el('td', {}, el('input', { type: 'checkbox', checked: true, 'data-key': 'table' })),
        el('td', {}, el('input', { type: 'checkbox', checked: false, 'data-key': 'chart' }))
      ])))
    ]);
    document.getElementById('table-columns').replaceChildren(columnTable);
    document.getElementById('table-meta-step').hidden = false;
  });

  action(document.getElementById('table-save'), async () => {
    const values = readFields(metaContainer, fields);
    if (!values.label.id) throw new Error('Give the table a name.');
    if (state.layers.datasets.some((d) => d.id === values.id) && !confirm(`A dataset "${values.id}" exists. Replace it?`)) return;
    const { job } = await api('POST', '/api/jobs', { id: values.id, type: 'table', path: select.value, source: values.source });
    const result = await waitForJob(job, document.getElementById('table-log'));
    const chosen = (key) => [...document.querySelectorAll('#table-columns tbody tr')]
      .filter((row) => row.querySelector(`[data-key=${key}]`).checked)
      .map((row) => result.columns.find((c) => c.field === row.dataset.field));
    const option = (c) => ({ id: `${values.id}-${slug(c.field)}`, dataset: values.id, field: c.field, digits: c.digits, unit: c.unit, label: c.label });
    await api('POST', '/api/datasets', {
      dataset: { id: values.id, group: 'reference', map: false, ...metaToDataset(values), file: result.file, stats: result.stats },
      tableOptions: chosen('table').map(option),
      chartOptions: chosen('chart').map((c) => ({ ...option(c), kind: 'kecamatan', label: both(`${c.label.id} per kecamatan`, `${c.label.en} by kecamatan`) }))
    });
    await loadState();
    showMessage(`Added "${values.label.en || values.label.id}". Reload the dashboard to see it.`);
  });
}

// ------------------------------------------------------------ text

// Every { id, en } pair in text.json, with its dotted path, except the limitations list.
function textPairs(node, path = []) {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    if ('id' in node && 'en' in node && typeof node.id === 'string') return [{ path, value: node }];
    return Object.entries(node).flatMap(([key, child]) => (key === 'limitations' ? [] : textPairs(child, [...path, key])));
  }
  return [];
}

function renderText() {
  const pairs = textPairs(state.text);
  const grid = el('div', { class: 'fields' });
  for (const { path, value } of pairs) {
    grid.append(
      el('label', { text: path.join(' › ') }),
      el('input', { value: value.id, 'data-path': path.join('.'), 'data-lang': 'id' }),
      el('input', { value: value.en, 'data-path': path.join('.'), 'data-lang': 'en' })
    );
  }
  document.getElementById('text-fields').replaceChildren(grid);
  renderLimitations(state.text.limitations);
}

function renderLimitations(list) {
  const container = document.getElementById('text-limitations');
  container.replaceChildren(...list.map((item) => {
    const remove = el('button', { type: 'button', text: 'Remove' });
    const row = el('div', { class: 'fields limitation' }, [
      el('div', {}, remove),
      el('textarea', { text: item.id, value: item.id, 'data-lang': 'id' }),
      el('textarea', { text: item.en, value: item.en, 'data-lang': 'en' })
    ]);
    remove.addEventListener('click', () => row.remove());
    return row;
  }));
}

function setupTextTab() {
  document.getElementById('text-add-limitation').addEventListener('click', () => {
    const current = readLimitations();
    renderLimitations([...current, { id: '', en: '' }]);
  });
  action(document.getElementById('text-save'), async () => {
    const text = structuredClone(state.text);
    for (const input of document.querySelectorAll('#text-fields input')) {
      const target = input.dataset.path.split('.').reduce((node, key) => node[key], text);
      target[input.dataset.lang] = input.value;
    }
    text.limitations = readLimitations().filter((l) => l.id || l.en);
    await api('PUT', '/api/text', { text });
    await loadState();
    showMessage('Saved the text. Reload the dashboard to see it.');
  });
}

function readLimitations() {
  return [...document.querySelectorAll('#text-limitations .limitation')].map((row) => ({
    id: row.querySelector('[data-lang=id]').value.trim(),
    en: row.querySelector('[data-lang=en]').value.trim()
  }));
}

// ------------------------------------------------------------ start

async function loadState() {
  state = await api('GET', '/api/state');
  renderDatasetList();
  renderText();
}

function setupTabs() {
  for (const tab of document.querySelectorAll('[data-tab]')) {
    tab.addEventListener('click', () => {
      for (const other of document.querySelectorAll('[data-tab]')) {
        other.setAttribute('aria-selected', String(other === tab));
        document.getElementById(`tab-${other.dataset.tab}`).hidden = other !== tab;
      }
    });
  }
}

async function init() {
  setupTabs();
  await loadState();
  setupMapTab();
  setupTableTab();
  setupTextTab();
  setupSurveyTab({ api, el, showMessage, waitForJob });
  setupGitTab({ api, el, showMessage });
}

init().catch((error) => showMessage(`The admin page could not start: ${error.message}. Is scripts/admin-server.mjs running?`, true));
