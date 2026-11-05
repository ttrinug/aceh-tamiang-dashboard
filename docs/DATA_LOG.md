# Data log

One entry per dataset: source, date, licence and processing.

## Kecamatan boundaries (Stage 3, layer 1)

- **Source:** Badan Informasi Geospasial (BIG), Batas Wilayah Kecamatan, scale 1:10,000. File geodatabase `BATASWILAYAH_KECAMATAN_20260601.gdb.zip`, layer `BATAS_KECAMATAN_AR`, supplied by the owner in `2. Dataset/5. Administrative/`.
- **Date:** the file name says 2026-06-01; the `METADATA` field says `TASWIL1000020260612` (12 June 2026). The dashboard shows 2026-06-12. **Pending:** owner to confirm.
- **Copy used:** `data/raw/BATASWILAYAH_KECAMATAN_20260601.gdb.zip`, SHA-256 `32109ab835fa46a971df574f48dd1854fc943b9e33901d40da9bf8530cdb8d63`, identical to the owner's file. `Kecamatan.gdb` in the same folder has identical Aceh Tamiang geometry.
- **Format and CRS:** MultiPolygon Z. CRS is WGS 84 + EGM2008 height (EPSG:4326 + EPSG:3855). Z is dropped and the horizontal CRS is EPSG:4326.
- **Extent:** 97.7282–98.2874°E, 3.8888–4.5232°N.
- **Contents for Aceh Tamiang (`KDPKAB = '11.16'`):** 12 kecamatan, matching the expected count. The stable join key is `KDCPUM`, from `11.16.01` to `11.16.12`. Names are in `NAMOBJ`. All geometry is valid. The desa fields (`WADMKD`, `KDEPUM`) are empty, so this is kecamatan level only.
- **Names:** match the brief except "Kota Kualasinpang" (BIG spelling), where the brief has "Kota Kualasimpang". BIG's spelling is kept.
- **Notes on geometry:**
  - Tenggulun has a 7.8 km² exclave at about 97.985°E, 4.141°N.
  - Seruway and Bendahara include small coastal islands.
  - These come from the source and are kept.
- **Processing:** `scripts/build_boundaries.py`, using the package versions in `scripts/requirements.txt`.
  - Areas are calculated from the unsimplified geometry in UTM 47N (EPSG:32647). The total is 2,186.8 km². Each kecamatan is within 0.1% of BIG's `LUASWH`.
  - Simplification uses `shapely.coverage_simplify` with a 15 m tolerance. This keeps shared boundaries aligned, which was checked with `coverage_is_valid` before and after. Vertices go from 27,070 to 8,585, and the maximum shift (Hausdorff distance) is 18.7 m.
  - Coordinates are rounded to 5 decimals.
  - Each kecamatan gets one label point, placed with polylabel on its largest part.
- **Outputs:**
  - `data/web/kecamatan.geojson` (193 KB, EPSG:4326, properties `code`, `name`, `area_km2`).
  - `config/kecamatan.json` (names, codes, label points, kabupaten bounds).
- **Publishing:** **local only.** The owner has not yet cleared this layer for publishing. The output is listed in `.gitignore`.
- **Check:** compared with the source attribute table (count, codes, names, areas). Also checked visually over EOxCloudless 2024 imagery, where the boundaries follow the river around Kota Kualasinpang.

## BPS population (Stage 3, layer 2)

**Skipped for now (2026-11-02), at the owner's request.** No BPS file is in the project folders. The cards show "Belum ada data".

## Observed flood extent (Stage 3, layer 3)

