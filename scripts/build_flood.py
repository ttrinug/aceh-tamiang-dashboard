"""Build the observed flood extent layer for the dashboard.

Input:  data/raw/flood/Banjir_NoHutanAir.shp   Sentinel-1 flood polygons (Value = 1), EPSG:4326
        data/raw/BATASWILAYAH_KECAMATAN_20260601.gdb.zip   BIG kecamatan boundaries (via build_boundaries)
Output: data/web/flood_observed.geojson   flood extent clipped to each kecamatan, simplified, EPSG:4326
        data/web/flood_by_kecamatan.json  flooded area and share of area per kecamatan

The source is used as supplied: no extra masking of ponds, tidal areas or permanent water.
Invalid source polygons are repaired with make_valid. Areas are calculated in UTM 47N
(EPSG:32647) from the unsimplified, dissolved extent.

Run from the repository root:  .venv/Scripts/python.exe scripts/build_flood.py
"""
import json

import geopandas as gpd
import shapely

from build_boundaries import AREA_CRS, DECIMALS, ROOT, read_kecamatan

SOURCE = ROOT / "data/raw/flood/Banjir_NoHutanAir.shp"
SIMPLIFY_TOLERANCE_M = 5  # half the 10 m pixel; smooths the pixel staircase only

OUT_GEOJSON = ROOT / "data/web/flood_observed.geojson"
OUT_STATS = ROOT / "data/web/flood_by_kecamatan.json"


def main():
    kecamatan = read_kecamatan()
    flood = gpd.read_file(SOURCE, bbox=tuple(kecamatan.total_bounds))
    assert (flood["Value"] == 1).all(), "unexpected Value in flood source"
    invalid = int((~flood.geometry.is_valid).sum())
    print(f"Read {len(flood)} flood polygons in the kabupaten bounding box; {invalid} invalid, repaired with make_valid")

    # Keep only polygonal parts after repair, then dissolve into one extent.
    repaired = shapely.get_parts(shapely.make_valid(flood.geometry.values))
    repaired = repaired[shapely.get_type_id(repaired) == 3]  # Polygon
    extent = gpd.GeoSeries([shapely.union_all(repaired)], crs=4326).to_crs(AREA_CRS).iloc[0]

    projected = kecamatan.to_crs(AREA_CRS)
    stats, pieces = {}, []
    for row in projected.itertuples():
        piece = shapely.intersection(extent, row.geometry)
        flood_km2 = piece.area / 1e6
        area_km2 = row.geometry.area / 1e6
        stats[row.KDCPUM] = {
            "name": row.NAMOBJ,
            "flood_km2": round(flood_km2, 2),
            "area_km2": round(area_km2, 2),
            "flood_pct": round(100 * flood_km2 / area_km2, 1),
        }
        pieces.append((row.KDCPUM, row.NAMOBJ, round(flood_km2, 2), piece))

    simplified = [shapely.simplify(p, SIMPLIFY_TOLERANCE_M, preserve_topology=True) for *_, p in pieces]
    shift = max(shapely.hausdorff_distance(p, s) for (*_, p), s in zip(pieces, simplified))
    out = gpd.GeoDataFrame(
        {"code": [c for c, *_ in pieces], "name": [n for _, n, *_ in pieces], "flood_km2": [a for _, _, a, _ in pieces]},
        geometry=gpd.GeoSeries(simplified, crs=AREA_CRS).to_crs(4326).values,
        crs=4326,
    )
    out["geometry"] = shapely.make_valid(shapely.set_precision(out.geometry.values, 10 ** -DECIMALS))
    out.to_file(OUT_GEOJSON, driver="GeoJSON", COORDINATE_PRECISION=DECIMALS, RFC7946="YES", WRITE_BBOX="NO")

    total_flood = sum(s["flood_km2"] for s in stats.values())
    total_area = sum(s["area_km2"] for s in stats.values())
    OUT_STATS.write_text(json.dumps({
        "source": "Banjir_NoHutanAir.shp (Sentinel-1), clipped to BIG kecamatan boundaries by scripts/build_flood.py",
        "kabupaten": {"flood_km2": round(total_flood, 2), "area_km2": round(total_area, 2), "flood_pct": round(100 * total_flood / total_area, 1)},
        "kecamatan": stats,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    vertices = (sum(shapely.get_num_coordinates(p) for *_, p in pieces), int(shapely.get_num_coordinates(out.geometry.values).sum()))
    print(f"Simplified with tolerance {SIMPLIFY_TOLERANCE_M} m: {vertices[0]} -> {vertices[1]} vertices, max shift {shift:.1f} m")
    print(f"Wrote {OUT_GEOJSON.relative_to(ROOT)} ({OUT_GEOJSON.stat().st_size / 1024:.0f} KB) and {OUT_STATS.relative_to(ROOT)}")
    print(f"Kabupaten: {total_flood:.2f} of {total_area:.2f} km2 ({100 * total_flood / total_area:.1f}%)")
    for code, s in stats.items():
        print(f"  {code} {s['name']:<18} {s['flood_km2']:>7.2f} km2 of {s['area_km2']:>7.2f} ({s['flood_pct']}%)")


if __name__ == "__main__":
    main()
