# Aceh Tamiang Disaster Dashboard (working title)

Static web dashboard of disaster data for Kabupaten Aceh Tamiang. Prototype; flood is the pilot hazard and Kecamatan Seruway the pilot area. The unit of analysis is the kecamatan.

Plain HTML, CSS and JavaScript with MapLibre GL JS 6.15.0 and Chart.js 4.5.0, both loaded from jsDelivr at pinned versions. No build step.

## Run locally

The page loads its config with `fetch`, so it needs a local web server rather than opening `index.html` directly:

```bash
node scripts/dev-server.mjs 8080
```

Then open http://localhost:8080.

Day-to-day instructions: [docs/HOW_TO_MANAGE.md](docs/HOW_TO_MANAGE.md). Data still needed: [docs/DATA_CHECKLIST.md](docs/DATA_CHECKLIST.md).

## Add data and edit text: the admin page

The admin page runs on your own computer and edits the files in `config/`. It does not publish anything.

```bash
node scripts/admin-server.mjs
```

Then open http://localhost:8081/admin/. The dashboard itself is at http://localhost:8081/.

- **Map datasets**: put a shapefile, GeoPackage, GeoJSON or GeoTIFF in `for claude/`, choose it, say what kind of data it is (polygons with classes, one extent, a count raster or a class raster), describe it, and press Process. The file is copied to `data/raw/`, clipped to the 12 kecamatan, and summarised per kecamatan. Check the numbers, then press "Add to dashboard". Existing datasets can be edited (name, source, date, credit, method, publishing status) or removed.
- **Kecamatan tables**: download `templates/Template_Data_Kecamatan.xlsx`, fill in one row per kecamatan (empty cell = no data), save it in `for claude/`, then check and add it. Each column can appear in the "Data Kecamatan" panel and as a chart.
- **Text**: every label and sentence on the dashboard in Indonesian and English, and the list of limitations.

Every save keeps the previous version in `config/backup/`. The admin page needs the Python environment below.

### Editing text by hand

All dashboard text is in `config/text.json`, as `{ "id": "…", "en": "…" }` pairs. Dataset names, sources and methods are in `config/layers.json`; chart, card and table names in `config/cards.json`. Edit with any text editor, keep the JSON valid (quotes and commas), and reload the page.

## Rebuild the data

The preprocessing scripts need Python 3.14 with the packages in `scripts/requirements.txt`. Set up the environment once:

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r scripts/requirements.txt
```

Put the source files in `data/raw/` (see `docs/DATA_LOG.md`), then run the scripts in this order. Later scripts read the outputs of earlier ones.

```bash
.venv/Scripts/python.exe scripts/build_boundaries.py
.venv/Scripts/python.exe scripts/build_flood.py
.venv/Scripts/python.exe scripts/build_hazards.py
.venv/Scripts/python.exe scripts/build_rasters.py
.venv/Scripts/python.exe scripts/build_reported.py
```

`build_hazards.py` takes about 10 minutes; the others take seconds. Datasets added through the admin page are rebuilt by adding them again there.

## Layout

- `index.html`: page
- `assets/`: CSS and JS
- `config/`: settings, datasets, cards and text (edited by hand or through the admin page)
- `admin/`: the local admin page
- `templates/`: the kecamatan spreadsheet template
- `data/web/`: web-ready outputs; not committed until cleared for publishing (see `.gitignore`)
- `data/raw/`: local source data, not committed
- `for claude/`: the owner's source files, not committed; copied into `data/raw/` before use
- `scripts/`: preprocessing scripts, the admin tool and the local servers
- `docs/DATA_LOG.md`: source, date, licence and processing for each dataset
