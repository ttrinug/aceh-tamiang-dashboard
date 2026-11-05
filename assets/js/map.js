import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.15.0/dist/maplibre-gl.mjs';
import { el } from './dom.js';

const SELECTED_FILL = '#08519c';

// Turns a basemap entry from config/basemaps.json into a MapLibre style.
function styleFor(basemap) {
  if (basemap.type === 'style') return basemap.style;
  return {
    version: 8,
    glyphs: basemap.glyphs,
    sources: {
      [basemap.id]: {
        type: 'raster',
        tiles: basemap.tiles,
        tileSize: basemap.tileSize,
        maxzoom: basemap.maxzoom
      }
    },
    layers: [{ id: basemap.id, type: 'raster', source: basemap.id }]
  };
}

// [west, south, east, north] of one GeoJSON feature.
function featureBounds(feature) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      bounds[0] = Math.min(bounds[0], coords[0]);
      bounds[1] = Math.min(bounds[1], coords[1]);
      bounds[2] = Math.max(bounds[2], coords[0]);
      bounds[3] = Math.max(bounds[3], coords[1]);
    } else {
      coords.forEach(visit);
    }
  };
  visit(feature.geometry.coordinates);
  return bounds;
}

// Kecamatan boundary layers. A white casing under each line keeps it visible on both basemaps,
// and the selected kecamatan is shown by a thicker line and a light fill, not by colour alone.
function boundaryLayers(dataset, selectedId) {
  const isSelected = ['==', ['get', 'code'], selectedId];
  const color = dataset.legend.color;
  return [
    { id: 'kecamatan-fill', type: 'fill', paint: { 'fill-color': SELECTED_FILL, 'fill-opacity': ['case', isSelected, 0.12, 0] } },
    { id: 'kecamatan-casing', type: 'line', paint: { 'line-color': '#ffffff', 'line-opacity': 0.8, 'line-width': ['case', isSelected, 6, 3] } },
    { id: 'kecamatan-line', type: 'line', paint: { 'line-color': color, 'line-width': ['case', isSelected, 3, 1.2] } },
    {
      id: 'kecamatan-label',
      type: 'symbol',
      source: `${dataset.id}-labels`,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['case', isSelected, 14, 12],
        'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'],
        'text-radial-offset': 0.5
      },
      paint: { 'text-color': '#1f2933', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }
    }
  ].map((layer) => ({ source: dataset.id, ...layer }));
}

// A single-colour extent, such as the observed flood: a fill with a thin outline so small
// patches stay visible.
function fillLayers(dataset) {
  const color = dataset.legend.color;
  return [
    { id: `${dataset.id}-fill`, type: 'fill', source: dataset.id, paint: { 'fill-color': color, 'fill-opacity': 0.6 } },
    { id: `${dataset.id}-outline`, type: 'line', source: dataset.id, paint: { 'line-color': color, 'line-width': 0.5 } }
  ];
}

// Classed polygons, such as InaRISK hazard index classes. Colours come from the dataset's
// legend items, matched on the legend field; the legend names every class.
function classLayers(dataset) {
  const { field, items } = dataset.legend;
  const color = ['match', ['get', field], ...items.flatMap((item) => [item.value, item.color]), '#000000'];
  return [{ id: `${dataset.id}-fill`, type: 'fill', source: dataset.id, paint: { 'fill-color': color, 'fill-opacity': 0.6 } }];
}

// A pre-rendered map image (population, land cover), drawn with sharp cell edges.
function imageLayers(dataset) {
  return [{
    id: `${dataset.id}-image`,
    type: 'raster',
    source: dataset.id,
    paint: { 'raster-opacity': 0.8, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 }
  }];
}

// Point locations, such as facilities: small circles with a white ring so they stand out
// on both basemaps and over other layers.
function pointLayers(dataset) {
  return [{
    id: `${dataset.id}-points`,
    type: 'circle',
    source: dataset.id,
    paint: {
      'circle-color': dataset.legend.color,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 14, 7],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5
    }
  }];
}

