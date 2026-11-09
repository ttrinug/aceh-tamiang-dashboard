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
5. To deliver the points, press the **mail icon** next to Ekspor. It downloads the export file and opens an email addressed to the project inbox. **Attach the downloaded file yourself, then send it**, because a web page cannot attach a file. The address is the `sendTo` value of the `brin-survey` dataset in `config/layers.json`.

The panel has two parts. **Lokal** (top) holds points on this device that are waiting to be exported and reviewed. **Terbit** (below) holds reviewed points that every visitor can see. Once a point is published, its local copy leaves the Lokal list by itself, unless it was edited after publishing. The copy stays on the device, because only it holds the narasumber names.

**Duplicates.** Records with exactly the same survey time (to the minute) and the same contributor are merged, both on the device and when publishing. Findings, photos and narasumber from both are kept. If the two locations differ, the newer one is used and the other is written into the findings as "Lokasi lain yang digabung". Because of this rule, each person should enter their own name as contributor, not a shared team name.

Each narasumber has a name, a role (such as Kepala Desa or Warga) and a consent box. Do not write names in the findings, because findings are published as written.

**The export file contains narasumber names. Keep it private and never upload it anywhere public.**

To combine tablets, press **Impor** on one tablet and choose another tablet's export file.

**Reading a point**

Press a point on the map or in the list to see its details and its **Laporan lokasi**. The report reads each map layer at the point's coordinates: observed flood (detected or not detected), land cover, the WorldPop estimate and each InaRISK hazard class. A polygon or image layer added to the dashboard appears in the report by itself. **Ke titik** in the list moves the map to that point. **Cetak laporan** prints one point, or saves it as PDF through the browser's print window, with all its photos and its location report. A printed report shows narasumber roles only, for those who agreed, never names.

**Publishing reviewed points**

1. Put the export files in `for claude/survey/` (git ignores this folder).
2. Run `.venv/Scripts/python.exe scripts/build_survey.py`, or ask Claude to.
3. Read what it prints. Check the findings for names, and the photos in `data/web/brin_survey/` for faces of people who did not agree.
4. Commit and push `data/web/brin_survey.geojson` and `data/web/brin_survey/`.

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

- A dataset goes public only when its **Cleared for publishing** box is ticked **and** its file is allowed in `.gitignore`, with a line such as `!data/web/<file>`.
- So far only the BPBD figures are cleared.
- The site goes online only after a GitHub repository name is chosen and GitHub Pages is switched on, both with your approval.

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
