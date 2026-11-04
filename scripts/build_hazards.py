"""Build the InaRISK hazard index layers for the dashboard.

Input:  data/raw/inarisk/INDEKS_BAHAYA_*_30_draw.shp   BNPB InaRISK hazard index polygons
        (kelas_id 1 Rendah, 2 Sedang, 3 Tinggi), EPSG:4326, supplied by the owner
        data/raw/BATASWILAYAH_KECAMATAN_20260601.gdb.zip   BIG kecamatan boundaries (via build_boundaries)
Output: data/web/hazard_<id>.geojson        one feature per kecamatan and class, simplified, EPSG:4326
        data/web/hazard_by_kecamatan.json   area per class per kecamatan, and the area with no class

The source covers a large part of Aceh; it is clipped to the BIG kecamatan boundaries here.
Invalid source polygons are repaired with make_valid. Areas are calculated in UTM 47N
(EPSG:32647) from the unsimplified, clipped geometry.

Run from the repository root:  .venv/Scripts/python.exe scripts/build_hazards.py
"""
import json

import geopandas as gpd
import shapely

from build_boundaries import AREA_CRS, DECIMALS, ROOT, read_kecamatan

SOURCE_DIR = ROOT / "data/raw/inarisk"
HAZARDS = {
    "banjir": "INDEKS_BAHAYA_BANJIR1_30_draw.shp",
    "banjir-bandang": "INDEKS_BAHAYA_BANJIR_BANDANG_30_draw.shp",
    "cuaca-ekstrem": "INDEKS_BAHAYA_CUACA_EKSTREM_30_draw.shp",
    "kekeringan": "INDEKS_BAHAYA_KEKERINGAN1_30_draw.shp",
    "tanah-longsor": "INDEKS_BAHAYA_TANAHLONGSOR_30_draw.shp",
}
CLASSES = {1: "Rendah", 2: "Sedang", 3: "Tinggi"}
SIMPLIFY_TOLERANCE_M = 15  # half of the 30 m grid the source was drawn from

OUT_STATS = ROOT / "data/web/hazard_by_kecamatan.json"


def build(hazard_id, filename, kecamatan):
    source = gpd.read_file(SOURCE_DIR / filename, bbox=tuple(kecamatan.total_bounds))
    unknown = set(zip(source["kelas_id"], source["kelas"])) - set(CLASSES.items())
    assert not unknown, f"unexpected classes in {filename}: {unknown}"
    invalid = int((~source.geometry.is_valid).sum())

    projected = kecamatan.to_crs(AREA_CRS)
    stats, features = {}, []
    by_class = {}
    for kelas_id in CLASSES:
        parts = shapely.get_parts(shapely.make_valid(source.loc[source["kelas_id"] == kelas_id].geometry.values))
        parts = parts[shapely.get_type_id(parts) == 3]  # Polygon
        merged = shapely.union_all(parts) if len(parts) else shapely.Polygon()
        by_class[kelas_id] = gpd.GeoSeries([merged], crs=4326).to_crs(AREA_CRS).iloc[0]

    # Classes should not overlap; report it if they do, since areas would then be counted twice.
    overlap = sum(
        shapely.intersection(by_class[a], by_class[b]).area
        for a in CLASSES for b in CLASSES if a < b
    ) / 1e6

    for row in projected.itertuples():
        area_km2 = row.geometry.area / 1e6
        classes = {}
        for kelas_id, geometry in by_class.items():
            piece = shapely.intersection(geometry, row.geometry)
            classes[str(kelas_id)] = round(piece.area / 1e6, 2)
            if not piece.is_empty:
                features.append((row.KDCPUM, row.NAMOBJ, kelas_id, CLASSES[kelas_id], round(piece.area / 1e6, 2), piece))
        rated = sum(classes.values())
        stats[row.KDCPUM] = {
            "name": row.NAMOBJ,
            "area_km2": round(area_km2, 2),
            "classes_km2": classes,
            "unrated_km2": round(max(area_km2 - rated, 0), 2),
        }

    geometries = [shapely.simplify(f[-1], SIMPLIFY_TOLERANCE_M, preserve_topology=True) for f in features]
    shift = max((shapely.hausdorff_distance(f[-1], g) for f, g in zip(features, geometries)), default=0)
    out = gpd.GeoDataFrame(
        {
            "code": [f[0] for f in features],
            "name": [f[1] for f in features],
            "kelas_id": [f[2] for f in features],
            "kelas": [f[3] for f in features],
            "area_km2": [f[4] for f in features],
        },
        geometry=gpd.GeoSeries(geometries, crs=AREA_CRS).to_crs(4326).values,
        crs=4326,
    )
    out["geometry"] = shapely.make_valid(shapely.set_precision(out.geometry.values, 10 ** -DECIMALS))
    path = ROOT / f"data/web/hazard_{hazard_id}.geojson"
    out.to_file(path, driver="GeoJSON", COORDINATE_PRECISION=DECIMALS, RFC7946="YES", WRITE_BBOX="NO")

    print(f"{hazard_id}: {len(source)} source polygons in the bounding box, {invalid} invalid (repaired), "
          f"class overlap {overlap:.3f} km2, max simplification shift {shift:.1f} m, "
          f"wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1024:.0f} KB)")
    for code, s in stats.items():
        c = s["classes_km2"]
        print(f"  {code} {s['name']:<18} R {c['1']:>7.2f}  S {c['2']:>7.2f}  T {c['3']:>7.2f}  "
              f"unrated {s['unrated_km2']:>7.2f} of {s['area_km2']:>7.2f} km2")
    return {"file": filename, "kecamatan": stats}


def main():
    kecamatan = read_kecamatan()
    result = {
        "source": "BNPB InaRISK hazard index shapefiles, clipped to BIG kecamatan boundaries by scripts/build_hazards.py",
        "classes": {str(k): v for k, v in CLASSES.items()},
        "hazards": {hazard_id: build(hazard_id, filename, kecamatan) for hazard_id, filename in HAZARDS.items()},
    }
    OUT_STATS.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {OUT_STATS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
