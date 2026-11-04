# Aceh Tamiang Disaster Dashboard: Build Brief

Working title. Owner: Trinug (BRIN). GitHub account: `ttrinug`.

## How to work through this brief

- Build one stage at a time, in order.
- **Stop at the end of each stage**, and at the end of each data layer in Stage 3. Show the result and wait for approval.
- Never invent data. If a value is missing, show "No data yet" / "Belum ada data".
- If something is uncertain, say so and ask. Do not guess.
- Do not modify the owner's original data files. Work on copies.

## Goal

A web-based disaster data dashboard for Kabupaten Aceh Tamiang, Indonesia.

- **Structure:** all 12 kecamatan
- **Pilot with full detail:** Kecamatan Seruway (reported 24 gampong; confirm against the boundary data)
- **Pilot hazard:** flood. Keep the design open to more hazards later.
- **Status:** simple prototype. Keep it small and easy to understand.

Adding a new layer or kecamatan should mostly mean adding data and configuration, not redesigning the app.

## Technical approach

- Plain HTML, CSS and JavaScript. No framework or build step unless a clear need comes up; ask first.
- MapLibre GL JS. Pin an exact, current stable version. Never use `latest`.
- Must run as a static site on GitHub Pages: no server and no database.
- Preprocess data with scripts, then commit only the small web-ready outputs.
- Define layers in one configuration file (for example, `config/layers.json`) so the UI is generated from it.

- Use one lightweight charting library, such as Chart.js or Apache ECharts. Pin an exact version.

### Basemaps

Provide two options that the user can switch between. Keep their URLs and attribution in configuration.

**Street (default): OpenStreetMap data through OpenFreeMap**

- Use a light style such as Positron.
- OpenFreeMap states that its public instance is free, needs no API key and has no view limits.
- Attribution is required. Keep the MapLibre attribution control visible.
- It offers no SLA, so the basemap must be easy to replace.
- Confirm the style URL in its Quick Start Guide. It is expected to be `https://tiles.openfreemap.org/styles/positron`, but this has not been tested.

**Imagery: EOxCloudless (provisional)**

- It is available as a WMTS service, and its licence page does not mention needing a key. Confirm this and the Web Mercator endpoint in the EOX documentation.
- Use a pre-flood year, such as 2024, and show the year in the UI. Do not present it as imagery of the flood.
- Its 2018–2025 layers are CC BY-NC-SA 4.0, so they are limited to non-commercial use. **Ask the owner to confirm that this suits the project before publishing.** EOX does not define "non-commercial" on its licence page or address government research use.
- Show the exact year-specific attribution near the map, with links to EOxCloudless and EOX IT Services GmbH.
- At about 10 m resolution (confirm), it will not show individual buildings.

**Possible later upgrade: Esri World Imagery**

Do not use it unless the owner approves. It has more detail, but its terms and any key requirement must be confirmed from Esri's own documentation first. A key would also be visible on a static site.

### Suggested repository structure

```text
index.html
assets/            CSS, JS
config/            layers.json, app settings
data/web/          small web-ready outputs, safe to publish
data/raw/          local source data, listed in .gitignore
scripts/           reproducible preprocessing scripts
docs/DATA_LOG.md   source, date, licence and processing for each dataset
README.md
```

Before committing, check that no file exceeds GitHub's size limits and that nothing from `data/raw/` is staged.

### Repository rules

- Do not use `ttrinug/erg-topic-forum`. It is unrelated.
- Stages 1 and 2 can be built and previewed locally without a repository.
- Ask the owner for the repository name before the first push.
- Do not make anything public or enable GitHub Pages without the owner's approval. Unpublished datasets have permission checks pending.

## Stage 1: Basemap

- Full-screen map centred on Aceh Tamiang
- Street and Imagery basemap switch
- Zoom controls, scale bar and visible attribution
- Approximate starting view: 4.3°N, 98.1°E. This is an estimate; correct it when boundaries are added.

