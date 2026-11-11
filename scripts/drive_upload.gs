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
 *
 * Requests are JSON sent as text/plain (which avoids a browser preflight request):
 *   { code, type: "original", recordId, index, name, data }   one original photo, data URL
 *   { code, type: "record", record }                          one point or documentation entry
 * A file that already exists under the same name is not written again.
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
