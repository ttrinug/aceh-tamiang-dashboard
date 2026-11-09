// BRIN Survey: field points with a GPS location, photos, informants and findings.
//
// The site has no server, so new points are kept in this browser (IndexedDB) until they are
// exported to a file. Points that have been reviewed and built by scripts/build_survey.py are
// loaded from the dataset's GeoJSON and are read-only here. Informant names exist only in
// the local copy and the export file; published points carry roles only.
import { el } from './dom.js';
import { featureContains, pointReport } from './point-report.js';

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

// Two records are the same point when the survey time and the contributor are both filled in
// and identical. scripts/build_survey.py applies the same rule to export files.
const duplicateKey = (entry) => (entry.surveyedAt && entry.contributor ? `${entry.surveyedAt}|${entry.contributor}` : null);

const appendOnce = (text, addition) => {
  if (!addition || text.includes(addition)) return text;
  return text ? `${text}\n\n${addition}` : addition;
};

// Combines a duplicate into the more recently edited record. Findings, photos and informants
// from both are kept. A second location is written into the findings so a reviewer can see it.
// An informant counts as consenting only if both records say so.
function mergeEntries(newer, older) {
  const informants = newer.informants.map((person) => ({ ...person }));
  for (const person of older.informants) {
    const same = informants.find((p) => p.name === person.name && p.role === person.role);
    if (same) same.consent = Boolean(same.consent && person.consent);
    else informants.push(person);
  }
  let findings = appendOnce(newer.findings, older.findings);
  if (older.lat !== newer.lat || older.lon !== newer.lon) {
    findings = appendOnce(findings, `Lokasi lain yang digabung: ${older.lat}, ${older.lon}${older.place ? ` (${older.place})` : ''}`);
  }
  return { ...newer, place: newer.place || older.place, findings, informants, photos: [...new Set([...newer.photos, ...older.photos])] };
}

