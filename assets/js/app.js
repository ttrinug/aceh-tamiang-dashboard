import { createMap } from './map.js';
import { el } from './dom.js';
import { drawBarChart, clearChart } from './charts.js';

const state = { lang: 'id', kecamatan: null, chart: null, table: null, visibleLayers: [] };
let config;
let mapView;

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.json();
}

// Picks the current language from a { id, en } object.
const pick = (labels) => labels[state.lang];
// Looks up a UI string in config/text.json by dotted path, e.g. "list.title".
const t = (path) => pick(path.split('.').reduce((node, key) => node[key], config.text));
const i18n = { t, pick };

const datasetById = (id) => config.layers.datasets.find((d) => d.id === id);
const kecamatanName = () => config.kecamatan.kecamatan.find((k) => k.id === state.kecamatan).name;

const formatNumber = (value, digits) => new Intl.NumberFormat(state.lang === 'id' ? 'id-ID' : 'en-GB', {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits
}).format(value);

// Shown wherever a dataset's date appears; a loaded dataset without a confirmed date says so.
const dateText = (dataset) => dataset.date ?? (dataset.file ? t('unconfirmed') : '—');

// Source and date lines shown on every number card. Cards are small, so a dataset's
// sourceShort is used when it has one; the full source is in the About panel.
function sourceLines(dataset) {
  return [
    el('p', 'card-meta', `${t('source')}: ${dataset.sourceShort ?? dataset.source ?? '—'}`),
    el('p', 'card-meta', `${t('date')}: ${dateText(dataset)}`)
  ];
}

// Reads a value by dotted path, e.g. "classes_km2.3".
const valueAt = (row, path) => path.split('.').reduce((node, key) => node?.[key], row);

// A dataset's value for one kecamatan, or null when the dataset, the field or the value
// itself is missing. Missing values are shown as "No data yet" or "—", never as zero.
const kecamatanValue = (dataset, field, id = state.kecamatan) =>
  (field ? valueAt(config.stats[dataset]?.kecamatan[id], field) : null) ?? null;

// Impact cards all come from one source at one date, given once under the cards.
function numberCard(card) {
  const node = el('article', 'card');
  const value = kecamatanValue(card.dataset, card.field);
  node.append(
    el('h3', 'card-label', pick(card.label)),
    value === null ? el('p', 'card-value no-data', t('noData')) : el('p', 'card-value', formatNumber(value, 0))
  );
  return node;
}

function renderImpact() {
  const cards = config.cards.impact;
  document.getElementById('impact-cards').replaceChildren(...cards.map(numberCard));
  const dataset = datasetById(cards[0].dataset);
  document.getElementById('impact-note').textContent = `${t('source')}: ${dataset.source ?? '—'} · ${t('date')}: ${dateText(dataset)}`;
}

// The infrastructure panel: one row per facility type for the selected kecamatan. "Total"
// will come from facility point data; "Damaged" comes from the reported impact.
function renderInfrastructure() {
  document.getElementById('infra-title').textContent = `${t('infrastructure.title')} ${kecamatanName()}`;
  const show = (dataset, field, digits) => {
    const value = dataset ? kecamatanValue(dataset, field) : null;
    return value === null ? '—' : formatNumber(value, digits);
  };
  document.getElementById('infra-rows').replaceChildren(...config.cards.infrastructure.map((row) => {
    const unit = row.unit.id === 'unit' ? '' : ` (${pick(row.unit)})`;
    const item = el('li');
    item.append(
      el('span', null, `${pick(row.label)}${unit}`),
      el('span', null, show(row.totalDataset, row.totalField, row.digits)),
      el('span', null, show(row.damagedDataset, row.damagedField, row.digits))
    );
    return item;
  }));
  const damaged = datasetById(config.cards.infrastructure[0].damagedDataset);
  document.getElementById('infra-note').textContent =
    `${t('infrastructure.note')} ${t('infrastructure.damaged')}: ${damaged.sourceShort ?? damaged.source}, ${dateText(damaged)}.`;
}

