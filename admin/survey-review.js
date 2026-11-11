// Survey review tab: gets the uploads from Google Drive (through the admin server), shows every
// record with its review state, lets the reviewer edit the published text, leave out photos and
// roles, approve or reject, and publishes the approved records. All work runs in
// scripts/survey_review.py; this page only shows and sends decisions.

const STATES = {
  pending: 'Needs review',
  changed: 'Changed since review',
  approved: 'Approved',
  rejected: 'Rejected'
};
const FILTERS = [
  ['review', 'To review', (s) => s === 'pending' || s === 'changed'],
  ['approved', 'Approved', (s) => s === 'approved'],
  ['rejected', 'Rejected', (s) => s === 'rejected'],
  ['all', 'All', () => true]
];
const CODE_KEY = 'brin-survey-admin-code';

export function setupSurveyTab({ api, el, showMessage, waitForJob }) {
  let items = [];
  let filter = 'review';
  let loaded = false;

  const isDoc = (record) => record.kind === 'documentation';
  const firstPhoto = (record) => (isDoc(record) ? record.photos[0] : record);
  const dateOf = (record) => (isDoc(record) ? record.photos[0]?.takenAt : record.surveyedAt) ?? '';
  const titleOf = (record) => (isDoc(record) ? `Documentation, ${record.photos.length} photo(s)` : record.place || '(no place name)');

  // Things a reviewer should look at before approving. The name check reads the text as it
  // would be published, with the reviewer's edits.
  function warnings(record, review) {
    const edits = review?.edits ?? {};
    const hidden = new Set(review?.hiddenPhotos ?? []);
    const published = (key) => edits[key] ?? record[key] ?? '';
    const captions = isDoc(record) ? record.photos.filter((p) => !hidden.has(p.key)).map((p) => edits.captions?.[p.key] ?? p.caption ?? '').join(' ') : '';
    const list = [];
    if (record._separateEdits) list.push(`Edited separately on ${record._separateEdits} devices; the versions were merged. Check the text.`);
    if (record._duplicates) list.push(`${record._duplicates} records with the same time and contributor were merged.`);
    const places = isDoc(record) ? record.photos.map((p) => p.kecamatan) : [record.kecamatan];
    if (places.every((k) => !k)) list.push('Outside Aceh Tamiang: it will not be published.');
    else if (places.some((k) => !k)) list.push('Some photos are outside Aceh Tamiang and will be left out.');
    const text = `${published('place')} ${published('findings')} ${published('notes')} ${captions}`.toLowerCase();
    const names = (record.informants ?? []).map((p) => (p.name ?? '').trim()).filter((n) => n.length >= 3);
    const found = names.filter((n) => text.includes(n.toLowerCase()));
    if (found.length) list.push(`An informant's name appears in the text that would be published: ${found.join(', ')}. Edit it out.`);
    return list;
  }

  // ------------------------------------------------------------ list

  function renderFilters() {
    const group = document.getElementById('survey-filters');
    group.replaceChildren(...FILTERS.map(([id, label, test]) => {
      const count = items.filter((item) => test(item.state)).length;
      const button = el('button', { type: 'button', text: `${label} (${count})`, 'aria-pressed': String(id === filter) });
      button.addEventListener('click', () => {
        filter = id;
        render();
      });
      return button;
    }));
  }

  function render() {
    renderFilters();
    const test = FILTERS.find(([id]) => id === filter)[2];
    const shown = items.filter((item) => test(item.state)).sort((a, b) => String(dateOf(b.record)).localeCompare(String(dateOf(a.record))));
    const body = document.getElementById('survey-records');
    if (!shown.length) {
      body.replaceChildren(el('tr', {}, el('td', { colSpan: 6, class: 'muted', text: loaded ? 'Nothing here.' : 'Loading…' })));
      return;
    }
    body.replaceChildren(...shown.map((item) => {
      const { record } = item;
      const flags = warnings(record, item.review);
      const open = el('button', { type: 'button', text: 'Review' });
      open.addEventListener('click', () => openReview(item));
      return el('tr', {}, [
        el('td', {}, [el('strong', { text: titleOf(record) }), flags.length ? el('div', { class: 'flag', text: `⚠ ${flags.length} to check` }) : null]),
        el('td', { text: record.contributor || '—' }),
        el('td', { text: String(dateOf(record)).replace('T', ' ') || '—' }),
        el('td', { text: firstPhoto(record)?.kecamatan || 'Outside' }),
        el('td', {}, el('span', { class: `state ${item.state}`, text: STATES[item.state] })),
        el('td', {}, open)
      ]);
    }));
  }

  async function reload() {
    const data = await api('GET', '/api/survey');
    items = data.records;
    loaded = true;
    render();
  }

  // ------------------------------------------------------------ review dialog

  function openReview(item) {
    const { record, review } = item;
    const doc = isDoc(record);
    const edits = review?.edits ?? {};
    const hiddenPhotos = new Set(review?.hiddenPhotos ?? []);
    const hiddenInformants = new Set(review?.hiddenInformants ?? []);
    const form = document.getElementById('survey-review-form');
    const dialog = document.getElementById('survey-dialog');

    const textField = (key, label, multiline) => {
      const value = edits[key] ?? record[key] ?? '';
      const input = multiline ? el('textarea', { rows: 6, text: value }) : el('input', { type: 'text', value });
      input.value = value;
      input.dataset.key = key;
      input.dataset.original = record[key] ?? '';
      return el('label', { class: 'review-field' }, [el('span', { text: label }), input]);
    };

    const location = doc ? '' : `${record.lat.toFixed(5)}, ${record.lon.toFixed(5)} · ${record.kecamatan || 'outside Aceh Tamiang'}`;
    const flags = warnings(record, review);

    const photos = el('div', { class: 'review-photos' }, record.photos.map((p, i) => {
      const keep = el('input', { type: 'checkbox', checked: !hiddenPhotos.has(p.key) });
      keep.dataset.photo = p.key;
      const parts = [
        el('img', { src: p.photo, alt: `Photo ${i + 1}` }),
        el('label', { class: 'check' }, [keep, ' Publish this photo'])
      ];
      if (doc) {
        const caption = el('input', { type: 'text', value: edits.captions?.[p.key] ?? p.caption ?? '', placeholder: 'Caption' });
        caption.dataset.caption = p.key;
        caption.dataset.original = p.caption ?? '';
        parts.push(caption, el('p', { class: 'hint muted', text: `${p.takenAt?.replace('T', ' ') ?? 'no time'} · ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} · ${p.kecamatan || 'outside Aceh Tamiang'}` }));
      }
      return el('figure', {}, parts);
    }));

    const informants = doc ? null : el('table', { class: 'list' }, [
      el('thead', {}, el('tr', {}, ['Name (never published)', 'Role', 'Agreed', 'Show role'].map((h) => el('th', { text: h })))),
      el('tbody', {}, record.informants.length ? record.informants.map((p) => {
        const allowed = Boolean(p.consent && p.role);
        const show = el('input', { type: 'checkbox', checked: allowed && !hiddenInformants.has(p.key), disabled: !allowed });
        show.dataset.informant = p.key;
        return el('tr', {}, [el('td', { text: p.name || '—' }), el('td', { text: p.role || '—' }), el('td', { text: p.consent ? 'Yes' : 'No' }), el('td', {}, show)]);
      }) : el('tr', {}, el('td', { colSpan: 4, class: 'muted', text: 'No informants.' })))
    ]);

    const note = el('textarea', { rows: 2, text: review?.note ?? '' });
    note.value = review?.note ?? '';
    const buttons = [['approved', 'Approve', 'primary'], ['rejected', 'Reject', ''], ['pending', 'Mark as not reviewed', '']].map(([status, label, cls]) => {
      const button = el('button', { type: 'button', text: label, class: cls });
      button.addEventListener('click', () => save(status));
      return button;
    });
    const cancel = el('button', { value: 'cancel', text: 'Close' });

    form.replaceChildren(
      el('h2', { text: `${doc ? 'Documentation' : 'Survey point'}: ${titleOf(record)}` }),
      el('p', { class: 'muted', text: [`Status: ${STATES[item.state]}`, `contributor ${record.contributor || '—'}`, location, `id ${record.id}`].filter(Boolean).join(' · ') }),
      flags.length ? el('ul', { class: 'flags' }, flags.map((f) => el('li', { text: f }))) : null,
      el('h3', { text: 'Published text' }),
      el('p', { class: 'hint muted', text: 'Edits change only what is published; the upload is kept as it was. The location cannot be edited.' }),
      ...(doc
        ? [textField('notes', 'Notes and findings', true), textField('contributor', 'Contributor')]
        : [textField('place', 'Place name'), textField('findings', 'Findings', true), textField('contributor', 'Contributor')]),
      el('h3', { text: `Photos (${record.photos.length})` }),
      record.photos.length ? photos : el('p', { class: 'muted', text: 'No photos.' }),
      doc ? null : el('h3', { text: 'Informants' }),
      informants,
      el('label', { class: 'review-field' }, [el('span', { text: 'Review note (private)' }), note]),
      el('p', { class: 'row' }, [...buttons, cancel])
    );

    async function save(status) {
      const textEdits = {};
      for (const input of form.querySelectorAll('[data-key]')) {
        if (input.value.trim() !== input.dataset.original.trim()) textEdits[input.dataset.key] = input.value.trim();
      }
      const captions = {};
      for (const input of form.querySelectorAll('[data-caption]')) {
        if (input.value.trim() !== input.dataset.original.trim()) captions[input.dataset.caption] = input.value.trim();
      }
      if (Object.keys(captions).length) textEdits.captions = captions;
      const reviewData = {
        status,
        edits: textEdits,
        hiddenPhotos: [...form.querySelectorAll('[data-photo]')].filter((c) => !c.checked).map((c) => c.dataset.photo),
        hiddenInformants: [...form.querySelectorAll('[data-informant]')].filter((c) => !c.checked && !c.disabled).map((c) => c.dataset.informant),
        note: note.value.trim()
      };
      if (status === 'approved' && reviewData.hiddenPhotos.length === record.photos.length && doc) {
        showMessage('A documentation entry needs at least one published photo.', true);
        return;
      }
      await api('PUT', '/api/survey/review', { id: record.id, contentKey: item.contentKey, review: reviewData });
      dialog.close();
      showMessage(`${titleOf(record)}: ${STATES[status]}.`);
      await reload();
    }

    dialog.showModal();
  }

  // ------------------------------------------------------------ Drive and publishing

  const codeInput = document.getElementById('survey-admin-code');
  const remember = document.getElementById('survey-remember');
  try {
    codeInput.value = localStorage.getItem(CODE_KEY) || '';
    remember.checked = Boolean(codeInput.value);
  } catch {
    // Storage blocked: the code is simply typed each time.
  }

  const sync = document.getElementById('survey-sync');
  sync.addEventListener('click', async () => {
    const adminCode = codeInput.value.trim();
    if (!adminCode) return showMessage('Enter the admin code first.', true);
    sync.disabled = true;
    showMessage('Getting the uploads from Google Drive…');
    try {
      const result = await api('POST', '/api/survey/sync', { adminCode });
      try {
        if (remember.checked) localStorage.setItem(CODE_KEY, adminCode);
        else localStorage.removeItem(CODE_KEY);
      } catch {
        // Not remembered; nothing else depends on it.
      }
      showMessage(`Drive: ${result.total} files; ${result.fetched} new or changed copied, ${result.unchanged} already here${result.ignored ? `, ${result.ignored} other files ignored` : ''}.`);
      await reload();
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      sync.disabled = false;
    }
    return undefined;
  });

  const publish = document.getElementById('survey-publish');
  publish.addEventListener('click', async () => {
    publish.disabled = true;
    try {
      const { job } = await api('POST', '/api/survey/publish');
      const result = await waitForJob(job, document.getElementById('survey-log'));
      showMessage(`Published ${result.points} survey points and ${result.photos} documentation photos to data/web/. Read the log, then commit and push.`);
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      publish.disabled = false;
    }
  });

  // The list is read when the tab is first opened: it can be large.
  document.querySelector('[data-tab="survey"]').addEventListener('click', () => {
    if (!loaded) reload().catch((error) => showMessage(error.message, true));
  });
  render();
}