**Done when:** both basemaps load with no console errors, work at desktop and phone widths, and show the correct attribution.

**Stop for review.**

## Stage 2: Empty layout

Use `design-reference.png` as the visual reference: a card-based, single-screen operations dashboard with a white header, thin-bordered panels, charts on the left, map in the centre and a scrolling list on the right. Follow its structure and style only. Do not copy its branding, crime content or time-based charts.

```text
┌────────────────────────────────────────────────────────────────┐
│ Title                     Kecamatan: Seruway ▾     ID/EN    ☰  │
├────────────────────────┬──────────────┬──────────────┬─────────┤
│ Affected people        │ Population   │ Affected     │ Gampong │
│ by gampong             │ (BPS)        │ people       │ list    │
│ (sorted bars)          │     —        │     —        │         │
│                        ├──────────────┴──────────────┤ Name    │
├───────────┬────────────┤                             │ Pop.    │
│ Affected  │ Flooded    │    MAP                      │ Affected│
│ land by   │ area by    │    (basemap + layer         │ Flooded │
│ land use  │ gampong    │     controls on the map)    │ area    │
│           │            ├─────────┬─────────┬─────────┤         │
│           │            │ % people│ % area  │ %gampong│ scrolls │
│           │            │ affected│ flooded │ affected│         │
└───────────┴────────────┴─────────┴─────────┴─────────┴─────────┘
```

| Reference panel | This dashboard |
|---|---|
| Crime Count | Affected people by gampong, sorted |
| Crimes by Hour | Flooded area by gampong. Add a timeline only if multi-date data exists. |
| Crimes by Type | Affected land by land-use class |
| Total Crimes and No homicides | Population (BPS), plus a row of impact cards: deaths, missing, injured, displaced, affected |
| Active, Cleared and Dormant Calls | % people affected, % area flooded, % gampong affected |
| Crime Feed | Gampong list |
| Time and division filters | Kecamatan dropdown, because 12 buttons will not fit |

Behaviour:

- Each number card shows its source and date. Do not include the reference's up/down change indicator unless real comparison data exists.
- Selecting a gampong in the list, map or chart highlights it in all three and updates the cards.
- Put basemap and layer controls in a compact control on the map. Layers without data are disabled and marked "No data yet".
- Add an "About the data" panel, reached through the ☰ menu, with sources, dates and limitations.
- Header: kecamatan dropdown and an Indonesian/English switch. Default to Indonesian.
- Empty panels show "No data yet" / "Belum ada data", with no sample numbers or dummy charts.
- Phone width: use one column in this order: number cards, map, percentages, charts, gampong list. No horizontal scrolling.
- Keyboard-accessible controls and readable contrast. Do not rely on colour alone.
- Keep kecamatan names in a data file. Do not hard-code them in the UI. Unverified names to confirm against the boundary data: Bandar Pusaka, Banda Mulia, Bendahara, Karang Baru, Kejuruan Muda, Kota Kualasimpang, Manyak Payed, Rantau, Sekerak, Seruway, Tamiang Hulu, Tenggulun.

**Done when:** the full layout works with no data loaded, and no fake values appear anywhere.

**Stop for review.**

## Stage 3: Add data, one layer at a time

Follow this order, and stop for review after each layer:

1. Gampong and kecamatan boundaries
2. BPS population
3. Sentinel-1 flood extent
4. WorldPop population and estimated people in the flood extent
5. Reported human impact: casualties, injuries and related figures
6. Esri land use / land cover
7. DEMNAS elevation
8. InaRISK

Most source files are shapefiles. Ask the owner for each file when its stage is reached.

### Checklist for every layer

1. Inspect the source file and report its format, CRS, resolution, extent, date and any no-data values.
2. Confirm it covers Seruway.
3. Confirm with the owner that it may be published in this form. If unconfirmed, keep it local.
4. Write a reproducible script in `scripts/`.
5. Produce a small web-ready output in `data/web/`.
6. Add it to the layer configuration, with a legend, source, date and required attribution.
7. Record it in `docs/DATA_LOG.md`.
8. Check the result visually against the source in GIS or against the source values.