// Reported locations shown with an icon (SITABA infrastructure). The icon image is added
// to the map under the name in dataset.legend.icon; see loadIcons().
function iconLayers(dataset) {
  return [{
    id: `${dataset.id}-icons`,
    type: 'symbol',
    source: dataset.id,
    layout: {
      'icon-image': dataset.legend.icon,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.7, 14, 1],
      'icon-allow-overlap': true
    }
  }];
}

// Map layers per renderer, in drawing order (first is drawn lowest).
// Each dataset in config/layers.json names its renderer.
const RENDERERS = {
  image: imageLayers,
  classes: classLayers,
  fill: fillLayers,
  boundaries: boundaryLayers,
  points: pointLayers,
  icons: iconLayers
};

// Decodes one icon image per icon dataset before the map is created, so the images can be
// added to the style on every style.load (a basemap switch clears them).
async function loadIcons(datasets) {
  return Promise.all(datasets.filter((d) => d.renderer === 'icons').map(async (dataset) => {
    const image = new Image();
    image.src = `assets/icons/${dataset.legend.icon}.svg`;
    await image.decode();
    return { id: dataset.legend.icon, image };
  }));
}

// Popup content for one icon feature, built from DOM nodes (never HTML strings) because the
// values come from an outside source. Blank values show as "No data yet".
function popupContent(dataset, properties, { t, pick }) {
  const body = el('div', 'map-popup');
  body.append(el('p', 'map-popup-title', pick(dataset.label)));
  const list = el('dl');
  for (const field of dataset.popupFields) {
    const value = properties[field.field];
    const blank = value === undefined || value === null || value === '';
    list.append(el('dt', null, pick(field.label)), el('dd', blank ? 'no-data' : null, blank ? t('noData') : String(value)));
  }
  body.append(list, el('p', 'map-popup-source', `${t('source')}: ${dataset.sourceShort ?? dataset.source} · ${t('date')}: ${dataset.date ?? t('unconfirmed')}`));
  return body;
}
const layersFor = (dataset, selectedId) => RENDERERS[dataset.renderer](dataset, selectedId);

// Compact, collapsible control holding the basemap switch and the data layer list.
class LayerControl {
  constructor(options) {
    Object.assign(this, options);
  }

  onAdd() {
    this.container = el('details', 'maplibregl-ctrl layer-control');
    this.render();
    return this.container;
  }

  onRemove() {
    this.container.remove();
  }

  render() {
    const { t, pick } = this.i18n;
    const body = el('div', 'layer-control-body');

    const basemapSet = el('fieldset');
    basemapSet.append(el('legend', null, t('map.basemap')));
    for (const basemap of this.basemaps) {
      const input = el('input');
      input.type = 'radio';
      input.name = 'basemap';
      input.value = basemap.id;
      input.checked = basemap.id === this.selectedId;
      input.addEventListener('change', () => {
        this.selectedId = basemap.id;
        this.onBasemapChange(basemap);
      });
      const label = el('label', 'option');
      label.append(input, pick(basemap.label));
      basemapSet.append(label);
    }

    // Legends are shown in the legend panel beside the map, for active layers only.
    // Source and date are listed in the About panel.
    const option = (input, dataset) => {
      const label = el('label', input.disabled ? 'option disabled' : 'option');
      const text = el('span');
      text.append(dataset ? pick(dataset.label) : t('map.none'));
      if (input.disabled) text.append(el('span', 'status', t('noData')));
      label.append(input, text);
      return label;
    };

    const layerSet = el('fieldset');
    layerSet.append(el('legend', null, t('map.dataLayers')));
    for (const group of this.layers.groups) {
      const datasets = this.layers.datasets.filter((d) => d.map && d.group === group.id);
      if (!datasets.length) continue;
      layerSet.append(el('p', 'group-label', pick(group.label)));

      // An exclusive group (modelled hazards) shows one layer at a time, or none.
      if (group.exclusive) {
        const choose = (chosen) => {
          for (const dataset of datasets) {
            if (dataset.file && this.visible.has(dataset.id) !== (dataset === chosen)) this.onLayerToggle(dataset, dataset === chosen);
          }
        };
        const none = el('input');
        none.type = 'radio';
        none.name = `group-${group.id}`;
        none.checked = !datasets.some((d) => this.visible.has(d.id));
        none.addEventListener('change', () => choose(null));
        layerSet.append(option(none, null));
        for (const dataset of datasets) {
          const input = el('input');
          input.type = 'radio';
          input.name = `group-${group.id}`;
          input.disabled = !dataset.file;
          input.checked = this.visible.has(dataset.id);
          input.addEventListener('change', () => choose(dataset));
          layerSet.append(option(input, dataset));
        }
        continue;
      }

      for (const dataset of datasets) {
        const input = el('input');
        input.type = 'checkbox';
        input.disabled = !dataset.file;
        input.checked = this.visible.has(dataset.id);
        input.addEventListener('change', () => this.onLayerToggle(dataset, input.checked));
        layerSet.append(option(input, dataset));
      }
    }

    body.append(basemapSet, layerSet);
    this.container.replaceChildren(el('summary', null, t('map.layers')), body);
  }
}

