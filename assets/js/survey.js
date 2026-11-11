// BRIN Survey: field points with a GPS location, photos, informants and findings.
//
// The site has no server, so new points are kept in this browser (IndexedDB) until they are
// exported to a file. Points that have been reviewed and built by scripts/build_survey.py are
// loaded from the dataset's GeoJSON and are read-only here. Informant names exist only in
// the local copy and the export file; published points carry roles only.
//
// Documentation entries (kind "documentation") are simpler: photos with captions and notes. Each
// photo is placed on the map at the GPS position stored in the photo itself; a photo without
// one cannot be added. They share the device storage, lists and export file with survey points.
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

const readDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

// The photo file exactly as the camera or gallery gave it, metadata included. It is kept on the
// device and in the export file only; scripts/build_survey.py saves it to the private data/raw.
async function originalOf(file) {
  return { name: file.name, type: file.type, data: await readDataUrl(file) };
}

// Approximate size of a data URL's file, in bytes.
const dataUrlBytes = (dataUrl) => Math.round(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

function formatSize(bytes) {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

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

// exifr reads the location and time a camera stores in a photo (JPEG and HEIC). It is loaded
// only when documentation photos are added.
const EXIFR_URL = 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.esm.mjs';
let exifr;

// The photo's GPS position and capture time, or null when it holds no usable position.
// Some cameras write 0, 0 when they have no fix; that is treated as no position.
async function photoMetadata(file) {
  if (!exifr) {
    const module = await import(EXIFR_URL);
    exifr = module.default ?? module;
  }
  // A plain parse: exifr's "pick" option fails in this build.
  const meta = await exifr.parse(file).catch(() => null);
  const { latitude: lat, longitude: lon } = meta ?? {};
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const taken = meta.DateTimeOriginal ?? meta.CreateDate;
  return { lat, lon, takenAt: taken instanceof Date && !Number.isNaN(taken.getTime()) ? localDateTime(taken) : null };
}

const isDoc = (entry) => entry.kind === 'documentation';
// Where a list row or "Go to point" leads: a survey point, or a documentation entry's first photo.
const anchorOf = (entry) => (isDoc(entry) ? entry.photos[0] : entry);
const sortDate = (entry) => String(isDoc(entry) ? entry.photos[0]?.takenAt ?? entry.createdAt : entry.surveyedAt);

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
  // Each photo keeps its original file, matched by position in the two lists.
  const pairs = new Map();
  for (const entry of [newer, older]) {
    entry.photos.forEach((photo, i) => { if (!pairs.has(photo)) pairs.set(photo, entry.originals?.[i] ?? null); });
  }
  const { uploadedVersion, ...rest } = newer;
  return {
    ...rest, ...mergedVersion(newer, older),
    place: newer.place || older.place, findings, informants, photos: [...pairs.keys()], originals: [...pairs.values()]
  };
}

// Edit history. Each record lists the versions (updatedAt values) it was made from, so a newer
// version replaces an older one only when it was edited from it. Two versions edited separately,
// such as on two tablets, are merged instead, so neither edit is lost.
const historyOf = (entry) => [...(entry.versions ?? []), entry.updatedAt];
const supersedes = (a, b) => a.updatedAt === b.updatedAt || (a.versions ?? []).includes(b.updatedAt);

// A merge is new content: it gets a new version that descends from both, so it is uploaded again.
// Its time is never earlier than either version, even on a tablet whose clock is behind.
function mergedVersion(a, b) {
  const latest = Math.max(Date.parse(a.updatedAt) || 0, Date.parse(b.updatedAt) || 0);
  const updatedAt = new Date(Math.max(Date.now(), latest + 1)).toISOString();
  return { updatedAt, versions: [...new Set([...historyOf(a), ...historyOf(b)])].sort() };
}

// Documentation edited separately: photos from both (the same photo once), notes from both.
function mergeDocs(newer, older) {
  const signature = (p) => `${p.takenAt}|${p.lat.toFixed(6)}|${p.lon.toFixed(6)}`;
  const seen = new Set(newer.photos.map(signature));
  const { uploadedVersion, ...rest } = newer;
  return {
    ...rest, ...mergedVersion(newer, older),
    notes: appendOnce(newer.notes ?? '', older.notes ?? ''),
    photos: [...newer.photos, ...older.photos.filter((p) => !seen.has(signature(p)))]
  };
}

// A local date and time in the form a datetime-local input expects.
function localDateTime(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function createSurvey({ dataset, docDataset, boundariesFile, i18n, reportSources, onDataChange, onGoTo, setStatus }) {
  const { t } = i18n;
  let local = [];
  let published = [];
  let publishedDocs = [];
  let boundaries = [];
  const dialog = document.getElementById('survey-dialog');
  const locale = () => (document.documentElement.lang === 'id' ? 'id-ID' : 'en-GB');
  const formatDate = (value) => (value ? new Date(value).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const kecamatanAt = (lon, lat) => boundaries.find((f) => featureContains(f, [lon, lat]))?.properties.name ?? null;

  // A local copy of a published point stays on the device, because only it holds the informant
  // names, but leaves the Local list. If it was edited after publishing it is listed again.
  const isPublished = (entry) => {
    const newerOrSame = (p) => String(entry.updatedAt) <= String(p.updatedAt ?? '');
    if (isDoc(entry)) return publishedDocs.some((p) => p.id === entry.id && newerOrSame(p));
    return published.some((p) => (p.id === entry.id || (duplicateKey(p) && duplicateKey(p) === duplicateKey(entry))) && newerOrSame(p));
  };
  const waiting = () => local.filter((e) => !isPublished(e));
  const latestContributor = () => [...local].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]?.contributor;

  // Map features: one per survey point, and one per documentation photo.
  function toGeoJson() {
    const point = (properties, lon, lat) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [lon, lat] } });
    const collection = (features) => ({ type: 'FeatureCollection', features });
    const pending = waiting();
    const surveyPoints = [...published, ...pending.filter((e) => !isDoc(e))];
    const docs = [...publishedDocs, ...pending.filter(isDoc)];
    return {
      points: collection(surveyPoints.map((e) => point({ id: e.id }, e.lon, e.lat))),
      docs: collection(docs.flatMap((e) => e.photos.map((p, i) => point({ id: e.id, photo: i }, p.lon, p.lat))))
    };
  }

  function fillList(name, entries, emptyKey) {
    const list = document.getElementById(`survey-rows-${name}`);
    document.getElementById(`survey-count-${name}`).textContent = entries.length;
    if (!entries.length) {
      list.replaceChildren(el('li', 'empty', t(emptyKey)));
      return;
    }
    const newestFirst = [...entries].sort((a, b) => sortDate(b).localeCompare(sortDate(a)));
    list.replaceChildren(...newestFirst.map((entry) => {
      const button = el('button', isDoc(entry) ? 'survey-row doc' : 'survey-row');
      button.type = 'button';
      const anchor = anchorOf(entry);
      const title = isDoc(entry)
        ? `${t('survey.docTitle')} · ${t('survey.docPhotos').replace('{n}', entry.photos.length)}`
        : entry.place || t('survey.noPlace');
      button.append(
        el('span', 'survey-row-place', title),
        el('span', 'survey-row-meta', `${anchor.kecamatan ?? t('survey.outside')} · ${formatDate(sortDate(entry))}`)
      );
      button.addEventListener('click', () => (isDoc(entry) ? showDocEntry(entry) : showEntry(entry)));
      const goTo = el('button', 'survey-goto', t('survey.goTo'));
      goTo.type = 'button';
      goTo.addEventListener('click', () => onGoTo(anchor.lon, anchor.lat, isDoc(entry)));
      const item = el('li', 'survey-item');
      item.append(button, goTo);
      return item;
    }));
  }

  function renderList() {
    const entries = waiting();
    fillList('local', entries, 'survey.emptyLocal');
    fillList('published', [...published, ...publishedDocs], 'survey.emptyPublished');
    for (const id of ['survey-export', 'survey-upload']) document.getElementById(id).disabled = !entries.length;
  }

  // Replaces each group of duplicates on this device with one merged record, written before
  // the others are removed. Returns how many records were merged away.
  async function mergeLocalDuplicates() {
    const groups = new Map();
    for (const entry of local.filter((e) => !isDoc(e))) {
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
    const { points, docs } = toGeoJson();
    onDataChange(points, docs);
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

  function showDocumentation(id, index = 0) {
    const entry = waiting().find((e) => e.id === id && isDoc(e)) ?? publishedDocs.find((e) => e.id === id);
    if (entry) showDocEntry(entry, Number(index) || 0);
  }

  // One documentation entry, showing one photo at a time with its own location and time.
  function showDocEntry(entry, index = 0) {
    const isLocal = local.includes(entry);
    const photo = entry.photos[index] ?? entry.photos[0];
    const wrap = el('div', 'survey-gallery');
    const main = el('img', 'survey-gallery-main');
    main.src = photo.photo;
    main.alt = photo.caption || t('survey.photos');
    wrap.append(main);
    if (entry.photos.length > 1) {
      const strip = el('div', 'survey-gallery-strip');
      entry.photos.forEach((p, i) => {
        const button = el('button');
        button.type = 'button';
        button.setAttribute('aria-label', `${t('survey.photos')} ${i + 1}`);
        if (i === index) button.setAttribute('aria-current', 'true');
        const thumb = el('img');
        thumb.src = p.photo;
        thumb.alt = '';
        button.append(thumb);
        button.addEventListener('click', () => showDocEntry(entry, i));
        strip.append(button);
      });
      wrap.append(strip);
    }

    const facts = el('dl', 'survey-facts');
    facts.append(
      fact(t('survey.caption'), photo.caption || t('noData')),
      fact(t('survey.photoNumber'), t('survey.photoOf').replace('{i}', index + 1).replace('{n}', entry.photos.length)),
      fact(t('kecamatan'), photo.kecamatan ?? t('survey.outside')),
      fact(t('survey.coordinates'), `${photo.lat.toFixed(5)}, ${photo.lon.toFixed(5)}`),
      fact(t('survey.takenAt'), formatDate(photo.takenAt)),
      fact(t('survey.contributor'), entry.contributor || t('noData')),
      fact(t('survey.status'), isLocal ? t('survey.localStatus') : t('survey.published'))
    );
    const originals = entry.photos.map((p) => p.original).filter((o) => o?.data);
    if (isLocal && originals.length) {
      const bytes = originals.reduce((sum, o) => sum + dataUrlBytes(o.data), 0);
      facts.append(fact(t('survey.originals'), `${originals.length} · ${formatSize(bytes)}`));
    }
    if (isLocal) facts.append(uploadFact(entry));

    const body = [
      wrap,
      facts,
      el('p', 'note', t('survey.docLocationNote')),
      el('h3', null, t('survey.notes')),
      entry.notes ? el('p', 'survey-findings', entry.notes) : el('p', 'note', t('noData')),
      locationReport(photo).section
    ];
    if (isLocal) {
      const actions = el('div', 'survey-actions');
      const edit = el('button', null, t('survey.edit'));
      edit.type = 'button';
      edit.addEventListener('click', () => showDocForm(entry));
      const remove = el('button', null, t('survey.delete'));
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (!confirm(t('survey.deleteDocConfirm'))) return;
        await deleteLocal(entry.id);
        dialog.close();
        await refresh();
      });
      actions.append(edit, remove);
      body.push(actions);
    }
    openDialog(t('survey.docTitle'), body);
  }

  const isUploaded = (entry) => entry.uploadedVersion === entry.updatedAt;
  const uploadFact = (entry) => fact(t('survey.uploadedFact'), t(isUploaded(entry) ? 'survey.yes' : 'survey.notYet'));

  function showDetail(id) {
    const entry = waiting().find((e) => e.id === id) ?? published.find((e) => e.id === id);
    if (entry) showEntry(entry);
  }

  function showEntry(entry) {
    const isLocal = local.includes(entry);
    const facts = factList(entry, isLocal);
    const originals = (entry.originals ?? []).filter((o) => o?.data);
    if (isLocal && originals.length) {
      const bytes = originals.reduce((sum, o) => sum + dataUrlBytes(o.data), 0);
      facts.append(fact(t('survey.originals'), `${originals.length} · ${formatSize(bytes)}`));
    }
    if (isLocal) facts.append(uploadFact(entry));

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
    const contributor = input('text', existing?.contributor ?? latestContributor() ?? '');

    // Each photo: the resized copy shown and published, and the original file (null for photos
    // added before originals were kept).
    const photos = (existing?.photos ?? []).map((photo, i) => ({ photo, original: existing.originals?.[i] ?? null }));
    const previews = el('div', 'survey-previews');
    const drawPreviews = () => previews.replaceChildren(...photos.map(({ photo: src }, i) => {
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
          photos.push({ photo: await photoToDataUrl(file), original: await originalOf(file) });
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
        versions: existing ? historyOf(existing) : [],
        surveyedAt: date.value,
        lat: latitude,
        lon: longitude,
        accuracy_m: accuracy,
        place: place.value.trim(),
        contributor: contributor.value.trim(),
        kecamatan: kecamatanAt(longitude, latitude),
        findings: findings.value.trim(),
        informants: [...informants.children].map((row) => row.read()).filter((p) => p.name || p.role),
        photos: photos.map((p) => p.photo),
        originals: photos.map((p) => p.original)
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

    openDialog(existing ? t('survey.editTitle') : t('survey.add'), [
      ...(existing ? [] : [tabBar('survey')]),
      el('h3', null, t('survey.location')), gpsRow, coords, field(t('survey.place'), place), field(t('survey.date'), date),
      field(t('survey.contributor'), contributor, t('survey.contributorHint')),
      el('h3', null, t('survey.photos')), field(t('survey.addPhotos'), picker), previews,
      el('h3', null, t('survey.informants')), informants, addInformant,
      el('h3', null, t('survey.findings')), field(t('survey.findingsHint'), findings),
      error, save
    ]);
    if (!existing) readGps();
  }

  // The two kinds of new record, as tabs at the top of the Add point window.
  function tabBar(active) {
    const bar = el('div', 'survey-tabs');
    bar.setAttribute('role', 'tablist');
    for (const [kind, key, open] of [['survey', 'survey.tabSurvey', () => showForm()], ['doc', 'survey.tabDocs', () => showDocForm()]]) {
      const button = el('button', null, t(key));
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(kind === active));
      if (kind !== active) button.addEventListener('click', open);
      bar.append(button);
    }
    return bar;
  }

  // Documentation: photos placed by their own GPS metadata, a caption each, and general notes.
  function showDocForm(existing = null) {
    const error = el('p', 'survey-error');
    error.hidden = true;
    const fail = (text) => {
      error.textContent = text;
      error.hidden = false;
      error.scrollIntoView({ block: 'nearest' });
    };

    const contributor = input('text', existing?.contributor ?? latestContributor() ?? '');
    const photos = (existing?.photos ?? []).map((p) => ({ ...p }));
    const previews = el('div', 'doc-previews');
    const drawPreviews = () => previews.replaceChildren(...photos.map((p, i) => {
      const item = el('div', 'doc-preview');
      const image = el('img');
      image.src = p.photo;
      image.alt = '';
      const info = el('div', 'doc-preview-info');
      const where = el('span', 'note', `${p.kecamatan ?? t('survey.outside')} · ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} · ${formatDate(p.takenAt)}`);
      const caption = input('text', p.caption ?? '');
      caption.placeholder = t('survey.caption');
      caption.setAttribute('aria-label', `${t('survey.caption')} ${i + 1}`);
      caption.addEventListener('input', () => { p.caption = caption.value; });
      const remove = el('button', null, t('survey.remove'));
      remove.type = 'button';
      remove.addEventListener('click', () => {
        photos.splice(i, 1);
        drawPreviews();
      });
      info.append(where, caption, remove);
      item.append(image, info);
      return item;
    }));
    drawPreviews();

    // The same photo (same place and time) is not added twice, here or in another entry.
    const signature = (p) => `${p.takenAt}|${p.lat.toFixed(6)}|${p.lon.toFixed(6)}`;
    const readStatus = el('p', 'note');
    const picker = input('file');
    picker.accept = 'image/*';
    picker.multiple = true;
    picker.addEventListener('change', async () => {
      const problems = [];
      readStatus.textContent = t('survey.readingPhotos');
      for (const file of picker.files) {
        let meta;
        try {
          meta = await photoMetadata(file);
        } catch {
          problems.push(`${t('survey.photoFailed')}: ${file.name}`);
          continue;
        }
        if (!meta) {
          problems.push(t('survey.noGps').replace('{file}', file.name));
          continue;
        }
        const others = local.filter((e) => isDoc(e) && e.id !== existing?.id).flatMap((e) => e.photos);
        if ([...photos, ...others].some((p) => signature(p) === signature(meta))) {
          problems.push(t('survey.duplicatePhoto').replace('{file}', file.name));
          continue;
        }
        try {
          photos.push({ photo: await photoToDataUrl(file), original: await originalOf(file), caption: '', ...meta, kecamatan: kecamatanAt(meta.lon, meta.lat) });
        } catch {
          problems.push(`${t('survey.photoFailed')}: ${file.name}`);
        }
        drawPreviews();
      }
      picker.value = '';
      readStatus.textContent = problems.join(' ');
    });

    const notes = el('textarea');
    notes.rows = 4;
    notes.value = existing?.notes ?? '';

    const save = el('button', 'survey-save', t('survey.save'));
    save.type = 'button';
    save.addEventListener('click', async () => {
      if (!photos.length) return fail(t('survey.photoRequired'));
      if (!contributor.value.trim()) return fail(t('survey.contributorRequired'));
      const now = new Date().toISOString();
      const entry = {
        kind: 'documentation',
        id: existing?.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        versions: existing ? historyOf(existing) : [],
        contributor: contributor.value.trim(),
        notes: notes.value.trim(),
        photos: photos.map(({ photo, original, caption, lat, lon, takenAt, kecamatan }) => ({ photo, original, caption: (caption ?? '').trim(), lat, lon, takenAt, kecamatan }))
      };
      try {
        await putLocal(entry);
      } catch {
        return fail(t('survey.saveFailed'));
      }
      await refresh();
      showDocEntry(local.find((e) => e.id === entry.id));
    });

    openDialog(existing ? t('survey.docEditTitle') : t('survey.add'), [
      ...(existing ? [] : [tabBar('doc')]),
      field(t('survey.contributor'), contributor, t('survey.contributorHint')),
      el('h3', null, t('survey.photos')),
      field(t('survey.docAddPhotos'), picker, t('survey.docPhotosHint')),
      readStatus,
      previews,
      el('h3', null, t('survey.notes')),
      field(t('survey.notesHint'), notes),
      error, save
    ]);
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
    return { file: link.download, count: entries.length, size: formatSize(blob.size) };
  }

  function exportFile() {
    const { size } = downloadExport();
    setStatus(t('survey.exported').replace('{size}', size));
  }

  // ---------------------------------------------------------------- upload to Google Drive
  //
  // Records go to the project's Google Apps Script (scripts/drive_upload.gs), which saves them in
  // the coordinator's Drive folder. Each original photo is sent on its own and the record without
  // their data, so no single request is large. The upload code is asked once per device and kept
  // in this browser; the script refuses uploads without it.

  const CODE_KEY = 'brin-survey-upload-code';
  const readCode = () => {
    try {
      return localStorage.getItem(CODE_KEY) || '';
    } catch {
      return '';
    }
  };
  const keepCode = (code) => {
    try {
      if (code) localStorage.setItem(CODE_KEY, code);
      else localStorage.removeItem(CODE_KEY);
    } catch {
      // Without storage the code is simply asked again next time.
    }
  };

  // The same file name rule as the Apps Script, so the record can say where its originals are.
  const safeName = (name) => String(name || 'photo').split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'photo';

  function uploadParts(entry) {
    const originals = isDoc(entry) ? entry.photos.map((p) => p.original ?? null) : entry.originals ?? [];
    const files = originals.map((o, i) => (o?.data ? { index: i + 1, name: o.name, data: o.data } : null)).filter(Boolean);
    const pointer = (o, i) => (o ? { name: o.name, type: o.type, file: o.file ?? `originals/${entry.id}/${i + 1}-${safeName(o.name)}` } : null);
    const { uploadedVersion, ...rest } = entry;
    const record = isDoc(entry)
      ? { ...rest, photos: entry.photos.map((p, i) => ({ ...p, original: pointer(p.original, i) })) }
      : { ...rest, originals: originals.map(pointer) };
    return { files, record };
  }

  async function post(body) {
    // text/plain keeps this a simple request, which Apps Script accepts from another site.
    const response = await fetch(dataset.uploadUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (!result.ok) throw Object.assign(new Error(result.error), { reason: result.error });
    return result;
  }

  async function uploadToDrive() {
    if (!dataset.uploadUrl) return setStatus(t('survey.uploadNotReady'));
    const pending = waiting().filter((e) => !isUploaded(e));
    if (!pending.length) return setStatus(t('survey.uploadNothing'));
    const code = readCode() || (prompt(t('survey.uploadCodePrompt')) ?? '').trim();
    if (!code) return undefined;
    const button = document.getElementById('survey-upload');
    button.disabled = true;
    let done = 0;
    try {
      for (const [i, entry] of pending.entries()) {
        setStatus(t('survey.uploading').replace('{i}', i + 1).replace('{n}', pending.length));
        const { files, record } = uploadParts(entry);
        for (const file of files) await post({ code, type: 'original', recordId: entry.id, ...file });
        await post({ code, type: 'record', record });
        await putLocal({ ...entry, uploadedVersion: entry.updatedAt });
        keepCode(code);
        done += 1;
      }
      setStatus(t('survey.uploaded').replace('{n}', done));
    } catch (error) {
      if (error.reason === 'code') {
        keepCode('');
        setStatus(t('survey.uploadCodeWrong'));
      } else {
        setStatus(t('survey.uploadFailed').replace('{n}', done).replace('{reason}', error.message));
      }
    } finally {
      local = await allLocal();
      renderList();
    }
    return undefined;
  }

  const validPhoto = (p) => /^data:image\/(jpeg|png);base64,/.test(p?.photo) && Number.isFinite(p.lat) && Number.isFinite(p.lon)
    && (p.original == null || /^data:/.test(p.original.data) || typeof p.original.file === 'string');
  const validDoc = (e) => Array.isArray(e.photos) && e.photos.length > 0 && e.photos.every(validPhoto);
  const validEntry = (e) => typeof e?.id === 'string' && (isDoc(e) ? validDoc(e) : validSurvey(e));
  const validSurvey = (e) => Number.isFinite(e.lat) && Number.isFinite(e.lon)
    && Array.isArray(e.informants) && Array.isArray(e.photos) && e.photos.every((p) => /^data:image\/(jpeg|png);base64,/.test(p))
    && (e.originals === undefined || (Array.isArray(e.originals) && e.originals.every((o) => o === null || /^data:/.test(o?.data) || typeof o?.file === 'string')));

  // Merges an export from another device. Where both have a record, a version edited from the
  // other replaces it; versions edited separately are merged.
  async function importFile(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== EXPORT_FORMAT || !data.entries.every(validEntry)) throw new Error('format');
      let added = 0;
      let combined = 0;
      for (const entry of data.entries) {
        const current = local.find((e) => e.id === entry.id);
        if (!current || supersedes(entry, current)) {
          if (current?.updatedAt === entry.updatedAt) continue;
          await putLocal(entry);
          added += 1;
        } else if (!supersedes(current, entry)) {
          const [newer, older] = String(entry.updatedAt) > String(current.updatedAt) ? [entry, current] : [current, entry];
          await putLocal(isDoc(entry) ? mergeDocs(newer, older) : mergeEntries(newer, older));
          combined += 1;
        }
      }
      const merged = await refresh() + combined;
      setStatus([t('survey.imported').replace('{n}', added), merged ? mergedText(merged) : ''].join(' ').trim());
    } catch {
      setStatus(t('survey.importFailed'));
    }
  }

  return {
    async init() {
      const load = async (path) => (await fetch(path)).json();
      const [bounds, points, docs] = await Promise.all([load(boundariesFile), load(dataset.file), load(docDataset.file)]);
      boundaries = bounds.features;
      published = points.features.map((f) => ({
        ...f.properties,
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1]
      }));
      // Published documentation has one feature per photo; photo is its position in the entry.
      const groups = new Map();
      for (const feature of docs.features) {
        const p = feature.properties;
        if (!groups.has(p.id)) groups.set(p.id, { kind: 'documentation', id: p.id, contributor: p.contributor, notes: p.notes, updatedAt: p.updatedAt, photos: [] });
        groups.get(p.id).photos[p.photo] = {
          photo: p.url, caption: p.caption, takenAt: p.takenAt, kecamatan: p.kecamatan,
          lon: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1]
        };
      }
      publishedDocs = [...groups.values()].map((e) => ({ ...e, photos: e.photos.filter(Boolean) }));
      // Asks the browser not to clear these entries when storage runs low.
      navigator.storage?.persist?.();

      document.getElementById('survey-add').addEventListener('click', () => showForm());
      document.getElementById('survey-export').addEventListener('click', exportFile);
      document.getElementById('survey-upload').addEventListener('click', uploadToDrive);
      const picker = document.getElementById('survey-import');
      picker.addEventListener('change', async () => {
        if (picker.files[0]) await importFile(picker.files[0]);
        picker.value = '';
      });
      await refresh();
    },
    render: renderList,
    showDetail,
    showDocumentation
  };
}
