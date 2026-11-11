# How to manage the dashboard

A short guide for day-to-day work. Everything here runs on your own computer; nothing goes online until you publish it.

## 1. Open the dashboard and the admin page

Open a terminal in the `5. Dashboard` folder and run:

```bash
node scripts/admin-server.mjs
```

Then open in your browser:

- Dashboard: http://localhost:8081/
- Admin page: http://localhost:8081/admin/

Leave the terminal open while you work. Press `Ctrl+C` in it to stop. After any change, reload the dashboard page to see it.

## 2. Add a map layer (shapefile, GeoPackage, GeoJSON or GeoTIFF)

1. Put the file in the `for claude` folder. For a shapefile, include the `.shp`, `.shx`, `.dbf` and `.prj` files together. The file does not need to be clipped.
2. Admin page → **Map datasets** → choose the file → **Inspect**.
3. Choose what kind of data it is:
   - **Polygons with classes**, such as a hazard index with Rendah/Sedang/Tinggi. Pick the class field, then name each class and choose its colour.
   - **Polygons as one area**, such as a flood extent.
   - **Raster of counts**, such as population per cell.
   - **Raster of classes**, such as land cover. ESRI class names are filled in for you.
4. Fill in the name (ID and EN), source, date and credit line, and choose the group. Hazards go in "Modelled hazard"; only one hazard shows at a time.
5. Press **Process**. Large files can take several minutes.
6. Check the numbers per kecamatan. If they look right, press **Add to dashboard**.

Leave **Cleared for publishing** unticked until the data owner allows it.

## 3. Add numbers per kecamatan (Excel)

1. Admin page → **Kecamatan tables** → download `Template_Data_Kecamatan.xlsx`.
2. Fill in one row per kecamatan. Do not change the `kode_kecamatan` column. **Leave a cell empty when there is no data**; never type 0 for "unknown".
3. Describe each column in the `Kolom` sheet: its name in ID and EN, its unit and the number of decimals. Remove any columns you don't use from both sheets. Fill in the source and date in the `Info` sheet.
4. Save the file in `for claude`, then choose it in the admin page and press **Check**. Fix any problems it lists.
5. Choose which columns appear in the "Data Kecamatan" table and which also become charts. Then press **Process and add to dashboard**.

## 3a. BRIN Survey (field points)

**In the field**

1. Open the dashboard on the tablet. Use the same address each time, because points are saved for that address in that browser.
2. In **Hasil survei BRIN**, press **Tambah titik**. Allow location access when asked; the GPS position fills in by itself. If GPS fails, type the coordinates.
3. Fill in the place name, contributor, photos, narasumber and findings, then press **Simpan**. The point appears on the map at once, on that tablet only. The contributor is the researcher or team, and is required. The name is shown publicly once the point is published.
4. Press **Ekspor** regularly, and always before clearing the browser or changing tablets. **Clearing browser data deletes points that have not been exported.** The form must be opened while online; points you have already saved stay on the tablet.
5. To deliver the points, press the **cloud button** next to Ekspor. It uploads every local point and documentation entry not yet uploaded to the project's Google Drive folder. The first time on each tablet it asks for the upload code. Setup and the code are described in [DRIVE_UPLOAD_SETUP.md](DRIVE_UPLOAD_SETUP.md).

**Original photos.** Each photo is kept twice: a resized copy (longest side 1600 px, location data removed), which is shown and published, and the original file exactly as taken, including the camera's GPS position and other metadata. The originals stay on the tablet and go into the export file, so exports are large: roughly the size of the photos plus a third. The point's details show how much space its originals use. Uploading to Drive sends each original photo on its own, so size is no problem there. When publishing, `build_survey.py` saves the originals unchanged in `data/raw/survey/originals/<point id>/`, which is private and never published. Photos added before this feature existed have no original.

The panel has two parts. **Lokal** (top) holds points on this device that are waiting to be exported and reviewed. **Terbit** (below) holds reviewed points that every visitor can see. Once a point is published, its local copy leaves the Lokal list by itself, unless it was edited after publishing. The copy stays on the device, because only it holds the narasumber names.

**Duplicates.** Records with exactly the same survey time (to the minute) and the same contributor are merged, both on the device and when publishing. Findings, photos and narasumber from both are kept. If the two locations differ, the newer one is used and the other is written into the findings as "Lokasi lain yang digabung". Because of this rule, each person should enter their own name as contributor, not a shared team name. When the same point is edited on two tablets, both edits are kept and merged; see [DRIVE_UPLOAD_SETUP.md](DRIVE_UPLOAD_SETUP.md).

Each narasumber has a name, a role (such as Kepala Desa or Warga) and a consent box. Do not write names in the findings, because findings are published as written.

**The export file contains narasumber names. Keep it private and never upload it anywhere public.**

To combine tablets, press **Impor** on one tablet and choose another tablet's export file.

**Dokumentasi (photo documentation)**

A simpler record than a survey point: photos, a caption for each, and general notes and findings.