- **Source:** `Banjir_NoHutanAir.shp`, from Sentinel-1 GRD, processed by the BRIN Task Force for Disaster Response, the Research Center for Geoinformatics and UN-SPIDER. Supplied by the owner in `2. Dataset/6. Floods/`, with file dates of 30 November 2025.
- **Method (owner, 2026-11-03):** the UN-SPIDER Recommended Practice for flood mapping in Google Earth Engine (https://un-spider.org/advisory-support/recommended-practices/recommended-practice-google-earth-engine-flood-mapping/step-by-step). As described in that guide:
  - Sentinel-1 GRD, with GEE preprocessing (orbit file, noise removal, calibration, terrain correction, dB).
  - Smoothing filter.
  - After/before mosaic ratio, with a default threshold of 1.25.
  - Masks: JRC Global Surface Water (water more than 10 months a year), HydroSHEDS slope over 5%, and clusters of 8 or fewer connected pixels.
  - No depth estimate.
  - The guide notes that urban flooding is likely underestimated.
- **Consistency check against the method:**
  - 97.5% of vertices sit on a 0.0000898° (10 m) grid, consistent with a GEE export at scale 10.
  - 61% of polygons in the kabupaten are smaller than 9 pixels, but they hold only 1.5% of the flooded area. These can be fragments from converting the raster to polygons, or from the later "NoHutanAir" erase. They don't contradict the connectivity filter.
- **Still pending from the owner:**
  - before and after date ranges;
  - the parameters used (polarization, pass direction, threshold, and whether it was changed from 1.25);
  - what "NoHutanAir" removed beyond the UN-SPIDER masks (presumably forest and water from another dataset);
  - the preferred citation;
  - permission to publish.
- **Copy used:** `data/raw/flood/` (complete set: `.shp`, `.shx`, `.dbf`, `.prj`, `.cpg`, `.sbn`, `.sbx`). SHA-256 of `.shp` is `37e68182…43bf` and of `.dbf` is `ba4df00f…ed45`, both identical to the owner's files.
- **Format and CRS:** Polygon shapefile, EPSG:4326, UTF-8.
- **Contents:**
  - 387,509 polygons, all `Value = 1`. It looks like a water raster converted to polygons.
  - There is no date field and no no-data class.
  - Vertex spacing is about 0.0000898°, roughly 10 m, which matches Sentinel-1 GRD.
- **Extent:** 97.04–102.93°E, 0.67°S–5.22°N, much larger than Aceh Tamiang. It covers all of Seruway.
- **Geometry:**
  - 2,642 polygons are invalid across the whole file, and 225 of those are within the kabupaten bounding box. All are repaired with `make_valid`, keeping polygon parts only.
  - Some polygons have zero area.
- **Processing:** `scripts/build_flood.py`. It reuses `read_kecamatan()` from `build_boundaries.py`, so it uses the same BIG boundaries.
  - It reads the 19,198 polygons in the kabupaten bounding box, repairs them, and dissolves them into one extent.
  - It intersects the extent with each unsimplified kecamatan in UTM 47N (EPSG:32647).
  - No extra masking was applied.
  - Areas come from the unsimplified extent.
  - The web geometry is simplified with a 5 m tolerance (half a pixel) and `preserve_topology`. Vertices go from 233,409 to 186,271, and the maximum shift is 8.4 m.
- **Result:** 115.65 km² observed flood out of 2,186.77 km² (5.3%). For Seruway, 8.50 km² out of 165.61 km² (5.1%). The highest share is Banda Mulia, at 26.5%.
- **Outputs:**
  - `data/web/flood_observed.geojson` (4.2 MB, one MultiPolygon per kecamatan).
  - `data/web/flood_by_kecamatan.json` (flooded km², kecamatan km², % per kecamatan and kabupaten).
- **In the dashboard:**
  - Labelled "Genangan banjir teramati (Sentinel-1)" (observed flood extent), with the date shown as "belum dikonfirmasi" (not yet confirmed).
  - The "% luas tergenang" (% area flooded) card has numerator = observed flood area (Sentinel-1) and denominator = kecamatan area (BIG). It is shown at kecamatan level only.
  - The limitations panel covers SAR blind spots, timing against the flood peak, no depth, and no separate tambak/tidal masking.
- **Publishing:** **local only.** The outputs are in `.gitignore`.
- **Check:**
  - The script's totals match an independent overlay done during inspection (115.7 km²).
  - Visually, over EOxCloudless 2024, the flood sits on the farmland plains of Bendahara, Banda Mulia and Manyak Payed and along the river. The mangrove and pond coast of Seruway is almost empty, which suggests the producer's mask removed it. Needs the owner's confirmation.

## Source files supplied on 2026-11-03

The owner put these in `for claude/` (listed in `.gitignore`). They were copied to `data/raw/inarisk/`, `data/raw/worldpop/` and `data/raw/lulc/`; SHA-256 checks show every copy is identical to the original. The originals were not opened for writing.

## InaRISK hazard indices (modelled hazard)

- **Source:** BNPB InaRISK hazard index polygons, five files: `INDEKS_BAHAYA_BANJIR1_30_draw`, `..._BANJIR_BANDANG_30_draw`, `..._CUACA_EKSTREM_30_draw`, `..._KEKERINGAN1_30_draw`, `..._TANAHLONGSOR_30_draw`. File dates 3 November 2026. **Pending:** the InaRISK release year or version, and whether these may be published.
- **Format:** Polygon shapefiles, EPSG:4326, fields `kelas_id` and `kelas` (1 Rendah, 2 Sedang, 3 Tinggi). Kekeringan has no Tinggi class in the source. Extent 96.0–99.9°E, 3.0–5.4°N (most of Aceh).
- **Processing:** `scripts/build_hazards.py`.
  - Reads the polygons in the kabupaten bounding box. Invalid polygons are repaired with `make_valid` (151, 2,538, 200, 1 and 1,928 respectively).
  - Dissolves each class and intersects it with each unsimplified BIG kecamatan in UTM 47N. The classes do not overlap (0 km² overlap).
  - Area per class per kecamatan comes from the unsimplified geometry. Area with no class is reported separately as "unrated"; it means the source has no polygon there, not zero hazard.
  - Web geometry is simplified with a 15 m tolerance (half the 30 m grid). The largest shift is 28 m (banjir).
- **Notable results:** Banjir has no class over most of the upland kecamatan (e.g. 458 of 512 km² of Tenggulun unrated). Banjir bandang is classed only in Tamiang Hulu, Bandar Pusaka and Tenggulun. Cuaca ekstrem and kekeringan cover nearly all of the kabupaten.
- **Outputs:** `data/web/hazard_<id>.geojson` (0.1–4.8 MB each) and `data/web/hazard_by_kecamatan.json`.
- **In the dashboard:** five layers under "Bahaya termodelkan (InaRISK)", off by default, kept separate from the observed flood. A stacked bar chart per hazard shows km² per class per kecamatan.
- **Publishing:** **local only.**

## WorldPop population (modelled estimate)

- **Source:** WorldPop R2025A v1, constrained, 3 arc-second (~100 m): `POP_2017.tif` (`idn_pop_2017_CN_100m_R2025A_v1`) and `POP_2025.tif`. Licence CC BY 4.0 (in the file tags).
- **Format:** float32, EPSG:4326, NoData −99999. In the kabupaten, NoData cells are outside WorldPop's settlement mask, where the constrained model places no people, so they add nothing to sums.
- **Processing:** `scripts/build_rasters.py`.
  - Each 100 m cell is split into 10 × 10 sub-cells. A kecamatan receives the share of the cell's value equal to the share of sub-cells whose centre lies inside it. Grid values are summed as they are, with no resampling.
  - Population in the observed flood extent uses the same sub-cells, intersected with `data/web/flood_observed.geojson` (simplified by at most 8 m). It assumes people are spread evenly within a cell. It is labelled as an estimate of people living in the flood extent, **not** affected people.
- **Results:** 290,140 (2017) and 310,417 (2025) for the kabupaten. Estimated 14,619 people in the observed flood extent in 2025 (4.7%); Karang Baru has the most (3,943), Banda Mulia the highest share (10.7%).
- **Outputs:** `data/web/population_by_kecamatan.json`; map image `data/web/worldpop_2025.png` (people per cell in 5 classes, reprojected to EPSG:3857 by nearest neighbour for display only).
- **Publishing:** **local only** until the owner clears it, although the licence allows it with attribution.

## ESRI land cover

- **Source:** ESRI 10 m land use / land cover (Sentinel-2; Impact Observatory, Microsoft, ESRI), `LULC_2017.tif` and `LULC_2025.tif`. Class values follow the table the owner supplied (1 Water, 2 Trees, 4 Flooded vegetation, 5 Crops, 7 Built area, 8 Bare ground, 9 Snow/Ice, 10 Clouds, 11 Rangeland). **Pending:** the map version, and whether 2025 should be used as the pre-flood land cover.
- **Format:** uint8, EPSG:32647, 10 m, NoData 0. No NoData and no Snow/Ice inside the kabupaten.
- **Processing:** `scripts/build_rasters.py`. Cells are assigned to a kecamatan and to the flood extent by cell centre; each cell is 100 m².
- **Results (2025):** Trees dominate the upland kecamatan; Crops are the largest flooded class in Manyak Payed, Bendahara, Karang Baru, Seruway and Banda Mulia. "Water" inside the flood extent (e.g. 4.6 km² in Manyak Payed) may be ponds or rivers.
- **Outputs:** `data/web/lulc_by_kecamatan.json` (both years, whole kecamatan and flood extent); map image `data/web/lulc_2025.png` (ESRI's usual class colours).
- **Publishing:** **local only.**

## Reported impact (BPBD Aceh Tamiang)

- **Source:** BPBD Kabupaten Aceh Tamiang, "PUSDATIN - Data Bencana Siklon Tropis Senyar", https://cekdatabencana.acehtamiangkab.go.id/. Page stamp "Update: Kamis, 19 Maret 2026 - 18.00 WIB". Read on 3 November 2026 at the owner's request.
- **How it was read:** the page has no separate data file; the figures are built into the page. They were read from the rendered "Semua Kecamatan" view in a browser. Only aggregate figures were taken; the per-victim detail list ("Klik untuk Detail") was not opened. Snapshot: `data/raw/bpbd/cekdatabencana_2026-03-19.json`.
- **Contents per kecamatan:** affected people, displaced people and shelter sites, deaths and injured, damaged houses (light/moderate/heavy), damaged education, health, worship, market, office and shop-house units (with the number back in use), damaged roads (km), bridges, affected farmland (ha), and displaced KK and under-5s. Kabupaten totals also include affected KK (72,813), which is not given per kecamatan.
- **Checks:** the 12 kecamatan add up exactly to every kabupaten total on the page (287,168 affected; 1,396 displaced; 13 shelter sites; 101 deaths; 18 injured; 75,088 houses; 543/192/724/15/44/156 facilities; 8,242 ha). Light + moderate + heavy equals the house total in every kecamatan.
- **Missing values:** Sekerak's deaths are shown as "-" on the page and are kept as missing (the kabupaten total of 101 is consistent with zero there). Facility types not listed for a kecamatan are kept as missing. Missing persons (hilang) are not reported on the site. Kecamatan without a "Titik" line are stored with 0 shelter sites, which matches the total of 13.
- **Names:** BPBD writes "Kota Kualasimpang"; it is matched to BIG's "Kota Kualasinpang" by an explicit mapping in `scripts/build_reported.py`. All other names match exactly.
- **Output:** `data/web/reported_by_kecamatan.json`.
- **In the dashboard:** the impact cards (Korban jiwa/Casualties, Luka-luka, Mengungsi, Terdampak), with one source and date line under them; five chart options (affected, displaced, damaged houses by level, farmland, roads); the "Data Kecamatan" table; and the "Damaged" column of the Infrastructure panel. "Korban jiwa" shows BPBD's deaths (meninggal) only. The "Hilang" (missing) card was removed on 2026-11-04 at the owner's request, as the site does not report it. The same day the owner removed the BPS population card and the planned DEMNAS elevation layer.
- **Publishing:** **cleared** by the owner on 2026-11-04. `data/web/reported_by_kecamatan.json` is no longer ignored by git. The raw snapshot stays in `data/raw/` and is not committed. The figures can change; the page says it is updated dynamically, so the date shown (19 March 2026) must be updated with any new snapshot.

## OpenStreetMap points of interest (2026-11-04)

At the owner's request, the 14 places of worship are shown as a map layer, "Tempat ibadah (OSM, belum lengkap)", built by `scripts/build_poi.py` into `data/web/worship_osm.geojson`. It is off by default, local only, and credited "© OpenStreetMap contributors, ODbL". It is not used in the Infrastructure panel or in any count. Schools and health facilities are not shown.


- **Source:** `cultural_places_points`, `education_facilities_points` and `health_facilities_points` shapefiles supplied by the owner in `for claude/POI/`. They are an OpenStreetMap export for all of Indonesia (fields `id` like `node/…`, `amenity`, `adm1`–`adm4` names and codes), points only. Copied to `data/raw/poi/`; the copies are identical to the originals.
- **Places of worship:** there is no religion field, so they are selected by `amenity = place_of_worship`. Inside the BIG kecamatan boundaries there are **14**: 8 in Rantau, 4 in Banda Mulia, 1 in Bendahara and 1 in Karang Baru. Nine have no name; the five named ones are all mosques ("Masjid …"). There are no churches or other religions in the extract. Saved to `data/raw/poi/worship_aceh_tamiang.gpkg`.
- **Schools and health facilities:** 19 schools and 2 health facilities (1 clinic, 1 hospital) in the kabupaten.
- **Why it is not in the dashboard:** BPBD alone reports 724 damaged places of worship, 543 damaged education facilities and 192 damaged health facilities. So this extract covers only a small fraction of the facilities, and using it as "Total" would show fewer facilities than were damaged. One likely reason is that OSM often maps mosques and schools as building outlines rather than points, and this export has points only.

## SITABA PU infrastructure points (2026-11-05)

- **Source:** Kementerian PU, SITABA, Portal Penanganan Bencana Sumatera (https://sitaba.pu.go.id/bencana-sumatera). A snapshot of its feature services, taken by the owner on 2026-11-05 at 09:31 WIB (02:31 UTC):
  - Jalan: `https://sigi.pu.go.id/serverpu/rest/services/Hosted/02_Jalan_Terdampak/FeatureServer/0`
  - Jembatan: `https://sigi.pu.go.id/serverpu/rest/services/02_Jembatan_Terdampak/FeatureServer/0`
  - Cipta Karya: `https://sigi.pu.go.id/serverpu/rest/services/03_Detail_Infra_CK_Terdampak/FeatureServer/0`
- **Copies used:** `data/raw/sitaba_20261105/` (not committed), with `manifest.json`. SHA-256:
  - `02_Jalan_Terdampak.geojson` `5ce46ab49af1a3bb2f499256ee6aee48fa24a402883d7152f88199483930376f`
  - `02_Jembatan_Terdampak.geojson` `8e5a1c7362ee0f3e02e175f5808fbcceb2c2ff69e77ff31b3daad6b98dd421c2`
  - `03_Detail_Infra_CK_Terdampak.geojson` `49f21949236d1ac8b76366891bbfad3c22398317e4183c8542d9d29a8779ea09`
  - `manifest.json` `37a2a803570c21395acd64ae506edab6c8c7e421320d3bad03ce47ed01ea4cad`
- **Selection** (`scripts/build_sitaba.py`):
  1. Rows whose key field is non-blank after trimming, the SITABA dashboard's own filter: `status_jalan` (Jalan), `status` (Jembatan), `sektor` (Cipta Karya).
  2. Rows whose trimmed `kabupaten` is "Aceh Tamiang", case-insensitive. These give the totals.
  3. For the map, only rows with server geometry that fall within the unsimplified BIG kecamatan boundaries. The coordinate attribute fields are not used, and no location was geocoded, matched or repaired.
  - `code` and `kecamatan` come from the spatial join, not from the source `kecamatan` field.
  - Text is trimmed (the source has values such as `"Selesai "`), and blank values are kept as null.
- **Output fields:**
  - Jalan: `oid`, `nama` (`nama_ruas`), `status_jalan`, `status_fungsional`, `status_penanganan`, `code`, `kecamatan`. The Jalan layer has no `oid` field, so `oid` is its `objectid`.
  - Jembatan: `oid`, `nama` (`nama_jembatan`), `nama_ruas_jalan`, `status_akses`, `status_penanganan`, `code`, `kecamatan`.
  - Cipta Karya: `oid`, `nama` (`nama_infrastruktur`), `sektor`, `jenis_infrastruktur`, `status_penanganan`, `code`, `kecamatan`.
  - Photo links, contractor names and worker counts are left out.
- **Counts:**

  | Layer | Aceh Tamiang rows | With geometry | Mapped |
  |---|---|---|---|
  | Jalan | 344 | 18 | 18 |
  | Jembatan | 16 | 1 | 1 |
  | Cipta Karya | 23 | 22 | 19 |

- **Excluded rows** (reported, not corrected):
  - oid 14848, Sanimas Desa Alue Sentang: labelled Aceh Tamiang, point outside the kabupaten (98.0629, 4.4920).
  - oid 15482, IBM PISEW KECAMATAN KLUET UTARA: labelled Aceh Tamiang, point outside (97.3233, 3.1038). Kluet Utara does not appear to be in Aceh Tamiang.
  - oid 15659, Sanitasi LPK Ponpes Ma'had Tahfidz Al-Qur'an Darul Huda Kutacane: labelled Aceh Tamiang, point outside (97.8497, 3.4482).
  - oid 15658, Sanitasi LPK Dayah Sabilul Ulum Diniyah Islamiyah: labelled Aceh Tenggara, point inside Aceh Tamiang (98.0629, 4.4104). Excluded by step 2.
  - Rows 15658 and 15659 are adjacent and may have swapped labels. This is unconfirmed, so both are left off the map.
  - One more Cipta Karya row labelled Aceh Tamiang has no point.
- **Source kecamatan differs from the point location** (kept on the map; the dashboard uses the location): Cipta Karya oid 14648 SPAM IKK Rantau (source "RANTAU", point in Karang Baru), oid 14651 SPAM IKK Kuala Simpang (source "KUALA SIMPANG", point in Kota Kualasinpang, the same place under BIG's spelling), and oid 14847 Sanimas Desa Ie Bintah (source "MANYAK PAYED", point in Karang Baru).
- **Spot check:** 3 Jalan, 1 Jembatan and 3 Cipta Karya points were compared with the source: names and values match, and coordinates differ only by the 5-decimal rounding (at most 0.000005°).
- **Not added:** Sungai has 1 Aceh Tamiang row with no geometry, and the other water-resources layers have none, so there is no water-resources layer.
- **Outputs:** `data/web/sitaba_jalan.geojson`, `sitaba_jembatan.geojson`, `sitaba_ck.geojson` and `sitaba_summary.json` (totals, mapped counts, snapshot time, excluded rows).
- **In the dashboard:** three icon layers under "Infrastruktur PU dilaporkan", off by default, each with a popup. SITABA counts are kept separate from the BPBD figures in the Infrastructure panel and are never added to them.
- **Licence and reuse terms not confirmed; Pusdatin PU not yet contacted.**
- **Publishing:** the owner approved publishing these three layers on 2026-11-05, knowing the reuse terms are not confirmed.

## Admin page

From 3 November 2026 datasets can also be added through the local admin page (`scripts/admin-server.mjs`, `scripts/admin_tool.py`). It copies each source to `data/raw/<dataset id>/`, clips it to the BIG kecamatan, and writes `data/web/<id>.geojson` or `<id>.png` and `<id>_by_kecamatan.json`. Each dataset added that way should get an entry in this log with its source, date, licence and the checks done.

## Unit of analysis: kecamatan

On 2026-11-03 the owner set the kecamatan as the unit of analysis. All gampong-level parts were removed from the dashboard: the gampong list (now a kecamatan list), the "% gampong affected" card, the gampong boundary layer entry, and the per-gampong charts (now per kecamatan).

Later the same day the owner asked for a "Data Kelurahan di Kecamatan X" panel, then changed it to "Data Kecamatan": a table of the 12 kecamatan for one chosen parameter, since there is no kelurahan-level data yet.

Gampong boundaries were not found in the project folders (`2. Dataset`, `3. GIS`), checked on 2026-11-02. The BIG kecamatan layer has empty desa fields.

## Basemaps (Stage 1)

Both are loaded live from their providers. Nothing is downloaded or stored in this repository. URLs and attribution text are in `config/basemaps.json`.

### Street: OpenStreetMap through OpenFreeMap

- Style URL: `https://tiles.openfreemap.org/styles/positron` (listed in the OpenFreeMap Quick Start; tested 2026-11-02)
- Data: © OpenStreetMap contributors, tiles © OpenMapTiles, served by OpenFreeMap
- Access: public instance, no API key. No SLA, so it is kept easy to replace in config.
- Attribution shown: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap". This is the same text as the provider's own TileJSON.

### Imagery: EOxCloudless 2024 (provisional)

- WMTS capabilities: `https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml` (checked 2026-11-02)
- Layer: `s2cloudless-2024_3857`, tile matrix set `GoogleMapsCompatible` (EPSG:3857), JPEG, 256 px
- Tile URL: `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg`
- Access: no API key requested and none mentioned in the EOX usage page or capabilities document.
- Year: 2024, before the flood. Labelled in the UI as not imagery of the flood.
- Resolution: Sentinel-2, about 10 m. Tiles above zoom 14 are only upsampled, so the source stops at zoom 14 and MapLibre enlarges it beyond that. Individual buildings are not visible.
- Licence (from the layer abstract): CC BY-NC-SA 4.0, non-commercial only. **Pending:** the owner must confirm the project fits this licence before publishing.
- Attribution shown: "EOxCloudless 2024 by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0", with links to cloudless.eox.at, eox.at and the licence.
