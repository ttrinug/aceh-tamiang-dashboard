# Data checklist

What the dashboard still needs, most useful first. Tick items off as they arrive. Last updated 4 November 2026.

## For tomorrow

### 1. Infrastructure points (schools, health, worship, markets, offices)

These fill the "Total" column of the Infrastructure panel. "Damaged" already comes from BPBD. Points per facility type, with a type field, are ideal; one shapefile with a `jenis` field, or one file per type, both work.

Places to look:

- [ ] **Schools:** Kemendikdasmen school reference data (Data Referensi / Dapodik) lists every school with an NPSN and usually coordinates, searchable by kecamatan.
- [ ] **Health:** the Kemenkes facility registers list puskesmas, clinics and hospitals with codes; some include coordinates. The Dinas Kesehatan Aceh Tamiang is the other option.
- [ ] **Places of worship:** Kemenag SIMAS (Sistem Informasi Masjid) lists mosques and musala per kecamatan, many with coordinates.
- [ ] **All types at once:** OpenStreetMap, e.g. `amenity=school`, `hospital`, `clinic`, `place_of_worship`, `marketplace`, `townhall`, through the HOT Export Tool or an Overpass query. Check whether HOT ran a mapping activation for the Aceh floods; if so, coverage may be good.
- [ ] **Counts only, if points are hard to get:** BPS Podes (Potensi Desa) gives the number of schools, health facilities and places of worship per desa. They can be summed to kecamatan and entered through the Excel template.
- [ ] Note the date of each source. RBI may be out of date, as you said; OSM and SIMAS are often more current.

The admin page cannot read point files yet. When the first point file is ready, ask Claude to add a "points" type that counts facilities per kecamatan and shows them on the map.

### 2. BPS population per kecamatan

- [ ] **Kecamatan Dalam Angka 2025** (one book per kecamatan) or **Aceh Tamiang Dalam Angka 2025**: population, male and female, households (KK) and age groups per kecamatan.
- [ ] Enter them in `Template_Data_Kecamatan.xlsx`; the columns are already there. Note the publication and year in the `Info` sheet.

### 3. Answers for the observed flood layer (Sentinel-1)

- [ ] Dates of the before and after images.
- [ ] Settings used: VH or VV polarisation, ascending or descending pass, and the threshold (1.25 or changed).
- [ ] What "NoHutanAir" removed, and from which forest/water dataset.
- [ ] Preferred citation.
- [ ] Permission to publish.

## Also open

- [ ] **InaRISK:** the release year or version of the five hazard files, and whether they may be published.
- [ ] **ESRI land cover:** the map version. Should "flooded land by land cover" use 2017 (before the flood) instead of 2025?
- [ ] **Kecamatan name:** BIG writes "Kota Kualasinpang" and BPBD writes "Kota Kualasimpang". Which should the dashboard show?
- [ ] **Boundaries:** confirm the BIG date (12 June 2026 in the metadata vs 1 June in the file name), and that Tenggulun's 7.8 km² exclave is correct.
- [ ] **WorldPop:** cleared to publish? The licence (CC BY 4.0) allows it.
- [ ] **Satellite imagery:** EOxCloudless is non-commercial only (CC BY-NC-SA). Does the project fit that?
- [ ] **Going online:** a GitHub repository name, and the go-ahead for GitHub Pages.
- [ ] **Later, if wanted:** kelurahan/gampong boundaries and data, e.g. BIG village boundaries or BPS Podes.

## Done

- [x] Kecamatan boundaries (BIG)
- [x] Observed flood extent (Sentinel-1, UN-SPIDER method; details above still open)
- [x] InaRISK hazards: banjir, banjir bandang, cuaca ekstrem, kekeringan, tanah longsor
- [x] WorldPop 2017 and 2025
- [x] ESRI land cover 2017 and 2025
- [x] BPBD reported impact, snapshot of 19 March 2026 (cleared for publishing)