// Percentages are shown for the selected kecamatan, the unit of analysis.
function percentageCard(card) {
  const node = el('article', 'card');
  const row = card.dataset ? config.stats[card.dataset]?.kecamatan[state.kecamatan] : null;
  const part = (labels, field) => {
    if (!labels) return '—';
    return row ? `${pick(labels)}, ${formatNumber(row[field], 2)} km²` : pick(labels);
  };
  node.append(
    el('h3', 'card-label', pick(card.label)),
    row ? el('p', 'card-value', `${formatNumber(row[card.field], 1)}%`) : el('p', 'card-value no-data', t('noData')),
    el('p', 'card-meta', `${t('numerator')}: ${part(card.numerator, card.numeratorField)}`),
    el('p', 'card-meta', `${t('denominator')}: ${part(card.denominator, card.denominatorField)}`)
  );
  if (row) node.append(...sourceLines(datasetById(card.dataset)));
  return node;
}

// The selected kecamatan is named in the page title, after the dashboard name.
function renderTitle() {
  const kecamatan = `${t('kecamatan')} ${kecamatanName()}`;
  document.getElementById('title-kecamatan').textContent = ` | ${kecamatan}`;
  document.title = `${t('title')} | ${kecamatan}`;
}

// Fills a <select> with { id, label } options and selects one.
function fillSelect(select, options, value) {
  select.replaceChildren(...options.map((option) => {
    const node = el('option', null, pick(option.label));
    node.value = option.id;
    return node;
  }));
  select.value = value;
}

// The right-hand panel: one parameter at a time for all 12 kecamatan, largest first.
// Missing values show "—" (explained under the table) and sort last. A row click selects it.
function renderTablePanel() {
  const option = config.cards.tableOptions.find((o) => o.id === state.table);
  fillSelect(document.getElementById('table-select'), config.cards.tableOptions, state.table);
  const unit = option.unit ? ` (${pick(option.unit)})` : '';
  document.getElementById('table-column').textContent = `${pick(option.label)}${unit}`;

  const rows = config.kecamatan.kecamatan.map((k) => ({ ...k, value: kecamatanValue(option.dataset, option.field, k.id) }));
  rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.name.localeCompare(b.name));
  document.getElementById('table-rows').replaceChildren(...rows.map((row) => {
    const button = el('button', 'row');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(row.id === state.kecamatan));
    button.append(el('span', null, row.name), el('span', null, row.value === null ? '—' : formatNumber(row.value, option.digits)));
    button.addEventListener('click', () => selectKecamatan(row.id));
    const item = el('li');
    item.append(button);
    return item;
  }));

  const dataset = datasetById(option.dataset);
  const source = dataset.file ? ` · ${t('source')}: ${dataset.source} · ${t('date')}: ${dateText(dataset)}` : '';
  document.getElementById('table-note').textContent = `${t('table.missingKey')}${source}`;
}

// The legend panel beside the percentage card: one entry per active map layer, topmost first.
function renderLegend() {
  const body = document.getElementById('legend-body');
  if (!state.visibleLayers.length) {
    body.replaceChildren(el('p', 'card-meta', t('legend.empty')));
    return;
  }
  const swatch = (type, color) => {
    const node = el('span', `swatch swatch-${type}`);
    node.style.borderColor = color;
    if (type !== 'line') node.style.backgroundColor = color;
    node.setAttribute('aria-hidden', 'true');
    return node;
  };
  body.replaceChildren(...state.visibleLayers.map((dataset) => {
    const group = config.layers.groups.find((g) => g.id === dataset.group);
    const entry = el('div', 'legend-entry');
    const title = el('p', 'legend-title', dataset.group === 'hazard' ? `${pick(group.label)}: ${pick(dataset.label)}` : pick(dataset.label));
    if (!dataset.legend.items) {
      title.prepend(swatch(dataset.legend.type, dataset.legend.color));
      entry.append(title);
      return entry;
    }
    const list = el('ul', 'legend-items');
    for (const item of dataset.legend.items) {
      const li = el('li');
      li.append(swatch('fill', item.color), pick(item.label));
      list.append(li);
    }
    entry.append(title, list);
    return entry;
  }));
}

