// What the dashboard's own map layers say at one point: flood extent, hazard class, land cover
// and so on. Rows come from config/layers.json, so a layer added there appears here too, under
// its group, which keeps observed and modelled data apart.

function ringContains(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function featureContains(feature, point) {
  const { type, coordinates } = feature.geometry;
  const polygons = type === 'Polygon' ? [coordinates] : coordinates;
  return polygons.some((rings) => rings.reduce((inside, ring) => (ringContains(ring, point) ? !inside : inside), false));
}

const mercatorY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

// Decoded map images, kept so that later reports do not decode them again.
const images = new Map();

function loadImage(file) {
  if (!images.has(file)) {
    const image = new Image();
    image.src = file;
    images.set(file, image.decode().then(() => image));
  }
  return images.get(file);
}

// The RGBA value of the map image at a point, or null outside the image. The images are in
// Web Mercator (scripts/build_rasters.py), so rows are spaced evenly in Mercator y, not latitude.
async function pixelAt(file, corners, [lon, lat]) {
  const [[west, north], , [east, south]] = corners;
  const image = await loadImage(file);
  const column = Math.floor(((lon - west) / (east - west)) * image.naturalWidth);
  const row = Math.floor(((mercatorY(north) - mercatorY(lat)) / (mercatorY(north) - mercatorY(south))) * image.naturalHeight);
  if (column < 0 || row < 0 || column >= image.naturalWidth || row >= image.naturalHeight) return null;
  // Copies one cell only: a canvas the size of the land cover image is too large for some tablets.
  const cell = await createImageBitmap(image, column, row, 1, 1, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(cell, 0, 0);
  cell.close();
  return context.getImageData(0, 0, 1, 1).data;
}

const toHex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

async function imageValue(dataset, corners, point, { t, pick }) {
  let pixel;
  try {
    pixel = await pixelAt(dataset.file, corners, point);
  } catch {
    return t('noData');
  }
  if (!pixel || pixel[3] === 0) return dataset.reportEmpty ? pick(dataset.reportEmpty) : t('noData');
  const item = dataset.legend.items.find((i) => i.color === toHex(pixel));
  if (!item) return t('noData');
  const label = pick(item.reportLabel ?? item.label);
  return dataset.reportUnit ? `${label} ${pick(dataset.reportUnit)}` : label;
}

function polygonValue(dataset, data, point, { t, pick }) {
  const feature = data.features.find((f) => featureContains(f, point));
  if (dataset.renderer === 'fill') return t(feature ? 'survey.detected' : 'survey.notDetected');
  if (!feature) return t('survey.notRated');
  const item = dataset.legend.items.find((i) => i.value === feature.properties[dataset.legend.field]);
  return item ? pick(item.label) : t('noData');
}

// Returns [{ label, rows: [{ label, value }] }], one entry per layer group that has any rows.
export async function pointReport({ layers, datasetData, imageCorners, i18n }, lon, lat) {
  const point = [lon, lat];
  const sections = await Promise.all(layers.groups.map(async (group) => {
    const datasets = layers.datasets.filter((d) => d.map && d.file && d.group === group.id && ['fill', 'classes', 'image'].includes(d.renderer));
    const rows = await Promise.all(datasets.map(async (dataset) => ({
      label: i18n.pick(dataset.label),
      value: dataset.renderer === 'image'
        ? await imageValue(dataset, imageCorners[dataset.image], point, i18n)
        : polygonValue(dataset, datasetData(dataset.id), point, i18n)
    })));
    return { label: i18n.pick(group.label), rows };
  }));
  return sections.filter((section) => section.rows.length);
}