### Data notes

**Shapefiles (applies to all SHP inputs)**

- Ask for the complete set (`.shp`, `.shx`, `.dbf`, `.prj`, plus `.cpg` if present). Report it if the `.prj` is missing, and do not guess the CRS.
- Check the CRS, attribute fields, text encoding and geometry validity.
- Calculate areas in a projected CRS, then convert the web output to GeoJSON in EPSG:4326.
- If simplifying polygons, keep shared boundaries aligned and report the settings used.

**1. Boundaries: the owner has these as SHP**

Per-gampong figures cannot begin without them. Report any disagreement with the expected counts (12 kecamatan and 213 gampong in Aceh Tamiang, 24 gampong in Seruway; these figures come from Wikipedia and still need confirming against BPS). Identify a stable gampong ID or code to join other data. If only names are available, report every name that fails to match, and do not fuzzy-match silently.

**2. BPS population: the owner will supply this**

- Record the publication and year.
- Report whether it is available at gampong or only kecamatan level. Do not divide a kecamatan total across gampong without the owner's approval.
- If only kecamatan totals exist, show gampong values as "No data yet".

**3. Flood inundation**

Sentinel-1 GRD, processed by the BRIN Task Force for Disaster Response, the Research Center for Geoinformatics and UN-SPIDER.

- Ask for image date(s), method and permission to publish.
- Label it as **observed flood extent** and show the image date(s).
- Check for false water in ponds (tambak), tidal areas and normal water bodies. Ask the owner how to handle masking if this is not already done.
- State in the UI that SAR can miss water under vegetation and between buildings, and that image dates may miss the flood peak.
- Do not estimate flood depth.

**4. WorldPop population**

WorldPop constrained estimates, R2025A v1, 3 arc-second (about 100 m).

- Ask the owner which year to use, and display it.
- Calculate gampong totals by summing source grid values. Do not resample before summing.
- Estimate people in the flood extent per gampong, and state how partly flooded grid cells are handled.
- Compare totals with BPS where available, and report the differences. Do not rescale WorldPop to BPS without the owner's approval.
- Label results as modelled estimates, for example "Estimated people in flood extent".

**5. Reported human impact**

The owner defines "affected people" as reported impact figures, including casualties and injuries.

- Expected categories: deaths (meninggal), missing (hilang), injured (luka-luka), displaced (mengungsi) and affected (terdampak). Ask the owner to confirm the final list and whether to include other impacts, such as damaged houses.
- The owner has not yet named the source. Ask for the file and source, such as BNPB or BPBD.
- Record each figure's source, report date and definition. Figures can change between reports, so show the "as of" date on the cards.
- Keep categories separate. Do not add them into one total, because a person may be counted in more than one.
- Report which level the data covers (kabupaten, kecamatan or gampong). Do not divide higher-level figures across gampong, or model them, without the owner's approval. Show unavailable levels as "No data yet".
- Use a neutral design: plain numbers and no alarm-style colours or animation.
- Aggregate figures only. Do not publish names, addresses or other details of individual victims. Ask the owner before showing small counts at gampong level, as they could identify people.
- Keep these figures separate from the "Estimated people in flood extent" WorldPop result. If no reported data is available for a level, do not use the estimate in its place.

**6. Land use / land cover**

Esri Living Atlas, based on Karra et al. (2021).

- Confirm the year. Prefer a pre-flood year for flood impact figures, and display it.
- Calculate areas in a projected CRS, such as UTM 47N (EPSG:32647). Confirm this suits the full extent.

**7. Elevation**

DEMNAS from Badan Informasi Geospasial.

- Use it for elevation or hillshade display.
- Check the redistribution terms first. If unclear, publish only derived products after the owner approves.
- Do not treat it as sufficient for flood depth; small vertical errors matter on flat coastal land.