// Rows and series for one chart option, or null when its data is not loaded.
// - kecamatan: one bar per kecamatan for a single field.
// - stacked:   one stacked bar per kecamatan, one part per field in option.series.
// - hazard:    stacked by hazard index class, with the classes taken from the layer legend.
function chartData(option) {
  const stats = option.field || option.series ? config.stats[option.dataset]?.kecamatan : null;
  if (!stats) return null;
  const parts = option.kind === 'hazard'
    ? datasetById(option.dataset).legend.items.map((c) => ({ field: `${option.field}.${c.value}`, label: c.label, color: c.color }))
    : option.series;
  if (parts) {
    return {
      series: parts.map((part) => ({ label: pick(part.label), color: part.color })),
      rows: Object.entries(stats).map(([id, row]) => ({ id, name: row.name, values: parts.map((part) => valueAt(row, part.field) ?? 0) }))
    };
  }
  return {
    series: [{ label: pick(option.label) }],
    rows: Object.entries(stats).map(([id, row]) => ({ id, name: row.name, values: [valueAt(row, option.field)] }))
  };
}

// The top-left chart panel: a dropdown of parameters from config/cards.json. A parameter
// whose dataset is loaded is drawn as a bar chart; the rest show "No data yet".
function renderChartPicker() {
  const option = config.cards.chartOptions.find((o) => o.id === state.chart);
  fillSelect(document.getElementById('chart-select'), config.cards.chartOptions, state.chart);
  document.getElementById('chart-note').textContent = option.note ? pick(option.note) : '';
  const data = chartData(option);
  const empty = document.getElementById('chart-body');
  const wrap = document.getElementById('chart-canvas-wrap');
  const canvas = document.getElementById('chart-canvas');
  empty.hidden = Boolean(data);
  wrap.hidden = !data;
  if (!data) {
    clearChart(canvas);
    empty.textContent = t('noData');
    return;
  }
  canvas.setAttribute('aria-label', pick(option.label));
  drawBarChart({
    canvas,
    rows: data.rows,
    series: data.series,
    selectedId: state.kecamatan,
    locale: state.lang === 'id' ? 'id-ID' : 'en-GB',
    unit: pick(option.unit),
    digits: option.digits,
    onSelect: selectKecamatan
  });
}

// The single place the kecamatan changes, from the dropdown, a chart bar or a click on the map.
function selectKecamatan(id) {
  state.kecamatan = id;
  document.getElementById('kecamatan-select').value = id;
  render();
  mapView.selectKecamatan(id);
}

function renderAbout() {
  const content = document.getElementById('about-content');
  const datasets = el('ul', 'about-list');
  for (const dataset of config.layers.datasets) {
    const item = el('li');
    // Hazard labels are short ("Banjir") in the layer list, under their group; name the group here.
    const group = config.layers.groups.find((g) => g.id === dataset.group);
    item.append(el('h4', null, dataset.group === 'hazard' ? `${pick(group.label)}: ${pick(dataset.label)}` : pick(dataset.label)));
    if (dataset.file) {
      const credit = el('p');
      credit.innerHTML = dataset.attribution; // trusted HTML from config/layers.json
      item.append(credit, el('p', null, `${t('source')}: ${dataset.source} · ${t('date')}: ${dateText(dataset)}`));
      if (dataset.method) {
        const method = el('p', null, `${t('aboutDialog.method')}: ${pick(dataset.method)} `);
        const link = el('a', null, dataset.methodLinkText ? pick(dataset.methodLinkText) : t('aboutDialog.methodLink'));
        link.href = dataset.methodUrl;
        link.target = '_blank';
        method.append(link);
        item.append(method);
      }
      if (dataset.publish === false) item.append(el('p', null, `${t('aboutDialog.status')}: ${t('aboutDialog.localOnly')}`));
    } else {
      item.append(
        el('p', null, `${t('aboutDialog.plannedSource')}: ${pick(dataset.plannedSource)}`),
        el('p', null, `${t('aboutDialog.status')}: ${t('noData')}`)
      );
    }
    datasets.append(item);
  }

  const basemaps = el('ul', 'about-list');
  for (const basemap of config.basemaps.basemaps) {
    const item = el('li');
    const credit = el('p');
    credit.innerHTML = basemap.attribution; // trusted HTML from config/basemaps.json
    item.append(el('h4', null, pick(basemap.label)), credit);
    if (basemap.caption) item.append(el('p', null, pick(basemap.caption)));
    basemaps.append(item);
  }

  const limitations = el('ul', 'about-bullets');
  for (const line of config.text.limitations) limitations.append(el('li', null, pick(line)));

  content.replaceChildren(
    el('h3', null, t('aboutDialog.datasets')), datasets,
    el('h3', null, t('aboutDialog.basemaps')), basemaps,
    el('h3', null, t('aboutDialog.limitations')), limitations
  );
}

