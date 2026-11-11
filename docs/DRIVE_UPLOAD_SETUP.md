# Setting up "Unggah ke Drive"

The upload button in the BRIN Survey panel sends local survey points and documentation to a folder in your Google Drive. It works through a small Google Apps Script that runs in your own Google account. Contributors need no Google account and never see your Drive.

This takes about 10 minutes and is done once.

## 1. Make the Drive folder

1. In Google Drive, choose **New → New folder** and name it, for example, `BRIN Survey uploads`.
2. Open the folder. Its address looks like `https://drive.google.com/drive/folders/1AbC...xyz`.
3. Copy the part after `/folders/`. This is the **folder ID**.

## 2. Make the script

1. Go to https://script.google.com and choose **New project**.
2. Click **Untitled project** at the top and rename it `BRIN Survey upload`.
3. In `Code.gs`, delete everything and paste the whole content of [`scripts/drive_upload.gs`](../scripts/drive_upload.gs). Press **Ctrl+S** to save.

## 3. Add the two settings

1. In the left sidebar, open **Project Settings** (the gear icon).
2. Scroll down to **Script Properties** and choose **Add script property** twice:
   - `FOLDER_ID`: the folder ID from step 1.
   - `UPLOAD_CODE`: a code you choose for the field team, at least 8 characters. Do not reuse a password.
3. Choose **Save script properties**.

The code lives only in these settings, never in the public repository.

## 4. Publish the script as a web app

1. Top right: **Deploy → New deployment**.
2. Next to **Select type**, click the gear and choose **Web app**.
3. Set:
   - **Description:** `v1`
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
4. Choose **Deploy**, then **Authorize access** and pick your Google account.
5. Google shows "Google hasn't verified this app". This is normal for your own script: choose **Advanced → Go to BRIN Survey upload (unsafe) → Allow**. The script can only use Drive in the ways written in `drive_upload.gs`.
6. Copy the **Web app URL**. It ends in `/exec`.

**Check:** open that URL in a browser. It should show `{"ok":true,"service":"brin-survey-upload"}`.

## 5. Connect the dashboard

1. Send the Web app URL to Claude, or put it in `config/layers.json` as the `uploadUrl` of the `brin-survey` dataset. The URL is not secret. Without the code it can't be used. (Done: the dashboard uses the URL set up on 11 November 2026.)
2. Give the upload code to the field team privately, for example in person or in a private chat. **Do not post it in the repository or a public group.**

## Using it

- In the BRIN Survey panel, the cloud button uploads every local point and documentation entry not yet uploaded. The first time on each tablet, it asks for the upload code, and the tablet then remembers it.
- Each record becomes one JSON file in the folder. Original photos go into `originals/<record id>/`. A record that has not changed since its last upload is not sent again; an edited record is sent again as a new file.
- A point's details show **Diunggah ke Drive: Ya/Belum**.
- With no signal, use **Ekspor** as before and upload later.

## Publishing what was uploaded

1. In Drive, right-click the folder and choose **Download**. Drive makes a zip file.
2. Unzip it into `for claude/survey/`. Subfolders are fine.
3. Run `.venv/Scripts/python.exe scripts/build_survey.py`, or ask Claude to.

**How several uploads of the same record are handled**

- **The folder is never overwritten.** The script only adds files and never replaces or deletes one, so one tablet's upload cannot wipe out another's.
- **Every record keeps its edit history.** Each version lists the versions it was edited from.
- **When publishing:**
  - an older version is dropped only if a later version was edited from it, which is a real edit;
  - two versions edited separately, for example the same point changed on two tablets, are **merged**: both texts, all photos, and for narasumber, consent only if both versions say so;
  - the build prints `CHECK` for every merge, so read those before pushing.
- **Redundant copies are removed:**
  - an unchanged record is not uploaded twice;
  - the same version found in several files counts once;
  - survey points with the same time and contributor are merged;
  - a documentation photo already published in another entry is not published twice.
- **Deleting a point on a tablet does not remove what was already uploaded.** If a point should not be published, leave its file out of `for claude/survey/` or tell Claude.

The folder holds narasumber names and original photos with their locations. Keep it private: do not share it with "Anyone with the link".

## Changing the code or the script later

- **New upload code:** change `UPLOAD_CODE` in Project Settings. Tablets with the old code will be asked for the new one at their next upload.
- **New script version:** after pasting new code, choose **Deploy → Manage deployments**, click the pencil, set **Version** to **New version**, then **Deploy**. The URL stays the same.
