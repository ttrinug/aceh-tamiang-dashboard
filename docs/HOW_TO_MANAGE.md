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