function render() {
  document.documentElement.lang = state.lang;
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-label]')) node.setAttribute('aria-label', t(node.dataset.i18nLabel));
  for (const button of document.querySelectorAll('[data-lang]')) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === state.lang));
  }

  const cards = config.cards;
  renderImpact();
  renderInfrastructure();
  document.getElementById('pct-cards').replaceChildren(...cards.percentages.map(percentageCard));

  renderTitle();
  renderTablePanel();
  renderLegend();
  renderChartPicker();
  renderAbout();
}

function setupHeader() {
  const select = document.getElementById('kecamatan-select');
  for (const kecamatan of config.kecamatan.kecamatan) {
    const option = el('option', null, kecamatan.name);
    option.value = kecamatan.id;
    select.append(option);
  }
  select.value = state.kecamatan;
  select.addEventListener('change', () => selectKecamatan(select.value));

  document.getElementById('chart-select').addEventListener('change', (event) => {
    state.chart = event.target.value;
    renderChartPicker();
  });

  document.getElementById('table-select').addEventListener('change', (event) => {
    state.table = event.target.value;
    renderTablePanel();
  });

  for (const button of document.querySelectorAll('[data-lang]')) {
    button.addEventListener('click', () => {
      state.lang = button.dataset.lang;
      render();
      mapView.refreshText();
    });
  }

  const menuButton = document.getElementById('menu-button');
  const menuList = document.getElementById('menu-list');
  const setMenu = (open) => {
    menuList.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
  };
  menuButton.addEventListener('click', () => {
    setMenu(menuList.hidden);
    if (!menuList.hidden) menuList.querySelector('button').focus();
  });
  menuList.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setMenu(false);
      menuButton.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.menu')) setMenu(false);
  });

  const dialog = document.getElementById('about-dialog');
  document.getElementById('about-open').addEventListener('click', () => {
    setMenu(false);
    dialog.showModal();
  });
  document.getElementById('about-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => menuButton.focus());
}

async function init() {
  const [app, basemaps, layers, cards, kecamatan, text] = await Promise.all([
    loadJson('config/app.json'),
    loadJson('config/basemaps.json'),
    loadJson('config/layers.json'),
    loadJson('config/cards.json'),
    loadJson('config/kecamatan.json'),
    loadJson('config/text.json')
  ]);
  // Legends shared by several datasets are named once in layers.legendItems.
  for (const dataset of layers.datasets) {
    if (typeof dataset.legend?.items === 'string') dataset.legend.items = layers.legendItems[dataset.legend.items];
  }
  // Per-kecamatan statistics produced by the build scripts, keyed by dataset id. Several
  // datasets can share one file; statsPath picks each one's part of it.
  const withStats = layers.datasets.filter((d) => d.stats);
  const files = Object.fromEntries(await Promise.all(
    [...new Set(withStats.map((d) => d.stats))].map(async (path) => [path, await loadJson(path)])
  ));
  const statsFor = (d) => (d.statsPath ? d.statsPath.split('.').reduce((node, key) => node[key], files[d.stats]) : files[d.stats]);
  config = {
    app, basemaps, layers, cards, kecamatan, text,
    stats: Object.fromEntries(withStats.map((d) => [d.id, statsFor(d)]))
  };
  state.lang = app.language;
  state.kecamatan = kecamatan.default;
  state.table = cards.tableOptions[0].id;
  // Open on the first parameter that has data to draw.
  state.chart = (cards.chartOptions.find((o) => o.field && config.stats[o.dataset]) ?? cards.chartOptions[0]).id;

  setupHeader();
  render();
  mapView = await createMap({
    container: 'map', app, basemapConfig: basemaps, layers, kecamatan, i18n,
    onKecamatanClick: selectKecamatan,
    onVisibleChange: (datasets) => {
      state.visibleLayers = datasets;
      renderLegend();
    }
  });
}

init().catch((error) => {
  console.error(error);
  document.body.textContent = 'Dasbor gagal dimuat. / The dashboard could not be loaded.';
});
