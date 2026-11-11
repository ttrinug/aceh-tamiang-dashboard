/**
 * BRIN Survey upload receiver (Google Apps Script web app).
 *
 * The dashboard's "Unggah ke Drive" button posts here. Each survey point or documentation entry
 * is saved as one JSON file in a Drive folder, and each original photo as an image file under
 * originals/<record id>/. The script runs as the folder's owner, so contributors need no Google
 * account. Setup is described in docs/DRIVE_UPLOAD_SETUP.md.
 *
 * Settings are Script Properties (Project Settings > Script Properties), not code, so nothing
 * private is in this file:
 *   FOLDER_ID    the id of the Drive folder that receives uploads
 *   UPLOAD_CODE  the code every tablet must send; uploads without it are refused
 *   ADMIN_CODE   the code the local admin page sends to list and download the uploads. It must
 *                differ from UPLOAD_CODE: the uploads hold informant names. Without it, these
 *                two actions are switched off.
 *
 * Requests are JSON sent as text/plain (which avoids a browser preflight request):
 *   { code, type: "original", recordId, index, name, data }   one original photo, data URL
 *   { code, type: "record", record }                          one point or documentation entry
 *   { adminCode, action: "list" }                             every uploaded file: id, path, size
 *   { adminCode, action: "get", fileId }                      one uploaded file, base64
 * A file that already exists under the same name is not written again. Nothing is ever deleted
 * or overwritten.
 */

const RECORD_ID = /^[A-Za-z0-9-]{1,64}$/;

function doGet() {
  return reply({ ok: true, service: 'brin-survey-upload' });
}

function doPost(e) {
  const settings = PropertiesService.getScriptProperties();
  const code = settings.getProperty('UPLOAD_CODE');
  const folderId = settings.getProperty('FOLDER_ID');
  if (!code || !folderId) return reply({ ok: false, error: 'not-configured' });

  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'bad-request' });
  }
  if (body && body.action) {
    const adminCode = settings.getProperty('ADMIN_CODE');
    if (!adminCode || adminCode === code) return reply({ ok: false, error: 'admin-not-configured' });
    if (body.adminCode !== adminCode) return reply({ ok: false, error: 'code' });
    const root = DriveApp.getFolderById(folderId);
    if (body.action === 'list') return reply({ ok: true, files: listFiles(root) });
    if (body.action === 'get') return getFile(root, String(body.fileId || ''));
    return reply({ ok: false, error: 'bad-request' });
  }
  if (!body || body.code !== code) return reply({ ok: false, error: 'code' });

  const folder = DriveApp.getFolderById(folderId);
  if (body.type === 'original') return saveOriginal(folder, body);
  if (body.type === 'record') return saveRecord(folder, body.record);
  return reply({ ok: false, error: 'bad-request' });
}

function saveOriginal(folder, body) {
  const match = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/.exec(String(body.data || ''));
  if (!RECORD_ID.test(String(body.recordId)) || !Number.isInteger(body.index) || body.index < 1 || !match) {
    return reply({ ok: false, error: 'bad-request' });
  }
  const target = childFolder(childFolder(folder, 'originals'), body.recordId);
  const name = body.index + '-' + safeName(body.name);
  if (target.getFilesByName(name).hasNext()) return reply({ ok: true, name: name, existed: true });
  target.createFile(Utilities.newBlob(Utilities.base64Decode(match[2]), match[1], name));
  return reply({ ok: true, name: name });
}

function saveRecord(folder, record) {
  if (!record || !RECORD_ID.test(String(record.id)) || !Array.isArray(record.photos)) {
    return reply({ ok: false, error: 'bad-request' });
  }
  // One file per version of a record; an unchanged record sent again is skipped.
  const version = String(record.updatedAt || '').replace(/[^0-9A-Za-z]/g, '');
  const name = 'brin_survey_' + record.id + '_' + version + '.json';
  if (folder.getFilesByName(name).hasNext()) return reply({ ok: true, name: name, existed: true });
  const file = { format: 'brin-survey-export', version: 1, exportedAt: new Date().toISOString(), entries: [record] };
  folder.createFile(name, JSON.stringify(file), 'application/json');
  return reply({ ok: true, name: name });
}

// The records in the folder, and the original photos under originals/<record id>/.
function listFiles(root) {
  const files = [];
  const add = (iterator, prefix) => {
    while (iterator.hasNext()) {
      const file = iterator.next();
      files.push({ id: file.getId(), path: prefix + file.getName(), size: file.getSize() });
    }
  };
  add(root.getFiles(), '');
  const originals = root.getFoldersByName('originals');
  if (originals.hasNext()) {
    const records = originals.next().getFolders();
    while (records.hasNext()) {
      const record = records.next();
      add(record.getFiles(), 'originals/' + record.getName() + '/');
    }
  }
  return files;
}

// Only files inside the upload folder can be read this way.
function getFile(root, fileId) {
  const match = listFiles(root).find(function (f) { return f.id === fileId; });
  if (!match) return reply({ ok: false, error: 'not-found' });
  const bytes = DriveApp.getFileById(fileId).getBlob().getBytes();
  return reply({ ok: true, path: match.path, data: Utilities.base64Encode(bytes) });
}

function childFolder(parent, name) {
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

// File names come from the tablet; keep only safe characters.
function safeName(name) {
  const cleaned = String(name || 'photo').split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned.slice(-80) || 'photo';
}

function reply(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