// A local date and time in the form a datetime-local input expects.
function localDateTime(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function createSurvey({ dataset, boundariesFile, i18n, reportSources, onDataChange, onGoTo, setStatus }) {
  const { t } = i18n;
  let local = [];
  let published = [];
  let boundaries = [];
  const dialog = document.getElementById('survey-dialog');
  const locale = () => (document.documentElement.lang === 'id' ? 'id-ID' : 'en-GB');
  const formatDate = (value) => (value ? new Date(value).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const kecamatanAt = (lon, lat) => boundaries.find((f) => featureContains(f, [lon, lat]))?.properties.name ?? null;

  // A local copy of a published point stays on the device, because only it holds the informant
  // names, but leaves the Local list. If it was edited after publishing it is listed again.
  const isPublished = (entry) => published.some((p) => {
    const same = p.id === entry.id || (duplicateKey(p) && duplicateKey(p) === duplicateKey(entry));
    return same && String(entry.updatedAt) <= String(p.updatedAt ?? '');
  });
  const waiting = () => local.filter((e) => !isPublished(e));

  function toGeoJson() {
    const point = (id, lon, lat) => ({ type: 'Feature', properties: { id }, geometry: { type: 'Point', coordinates: [lon, lat] } });
    return {
      type: 'FeatureCollection',
      features: [...published.map((e) => point(e.id, e.lon, e.lat)), ...waiting().map((e) => point(e.id, e.lon, e.lat))]
    };
  }

  function fillList(name, entries, emptyKey) {
    const list = document.getElementById(`survey-rows-${name}`);
    document.getElementById(`survey-count-${name}`).textContent = entries.length;
    if (!entries.length) {
      list.replaceChildren(el('li', 'empty', t(emptyKey)));
      return;
    }
    const newestFirst = [...entries].sort((a, b) => String(b.surveyedAt).localeCompare(String(a.surveyedAt)));
    list.replaceChildren(...newestFirst.map((entry) => {
      const button = el('button', 'survey-row');
      button.type = 'button';
      button.append(
        el('span', 'survey-row-place', entry.place || t('survey.noPlace')),
        el('span', 'survey-row-meta', `${entry.kecamatan ?? t('survey.outside')} · ${formatDate(entry.surveyedAt)}`)
      );
      button.addEventListener('click', () => showEntry(entry));
      const goTo = el('button', 'survey-goto', t('survey.goTo'));
      goTo.type = 'button';
      goTo.addEventListener('click', () => onGoTo(entry.lon, entry.lat));
      const item = el('li', 'survey-item');
      item.append(button, goTo);
      return item;
    }));
  }

  function renderList() {
    const entries = waiting();
    fillList('local', entries, 'survey.emptyLocal');
    fillList('published', published, 'survey.emptyPublished');
    for (const id of ['survey-export', 'survey-send']) document.getElementById(id).disabled = !entries.length;
  }

  // Replaces each group of duplicates on this device with one merged record, written before
  // the others are removed. Returns how many records were merged away.
  async function mergeLocalDuplicates() {
    const groups = new Map();
    for (const entry of local) {
      const key = duplicateKey(entry);
      if (key) groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    let merged = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const [newest, ...others] = group.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      await putLocal(others.reduce(mergeEntries, newest));
      for (const other of others) await deleteLocal(other.id);
      merged += others.length;
    }
    return merged;
  }

  const mergedText = (count) => t('survey.merged').replace('{n}', count);

  async function refresh() {
    local = await allLocal();
    const merged = await mergeLocalDuplicates();
    if (merged) {
      local = await allLocal();
      setStatus(mergedText(merged));
    }
    renderList();
    onDataChange(toGeoJson());
    return merged;
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

  // The report's rows appear when ready: the land cover image can take a moment to decode.
  // ready resolves once they are in place.
  function locationReport(entry) {
    const section = el('div', 'survey-report');
    const body = el('p', 'note', t('survey.reportLoading'));
    section.append(el('h3', null, t('survey.report')), body);
    if (!entry.kecamatan) {
      // The layers are clipped to the kabupaten, so outside it they say nothing either way.
      body.textContent = t('survey.reportOutside');
      return { section, ready: Promise.resolve() };
    }
    const ready = pointReport({ ...reportSources(), i18n }, entry.lon, entry.lat).then((groups) => {
      const content = groups.flatMap((group) => {
        const rows = el('dl', 'survey-facts');
        rows.append(...group.rows.map((row) => fact(row.label, row.value)));
        return [el('h4', null, group.label), rows];
      });
      const sources = [...new Set(groups.flatMap((group) => group.rows.map((row) => row.source)))].join('; ');
      body.replaceWith(...content, el('p', 'note', t('survey.reportNote')), el('p', 'note', `${t('source')}: ${sources}`));
    }).catch(() => {
      body.textContent = t('survey.reportFailed');
    });
    return { section, ready };
  }

  function factList(entry, isLocal) {
    const facts = el('dl', 'survey-facts');
    facts.append(
      fact(t('survey.place'), entry.place || t('survey.noPlace')),
      fact(t('kecamatan'), entry.kecamatan ?? t('survey.outside')),
      fact(t('survey.coordinates'), `${entry.lat.toFixed(5)}, ${entry.lon.toFixed(5)}`)
    );
    if (entry.accuracy_m) facts.append(fact(t('survey.accuracy'), `${Math.round(entry.accuracy_m)} m`));
    facts.append(
      fact(t('survey.date'), formatDate(entry.surveyedAt)),
      fact(t('survey.contributor'), entry.contributor || t('noData')),
      fact(t('survey.status'), isLocal ? t('survey.localStatus') : t('survey.published'))
    );
    return facts;
  }

  // A printed report can leave the project, so like the public site it shows only the roles of
  // informants who agreed, never a name, even for points still on this device.
  async function printReport(entry, isLocal) {
    const roles = isLocal ? entry.informants.filter((p) => p.consent && p.role).map((p) => p.role) : entry.roles ?? [];
    const people = el('ul', 'survey-people');
    people.append(...roles.map((role) => el('li', null, role)));
    const photos = (entry.photos ?? []).map((src) => {
      const image = el('img');
      image.src = src;
      image.alt = '';
      return image;
    });
    const gallery = el('div', 'survey-print-photos');
    gallery.append(...photos);
    const { section, ready } = locationReport(entry);
    document.getElementById('survey-print').replaceChildren(
      el('p', 'survey-print-kicker', t('survey.printHeading')),
      el('h1', null, entry.place || t('survey.noPlace')),
      factList(entry, isLocal),
      gallery,
      el('h3', null, t('survey.informants')),
      roles.length ? people : el('p', 'note', t('noData')),
      el('h3', null, t('survey.findings')),
      el('p', 'survey-findings', entry.findings),
      section,
      el('p', 'note', `${t('survey.printedOn')}: ${formatDate(new Date())}`)
    );
    await Promise.all([ready, ...photos.map((image) => image.decode().catch(() => {}))]);
    window.print();
  }

  function showDetail(id) {
    const entry = waiting().find((e) => e.id === id) ?? published.find((e) => e.id === id);
    if (entry) showEntry(entry);
  }

  function showEntry(entry) {
    const isLocal = local.includes(entry);
    const facts = factList(entry, isLocal);

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
    body.push(el('h3', null, t('survey.findings')), el('p', 'survey-findings', entry.findings), locationReport(entry).section);

    const actions = el('div', 'survey-actions');
    const print = el('button', null, t('survey.print'));
    print.type = 'button';
    print.addEventListener('click', () => printReport(entry, isLocal));
    actions.append(print);
    body.push(actions);

    if (isLocal) {
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
        gpsStatus.textContent = `${t('survey.accuracy')}: ${Math.round(accuracy)} m`;
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
    // A new point starts with the contributor of the latest point on this device.
    const latestContributor = [...local].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]?.contributor;
    const contributor = input('text', existing?.contributor ?? latestContributor ?? '');

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
      if (!contributor.value.trim()) return fail(t('survey.contributorRequired'));
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
        contributor: contributor.value.trim(),
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
      field(t('survey.contributor'), contributor, t('survey.contributorHint')),
      el('h3', null, t('survey.photos')), field(t('survey.addPhotos'), picker), previews,
      el('h3', null, t('survey.informants')), informants, addInformant,
      el('h3', null, t('survey.findings')), field(t('survey.findingsHint'), findings),
      error, save
    ]);
    if (!existing) readGps();
  }

  // ---------------------------------------------------------------- export and import

  function downloadExport() {
    const entries = waiting();
    const stamp = localDateTime().replace('T', '_').replace(':', '');
    const blob = new Blob([JSON.stringify({ format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), entries })], { type: 'application/json' });
    const link = el('a');
    link.href = URL.createObjectURL(blob);
    link.download = `brin_survey_export_${stamp}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    return { file: link.download, count: entries.length };
  }

  function exportFile() {
    downloadExport();
    setStatus(t('survey.exported'));
  }

  // A web page cannot attach a file to an email, so this saves the export and opens an
  // addressed email for the sender to attach it to. The email text holds no informant names.
  function sendByEmail() {
    const { file, count } = downloadExport();
    const subject = encodeURIComponent(t('survey.emailSubject'));
    const body = encodeURIComponent(t('survey.emailBody').replace('{n}', count).replace('{file}', file));
    const link = el('a');
    link.href = `mailto:${dataset.sendTo}?subject=${subject}&body=${body}`;
    link.click();
    setStatus(t('survey.emailHint').replace('{file}', file).replace('{email}', dataset.sendTo));
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
      const merged = await refresh();
      setStatus([t('survey.imported').replace('{n}', added), merged ? mergedText(merged) : ''].join(' ').trim());
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
      document.getElementById('survey-send').addEventListener('click', sendByEmail);
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
