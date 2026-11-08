// BRIN Survey: field points with a GPS location, photos, informants and findings.
//
// The site has no server, so new points are kept in this browser (IndexedDB) until they are
// exported to a file. Points that have been reviewed and built by scripts/build_survey.py are
// loaded from the dataset's GeoJSON and are read-only here. Informant names exist only in
// the local copy and the export file; published points carry roles only.
import { el } from './dom.js';

const DB_NAME = 'brin-survey';
const STORE = 'entries';
const MAX_PHOTO_SIDE = 1600;
const EXPORT_FORMAT = 'brin-survey-export';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const allLocal = () => withStore('readonly', (store) => store.getAll());
const putLocal = (entry) => withStore('readwrite', (store) => store.put(entry));
const deleteLocal = (id) => withStore('readwrite', (store) => store.delete(id));

// Resizes a photo and re-encodes it as JPEG. Drawing to a canvas also drops the file's
// metadata, including any location the camera wrote into it.
async function photoToDataUrl(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = el('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.8);
}

function ringContains(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function featureContains(feature, point) {
  const { type, coordinates } = feature.geometry;
  const polygons = type === 'Polygon' ? [coordinates] : coordinates;
  return polygons.some((rings) => rings.reduce((inside, ring) => (ringContains(ring, point) ? !inside : inside), false));
}

// A local date and time in the form a datetime-local input expects.
function localDateTime(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function createSurvey({ dataset, boundariesFile, i18n, onDataChange, setStatus }) {
  const { t } = i18n;
  let local = [];
  let published = [];
  let boundaries = [];
  const dialog = document.getElementById('survey-dialog');
  const locale = () => (document.documentElement.lang === 'id' ? 'id-ID' : 'en-GB');
  const formatDate = (value) => (value ? new Date(value).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const kecamatanAt = (lon, lat) => boundaries.find((f) => featureContains(f, [lon, lat]))?.properties.name ?? null;

  function toGeoJson() {
    const point = (id, lon, lat) => ({ type: 'Feature', properties: { id }, geometry: { type: 'Point', coordinates: [lon, lat] } });
    return {
      type: 'FeatureCollection',
      features: [...published.map((e) => point(e.id, e.lon, e.lat)), ...local.map((e) => point(e.id, e.lon, e.lat))]
    };
  }

  function renderList() {
    const rows = [...local.map((e) => ({ entry: e, isLocal: true })), ...published.map((e) => ({ entry: e, isLocal: false }))]
      .sort((a, b) => String(b.entry.surveyedAt).localeCompare(String(a.entry.surveyedAt)));
    const list = document.getElementById('survey-rows');
    if (!rows.length) {
      list.replaceChildren(el('li', 'empty', t('survey.empty')));
    } else {
      list.replaceChildren(...rows.map(({ entry, isLocal }) => {
        const button = el('button', 'survey-row');
        button.type = 'button';
        button.append(
          el('span', 'survey-row-place', entry.place || t('survey.noPlace')),
          el('span', 'survey-row-meta', `${entry.kecamatan ?? t('survey.outside')} · ${formatDate(entry.surveyedAt)}`),
          el('span', isLocal ? 'survey-badge local' : 'survey-badge', isLocal ? t('survey.local') : t('survey.published'))
        );
        button.addEventListener('click', () => showDetail(entry.id));
        const item = el('li');
        item.append(button);
        return item;
      }));
    }
    document.getElementById('survey-export').disabled = !local.length;
  }

  async function refresh() {
    local = await allLocal();
    renderList();
    onDataChange(toGeoJson());
  }

  function closeButton() {
    const button = el('button', null, t('close'));
    button.type = 'button';
    button.addEventListener('click', () => dialog.close());
    return button;
  }

  function openDialog(title, body) {
    const head = el('div', 'dialog-head');
    head.append(el('h2', null, title), closeButton());
    const content = el('div', 'survey-dialog-body');
    content.append(...body);
    dialog.replaceChildren(head, content);
    if (!dialog.open) dialog.showModal();
  }

  // ---------------------------------------------------------------- detail and gallery

  function gallery(photos) {
    if (!photos.length) return el('p', 'note', t('survey.noPhotos'));
    const wrap = el('div', 'survey-gallery');
    const main = el('img', 'survey-gallery-main');
    main.src = photos[0];
    main.alt = t('survey.photos');
    wrap.append(main);
    if (photos.length > 1) {
      const strip = el('div', 'survey-gallery-strip');
      photos.forEach((src, i) => {
        const button = el('button');
        button.type = 'button';
        button.setAttribute('aria-label', `${t('survey.photos')} ${i + 1}`);
        const thumb = el('img');
        thumb.src = src;
        thumb.alt = '';
        button.append(thumb);
        button.addEventListener('click', () => { main.src = src; });
        strip.append(button);
      });
      wrap.append(strip);
    }
    return wrap;
  }

  function fact(label, value) {
    const row = el('div', 'survey-fact');
    row.append(el('dt', null, label), el('dd', null, value));
    return row;
  }

  function showDetail(id) {
    const entry = local.find((e) => e.id === id) ?? published.find((e) => e.id === id);
    if (!entry) return;
    const isLocal = local.includes(entry);
    const facts = el('dl', 'survey-facts');
    const accuracy = entry.accuracy_m ? ` (± ${Math.round(entry.accuracy_m)} m)` : '';
    facts.append(
      fact(t('survey.place'), entry.place || t('survey.noPlace')),
      fact(t('kecamatan'), entry.kecamatan ?? t('survey.outside')),
      fact(t('survey.coordinates'), `${entry.lat.toFixed(5)}, ${entry.lon.toFixed(5)}${accuracy}`),
      fact(t('survey.date'), formatDate(entry.surveyedAt)),
      fact(t('survey.status'), isLocal ? t('survey.local') : t('survey.published'))
    );

    const people = el('ul', 'survey-people');
    const informants = isLocal ? entry.informants : (entry.roles ?? []).map((role) => ({ role }));
    for (const person of informants) {
      const parts = isLocal ? [person.name, person.role].filter(Boolean).join(' · ') : person.role;
      people.append(el('li', null, parts || '—'));
    }

    const body = [
      gallery(entry.photos ?? []),
      facts,
      el('h3', null, t('survey.informants')),
      informants.length ? people : el('p', 'note', t('noData'))
    ];
    if (isLocal && informants.length) body.push(el('p', 'note', t('survey.namesPrivate')));
    body.push(el('h3', null, t('survey.findings')), el('p', 'survey-findings', entry.findings));

    if (isLocal) {
      const actions = el('div', 'survey-actions');
      const edit = el('button', null, t('survey.edit'));
      edit.type = 'button';
      edit.addEventListener('click', () => showForm(entry));
      const remove = el('button', null, t('survey.delete'));
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (!confirm(t('survey.deleteConfirm'))) return;
        await deleteLocal(entry.id);
        dialog.close();
        await refresh();
      });
      actions.append(edit, remove);
      body.push(actions);
    }
    openDialog(entry.place || dataset.label[document.documentElement.lang], body);
  }

  // ---------------------------------------------------------------- form

  function field(labelText, control, hint) {
    const label = el('label', 'survey-field');
    label.append(el('span', 'survey-label', labelText), control);
    if (hint) label.append(el('span', 'note', hint));
    return label;
  }

  function input(type, value = '') {
    const node = el('input');
    node.type = type;
    node.value = value;
    return node;
  }

  function informantRow(person = {}) {
    const row = el('div', 'survey-informant');
    const name = input('text', person.name ?? '');
    const role = input('text', person.role ?? '');
    const consent = input('checkbox');
    consent.checked = Boolean(person.consent);
    const consentLabel = el('label', 'survey-consent');
    consentLabel.append(consent, t('survey.consent'));
    const remove = el('button', null, t('survey.remove'));
    remove.type = 'button';
    remove.addEventListener('click', () => row.remove());
    row.append(field(t('survey.informantName'), name), field(t('survey.role'), role), consentLabel, remove);
    row.read = () => ({ name: name.value.trim(), role: role.value.trim(), consent: consent.checked });
    return row;
  }

  function showForm(existing = null) {
    const error = el('p', 'survey-error');
    error.hidden = true;
    const fail = (text) => {
      error.textContent = text;
      error.hidden = false;
      error.scrollIntoView({ block: 'nearest' });
    };

    const lat = input('number', existing?.lat ?? '');
    const lon = input('number', existing?.lon ?? '');
    lat.step = lon.step = 'any';
    lat.inputMode = lon.inputMode = 'decimal';
    let accuracy = existing?.accuracy_m ?? null;
    const gpsStatus = el('span', 'note');
    const gps = el('button', 'survey-gps', t('survey.useGps'));
    gps.type = 'button';
    const readGps = () => {
      if (!navigator.geolocation) {
        gpsStatus.textContent = t('survey.gpsFailed');
        return;
      }
      gps.disabled = true;
      gpsStatus.textContent = t('survey.gpsWaiting');
      navigator.geolocation.getCurrentPosition((position) => {
        lat.value = position.coords.latitude.toFixed(6);
        lon.value = position.coords.longitude.toFixed(6);
        accuracy = position.coords.accuracy;
        gpsStatus.textContent = `${t('survey.accuracy')}: ± ${Math.round(accuracy)} m`;
        gps.disabled = false;
      }, () => {
        gpsStatus.textContent = t('survey.gpsFailed');
        gps.disabled = false;
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    };
    gps.addEventListener('click', readGps);
    // A location typed by hand has no GPS accuracy.
    for (const node of [lat, lon]) node.addEventListener('input', () => { accuracy = null; gpsStatus.textContent = ''; });

    const place = input('text', existing?.place ?? '');
    const date = input('datetime-local', existing?.surveyedAt ?? localDateTime());

    let photos = [...(existing?.photos ?? [])];
    const previews = el('div', 'survey-previews');
    const drawPreviews = () => previews.replaceChildren(...photos.map((src, i) => {
      const item = el('div', 'survey-preview');
      const image = el('img');
      image.src = src;
      image.alt = '';
      const remove = el('button', null, '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', t('survey.remove'));
      remove.addEventListener('click', () => {
        photos.splice(i, 1);
        drawPreviews();
      });
      item.append(image, remove);
      return item;
    }));
    drawPreviews();
    const picker = input('file');
    picker.accept = 'image/*';
    picker.multiple = true;
    picker.addEventListener('change', async () => {
      for (const file of picker.files) {
        try {
          photos.push(await photoToDataUrl(file));
        } catch {
          fail(`${t('survey.photoFailed')}: ${file.name}`);
        }
      }
      picker.value = '';
      drawPreviews();
    });

    const informants = el('div', 'survey-informants');
    informants.append(...(existing?.informants ?? []).map(informantRow));
    const addInformant = el('button', null, t('survey.addInformant'));
    addInformant.type = 'button';
    addInformant.addEventListener('click', () => informants.append(informantRow()));

    const findings = el('textarea');
    findings.rows = 5;
    findings.value = existing?.findings ?? '';

    const save = el('button', 'survey-save', t('survey.save'));
    save.type = 'button';
    save.addEventListener('click', async () => {
      const latitude = Number(lat.value);
      const longitude = Number(lon.value);
      if (lat.value === '' || lon.value === '' || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return fail(t('survey.invalidLocation'));
      if (!findings.value.trim()) return fail(t('survey.findingsRequired'));
      const now = new Date().toISOString();
      const entry = {
        id: existing?.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        surveyedAt: date.value,
        lat: latitude,
        lon: longitude,
        accuracy_m: accuracy,
        place: place.value.trim(),
        kecamatan: kecamatanAt(longitude, latitude),
        findings: findings.value.trim(),
        informants: [...informants.children].map((row) => row.read()).filter((p) => p.name || p.role),
        photos
      };
      try {
        await putLocal(entry);
      } catch {
        return fail(t('survey.saveFailed'));
      }
      await refresh();
      showDetail(entry.id);
    });

    const coords = el('div', 'survey-coords');
    coords.append(field(t('survey.latitude'), lat), field(t('survey.longitude'), lon));
    const gpsRow = el('div', 'survey-gps-row');
    gpsRow.append(gps, gpsStatus);

    openDialog(existing ? t('survey.editTitle') : t('survey.formTitle'), [
      el('h3', null, t('survey.location')), gpsRow, coords, field(t('survey.place'), place), field(t('survey.date'), date),
      el('h3', null, t('survey.photos')), field(t('survey.addPhotos'), picker), previews,
      el('h3', null, t('survey.informants')), informants, addInformant,
      el('h3', null, t('survey.findings')), field(t('survey.findingsHint'), findings),
      error, save
    ]);
    if (!existing) readGps();
  }

  // ---------------------------------------------------------------- export and import

  function exportFile() {
    const stamp = localDateTime().replace('T', '_').replace(':', '');
    const blob = new Blob([JSON.stringify({ format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), entries: local })], { type: 'application/json' });
    const link = el('a');
    link.href = URL.createObjectURL(blob);
    link.download = `brin_survey_export_${stamp}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus(t('survey.exported'));
  }

  const validEntry = (e) => typeof e?.id === 'string' && Number.isFinite(e.lat) && Number.isFinite(e.lon)
    && Array.isArray(e.informants) && Array.isArray(e.photos) && e.photos.every((p) => /^data:image\/(jpeg|png);base64,/.test(p));

  // Merges an export from another device. Where both have a point, the newer edit is kept.
  async function importFile(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== EXPORT_FORMAT || !data.entries.every(validEntry)) throw new Error('format');
      let added = 0;
      for (const entry of data.entries) {
        const current = local.find((e) => e.id === entry.id);
        if (!current || String(entry.updatedAt) > String(current.updatedAt)) {
          await putLocal(entry);
          added += 1;
        }
      }
      await refresh();
      setStatus(t('survey.imported').replace('{n}', added));
    } catch {
      setStatus(t('survey.importFailed'));
    }
  }

  return {
    async init() {
      const load = async (path) => (await fetch(path)).json();
      const [bounds, points] = await Promise.all([load(boundariesFile), load(dataset.file)]);
      boundaries = bounds.features;
      published = points.features.map((f) => ({
        ...f.properties,
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1]
      }));
      // Asks the browser not to clear these entries when storage runs low.
      navigator.storage?.persist?.();

      document.getElementById('survey-add').addEventListener('click', () => showForm());
      document.getElementById('survey-export').addEventListener('click', exportFile);
      const picker = document.getElementById('survey-import');
      picker.addEventListener('change', async () => {
        if (picker.files[0]) await importFile(picker.files[0]);
        picker.value = '';
      });
      await refresh();
    },
    render: renderList,
    showDetail
  };
}