// Small note on the map that says which year the imagery is from.
class ImageryNote {
  onAdd() {
    this.container = el('p', 'maplibregl-ctrl imagery-note');
    this.container.hidden = true;
    return this.container;
  }

  onRemove() {
    this.container.remove();
  }

  set(text) {
    this.container.textContent = text || '';
    this.container.hidden = !text;
  }
}

// onVisibleChange(datasets) receives the visible datasets, topmost first, whenever they change.
export async function createMap({ container, app, basemapConfig, layers, kecamatan, i18n, onKecamatanClick, onVisibleChange }) {
  const basemaps = basemapConfig.basemaps;
  let current = basemaps.find((b) => b.id === basemapConfig.default);
  let selectedId = kecamatan.default;

  // Datasets that have a web file and a renderer, in drawing order, with their GeoJSON.
  // Map images need no download here; MapLibre loads them from their URL.
  const mapped = await Promise.all(Object.keys(RENDERERS)
    .flatMap((renderer) => layers.datasets.filter((d) => d.map && d.file && d.renderer === renderer))
    .map(async (dataset) => {
      if (dataset.renderer === 'image') return { dataset, data: null };
      const response = await fetch(dataset.file);
      if (!response.ok) throw new Error(`Could not load ${dataset.file} (${response.status})`);
      return { dataset, data: await response.json() };
    }));
  // Corner coordinates of the map images, written by scripts/build_rasters.py.
  const imageCorners = mapped.some((m) => m.dataset.renderer === 'image') ? await (await fetch(layers.imageCorners)).json() : {};
  const boundaries = mapped.find((m) => m.dataset.id === 'boundaries').dataset;
  const boundaryData = mapped.find((m) => m.dataset.id === 'boundaries').data;
  // One label point per kecamatan, from config/kecamatan.json.
  const labelData = {
    type: 'FeatureCollection',
    features: kecamatan.kecamatan.map((k) => ({
      type: 'Feature',
      properties: { code: k.id, name: k.name },
      geometry: { type: 'Point', coordinates: k.label }
    }))
  };
  const visible = new Set(layers.datasets.filter((d) => d.file && d.visible).map((d) => d.id));
  const reportVisible = () => onVisibleChange(mapped.map((m) => m.dataset).filter((d) => visible.has(d.id)).reverse());
  const icons = await loadIcons(mapped.map((m) => m.dataset));
  const iconDatasets = mapped.map((m) => m.dataset).filter((d) => d.renderer === 'icons');

  const map = new maplibregl.Map({
    container,
    style: styleFor(current),
    bounds: kecamatan.bounds,
    fitBoundsOptions: { padding: 20 },
    minZoom: app.map.minZoom,
    maxZoom: app.map.maxZoom,
    attributionControl: false
  });

  // Data layers are part of the style, so they are added again after every basemap switch.
  map.on('style.load', () => {
    for (const { id, image } of icons) {
      if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: 2 });
    }
    map.addSource(`${boundaries.id}-labels`, { type: 'geojson', data: labelData });
    for (const { dataset, data } of mapped) {
      // Image sources take no attribution, so their credit is added in setAttribution().
      if (dataset.renderer === 'image') map.addSource(dataset.id, { type: 'image', url: dataset.file, coordinates: imageCorners[dataset.image] });
      else map.addSource(dataset.id, { type: 'geojson', data, attribution: dataset.attribution });
      const visibility = visible.has(dataset.id) ? 'visible' : 'none';
      for (const layer of layersFor(dataset, selectedId)) {
        map.addLayer({ ...layer, layout: { ...layer.layout, visibility } });
      }
    }
  });

  // A click on an icon opens its popup and must not also select (and zoom to) the kecamatan below it.
  const visibleIconLayers = () => iconDatasets.filter((d) => visible.has(d.id)).map((d) => `${d.id}-icons`);
  map.on('click', 'kecamatan-fill', (event) => {
    const iconLayerIds = visibleIconLayers();
    if (iconLayerIds.length && map.queryRenderedFeatures(event.point, { layers: iconLayerIds }).length) return;
    if (visible.has(boundaries.id)) onKecamatanClick(event.features[0].properties.code);
  });
  map.on('mouseenter', 'kecamatan-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'kecamatan-fill', () => { map.getCanvas().style.cursor = ''; });

  for (const dataset of iconDatasets) {
    const layerId = `${dataset.id}-icons`;
    map.on('click', layerId, (event) => {
      const feature = event.features[0];
      new maplibregl.Popup({ maxWidth: '280px' })
        .setLngLat(feature.geometry.coordinates)
        .setDOMContent(popupContent(dataset, feature.properties, i18n))
        .addTo(map);
    });
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
  }

  // Attribution comes from config, so a replacement basemap keeps its credit.
  // compact: false keeps the full text visible at every screen width.
  let attribution;
  function setAttribution() {
    if (attribution) map.removeControl(attribution);
    const images = mapped.filter((m) => m.dataset.renderer === 'image' && visible.has(m.dataset.id));
    attribution = new maplibregl.AttributionControl({
      compact: false,
      customAttribution: [current.attribution, ...images.map((m) => m.dataset.attribution)]
    });
    map.addControl(attribution, 'bottom-right');
  }

  const imageryNote = new ImageryNote();
  const updateNote = () => imageryNote.set(current.caption && i18n.pick(current.caption));

  const layerControl = new LayerControl({
    basemaps,
    layers,
    i18n,
    visible,
    selectedId: current.id,
    onBasemapChange(basemap) {
      current = basemap;
      map.setStyle(styleFor(basemap));
      setAttribution();
      updateNote();
    },
    onLayerToggle(dataset, on) {
      if (on) visible.add(dataset.id);
      else visible.delete(dataset.id);
      for (const layer of layersFor(dataset, selectedId)) {
        map.setLayoutProperty(layer.id, 'visibility', on ? 'visible' : 'none');
      }
      if (dataset.renderer === 'image') setAttribution();
      reportVisible();
    }
  });

  map.addControl(layerControl, 'top-left');
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(imageryNote, 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  setAttribution();
  updateNote();
  reportVisible();

  // On phones the attribution spans the full width; keep the scale bar just above it,
  // since its height changes with the basemap and the layers shown.
  const attributionArea = map.getContainer().querySelector('.maplibregl-ctrl-bottom-right');
  new ResizeObserver(() => {
    map.getContainer().style.setProperty('--attribution-height', `${attributionArea.offsetHeight}px`);
  }).observe(attributionArea);

  return {
    // Called when the interface language changes.
    refreshText() {
      layerControl.render();
      updateNote();
    },

    // Highlights a kecamatan and zooms to it.
    selectKecamatan(id) {
      selectedId = id;
      for (const layer of boundaryLayers(boundaries, id)) {
        for (const [property, value] of Object.entries(layer.paint)) {
          if (map.getLayer(layer.id)) map.setPaintProperty(layer.id, property, value);
        }
        if (layer.layout && map.getLayer(layer.id)) map.setLayoutProperty(layer.id, 'text-size', layer.layout['text-size']);
      }
      const feature = boundaryData.features.find((f) => f.properties.code === id);
      if (feature) map.fitBounds(featureBounds(feature), { padding: 40, maxZoom: 13 });
    }
  };
}