1. Press **Tambah titik**, then the **Dokumentasi** tab.
2. Fill in the contributor and choose one or more photos. Each photo is placed on the map at the GPS position stored inside the photo, with the time the photo was taken. **A photo without a GPS position is refused**, so turn on location in the camera app before taking photos. The same photo is not added twice.
3. Write a caption under each photo if useful, and the general notes, then press **Simpan**.

Documentation appears in the Lokal and Terbit lists and on the **Dokumentasi** map layer, one camera icon per photo. It goes into the same export file and is published by the same `build_survey.py` run. Photos whose position is outside the 12 kecamatan are left out when publishing. Check that tablets keep the location in photos: some phones and browsers remove it when a photo is chosen from the gallery. If every photo is refused, take a test photo with location turned on and try again.

**Reading a point**

Press a point on the map or in the list to see its details and its **Laporan lokasi**. The report reads each map layer at the point's coordinates: observed flood (detected or not detected), land cover, the WorldPop estimate and each InaRISK hazard class. A polygon or image layer added to the dashboard appears in the report by itself. **Ke titik** in the list moves the map to that point. **Cetak laporan** prints one point, or saves it as PDF through the browser's print window, with all its photos and its location report. A printed report shows narasumber roles only, for those who agreed, never names.

**Publishing reviewed points**

Only records you approve are published.

1. Admin page → **Survey review** → enter the admin code → **Get uploads from Drive**. Export files from tablets can also go in `for claude/survey/` (git ignores this folder).
2. Review each record under **To review**: edit the published text if needed, leave out photos or roles, then **Approve** or **Reject**. Check the warnings, such as a narasumber's name in the text.
3. Press **Publish approved records** and read the log.
4. Go to **Publish to GitHub** and press **Commit and push** (see section 7).

A record that changes after you approved it needs review again. The full routine and the one-time admin-code setup are in [DRIVE_UPLOAD_SETUP.md](DRIVE_UPLOAD_SETUP.md).

The public version shows a narasumber's role only, and only if the consent box was ticked. Names are never published. Points outside the 12 kecamatan are left out and listed.

## 4. Change text

- Admin page → **Text**: every label on the dashboard in Indonesian and English, and the limitations list shown in "Tentang data" (About the data). Press **Save text**.
- Dataset names, sources, dates, credit lines and publishing status: admin page → **Map datasets** → **Edit**.
- By hand, if you prefer: `config/text.json` holds the labels, `config/layers.json` the datasets, and `config/cards.json` the cards, charts, table and infrastructure rows. Keep the quotes and commas valid.

## 5. Remove or undo

- **Remove** in the dataset list takes a dataset off the dashboard. Its files stay in `data/web/`.
- Every save keeps the previous version in `config/backup/`, named with the date and time. To undo a save, copy the older file back over the one in `config/`.

## 6. Update the BPBD figures

The impact cards, the "Data Kecamatan" table and the infrastructure "Damaged" column come from https://cekdatabencana.acehtamiangkab.go.id/ as published on 19 March 2026. When the site changes, ask Claude to take a new snapshot. It reads the totals again, checks that the kecamatan add up to the kabupaten totals, and updates the date shown. The steps are in `docs/DATA_LOG.md`.

## 7. Publishing

The live dashboard is https://ttrinug.github.io/aceh-tamiang-dashboard/. It shows what is on GitHub.

1. Admin page → **Publish to GitHub**. It lists the changed files in `config/` and `data/web/`, and any commits waiting to be pushed.
2. Check the list, write a short message (for example "Publish reviewed survey points"), and press **Commit and push**. The first time, a GitHub sign-in window may open.
3. The live site updates a few minutes later. A browser that opened it recently may need Ctrl+Shift+R.

Safeguards:
- Only `config/` and `data/web/` are committed from the admin page. Raw data (`data/raw/`), the `for claude` folder and survey review decisions are never included.
- Files over 50 MB are refused.
- If GitHub has newer changes than this computer, for example pushed by Claude, the push is refused and nothing is overwritten. Ask Claude to bring them in, then press again.
- Everything in `data/web/` is public once pushed (decided on 4 November 2026; see `docs/DATA_LOG.md`). The **Cleared for publishing** box in Map datasets only sets the label shown in the dashboard; it does not keep a file offline.

## 8. Rules the dashboard follows

- Missing data shows as "—" or "Belum ada data", never as 0.
- Observed data (Sentinel-1 flood, BPBD reports) and modelled data (InaRISK, WorldPop) are kept apart.
- WorldPop people in the flood extent are an estimate, never "affected people".
- Every percentage states what it was divided by.
- Only aggregate figures are shown. No names or details of individual victims.

## 9. If something goes wrong

- **The admin page says it could not start:** the admin server is not running. Run the command in section 1.
- **"No Python found":** set up the Python environment once (see `README.md`, "Rebuild the data").
- **The dashboard page is blank:** a config file probably has a typing error. Restore the latest copy from `config/backup/`, or ask Claude.
- **Processing fails:** the admin page shows the error message and the log. A common cause is a shapefile missing its `.prj` file.