**8. InaRISK**

Supplied as an ArcGIS `.lyr` file, which typically holds styling and a reference to its source, not the data itself.

- Inspect the source reference first, and report whether it is an online service, a local file or a broken link.
- Check the reuse terms before using or republishing the data.
- Label it as **modelled hazard or risk**. Identify which hazard, index and scale it represents.
- If this layer is blocked, leave it disabled and continue. It must not hold up the rest of the prototype.

## Rules for scientific integrity

- Keep observed flood and modelled hazard as separate layers. Do not merge them.
- Never label a WorldPop-and-flood overlay as "affected people". It estimates people within the mapped flood extent, not reported casualties, injuries or other human impacts.
- Do not imply that casualties or injuries were caused only by the mapped flood unless the source says so. The event also involved other hazards, so ask the owner how to describe this.
- Do not mix BPS and WorldPop in a percentage without saying so. Every percentage must state its numerator and denominator.
- Do not call a layer "vulnerability" or "risk" unless the data supports that term. The current list mainly supports **exposure**.
- Do not create a composite risk index without the owner approving its method and inputs.
- Show missing data as missing, never as zero or low risk.
- Every figure shown must have a traceable source, date and processing step.
- Use a colour-blind-safe scheme, and do not rely on colour alone.

## Citations for the data sources

- **Population statistics:** BPS. Add the exact publication and year once supplied.
- **Human impact:** Source to be confirmed by the owner. Add the agency and report date once supplied.
- **Street basemap:** OpenStreetMap contributors, through OpenFreeMap.
- **Imagery basemap:** EOxCloudless by EOX IT Services GmbH. Use the attribution text for the chosen year.
- **DEMNAS:** Badan Informasi Geospasial. DEMNAS Indonesia DEM Dataset.
- **WorldPop:** Tatem, A. J. (2017). WorldPop, open data for spatial demography. *Scientific Data, 4*(1), 170004. https://doi.org/10.1038/sdata.2017.4
- **WorldPop:** Bondarenko, M., Priyatikanto, R., Tejedor Garavito, N., Zhang, W., McKeen, T., Cunningham, A., Woods, T., Hilton, J., Cihan, D., Nosatiuk, B., Brinkhoff, T., Tatem, A., & Sorichetta, A. (2025). *Constrained estimates of 2015-2030 total number of people per grid square at a resolution of 3 arc (approximately 100m at the equator) R2025A version v1* [Data set]. University of Southampton. https://doi.org/10.5258/SOTON/WP00839
- **Land use / land cover:** Karra, K., Kontgis, C., Statman-Weil, Z., Mazzariello, J. C., Mathis, M., & Brumby, S. P. (2021). Global land use / land cover with Sentinel 2 and deep learning. *2021 IEEE International Geoscience and Remote Sensing Symposium IGARSS*, 4704–4707. https://doi.org/10.1109/IGARSS47720.2021.9553499
- **Flood inundation:** Sentinel-1 GRD, processed by the BRIN Task Force for Disaster Response, the Research Center for Geoinformatics and UN-SPIDER. Confirm the preferred citation with the owner.
- **InaRISK:** BNPB. Confirm the exact layer and citation once its source is identified.

## Open questions for the owner

Ask each only when its stage is reached.

1. Please supply the boundary shapefiles. What is their source and year?
2. Is the BPS population data at gampong level? Which publication and year?
3. May the flood layer be published? What are its image dates and method?
4. What is the source of the casualty, injury and other impact figures? What report date and administrative level do they cover?
5. Does the project fit EOxCloudless's non-commercial licence?
6. Does the `.lyr` file point to a service or a local file?
7. Which WorldPop and LULC years should be used?
8. What should the dashboard's final name and repository be called?
9. Who is the main audience? This has not been decided, and it affects labels and summaries.

## First action

Start Stage 1 only. Stop when it is finished and show the result.
