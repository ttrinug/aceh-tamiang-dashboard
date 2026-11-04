"""Build the kecamatan boundary layer for the dashboard.

Input:  data/raw/BATASWILAYAH_KECAMATAN_20260601.gdb.zip  (BIG, layer BATAS_KECAMATAN_AR)
Output: data/web/kecamatan.geojson   simplified polygons, EPSG:4326
        config/kecamatan.json        kecamatan names, codes and label points for the dropdown and map

Areas are calculated from the unsimplified geometry in UTM 47N (EPSG:32647).
Simplification uses shapely.coverage_simplify, which keeps shared boundaries aligned.

Run from the repository root:  .venv/Scripts/python.exe scripts/build_boundaries.py
"""
import json
from pathlib import Path

import geopandas as gpd
import shapely
from shapely.ops import polylabel

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data/raw/BATASWILAYAH_KECAMATAN_20260601.gdb.zip"
LAYER = "BATAS_KECAMATAN_AR"
KABUPATEN_CODE = "11.16"  # Aceh Tamiang
DEFAULT_KECAMATAN = "11.16.04"  # Seruway, the pilot
AREA_CRS = 32647  # WGS 84 / UTM zone 47N
SIMPLIFY_TOLERANCE_M = 15
DECIMALS = 5  # about 1 m at this latitude

OUT_GEOJSON = ROOT / "data/web/kecamatan.geojson"
OUT_LIST = ROOT / "config/kecamatan.json"


def read_kecamatan():
    """Unsimplified Aceh Tamiang kecamatan from the BIG source, EPSG:4326, sorted by code.

    Also used by the other build scripts, so every area and overlay uses the same boundaries.
    """
    path = f"/vsizip/{SOURCE.as_posix()}/BATASWILAYAH_KECAMATAN.gdb"
    gdf = gpd.read_file(path, layer=LAYER, where=f"KDPKAB = '{KABUPATEN_CODE}'")
    print(f"Read {len(gdf)} kecamatan from {SOURCE.name}")
    assert gdf["KDCPUM"].is_unique, "kecamatan codes are not unique"
    assert gdf.geometry.is_valid.all(), "invalid source geometry"

    # The source CRS is WGS 84 + EGM2008 height; keep the horizontal part and drop Z.
    gdf = gdf.set_crs(4326, allow_override=True)
    gdf["geometry"] = shapely.force_2d(gdf.geometry)
    return gdf.sort_values("KDCPUM").reset_index(drop=True)


def main():
    gdf = read_kecamatan()
    projected = gdf.to_crs(AREA_CRS)
    gdf["area_km2"] = (projected.area / 1e6).round(2)

    assert shapely.coverage_is_valid(projected.geometry.values), "source polygons overlap or have gaps along shared edges"
    simplified = shapely.coverage_simplify(projected.geometry.values, SIMPLIFY_TOLERANCE_M)
    assert shapely.coverage_is_valid(simplified), "simplified polygons no longer share edges"
    shift = max(shapely.hausdorff_distance(a, b) for a, b in zip(projected.geometry.values, simplified))
    vertices = (shapely.get_num_coordinates(projected.geometry.values).sum(), shapely.get_num_coordinates(simplified).sum())

    out = gpd.GeoDataFrame(
        {"code": gdf["KDCPUM"], "name": gdf["NAMOBJ"], "area_km2": gdf["area_km2"]},
        geometry=gpd.GeoSeries(simplified, crs=AREA_CRS).to_crs(4326).values,
        crs=4326,
    )
    out["geometry"] = shapely.set_precision(out.geometry.values, 10 ** -DECIMALS)
    assert out.geometry.is_valid.all(), "invalid geometry after rounding"

    # One label point per kecamatan, inside its largest part, so islands and exclaves
    # do not get labels of their own.
    largest = [max(getattr(g, "geoms", [g]), key=lambda p: p.area) for g in projected.geometry]
    label_points = gpd.GeoSeries([polylabel(p, tolerance=10) for p in largest], crs=AREA_CRS).to_crs(4326)
    labels = [[round(pt.x, DECIMALS), round(pt.y, DECIMALS)] for pt in label_points]

    OUT_GEOJSON.parent.mkdir(parents=True, exist_ok=True)
    out.to_file(OUT_GEOJSON, driver="GeoJSON", COORDINATE_PRECISION=DECIMALS, RFC7946="YES", WRITE_BBOX="NO")

    kecamatan = {
        "source": "BIG Batas Wilayah Kecamatan 1:10.000 (BATAS_KECAMATAN_AR), built by scripts/build_boundaries.py",
        "default": DEFAULT_KECAMATAN,
        "bounds": [round(v, 4) for v in out.total_bounds],
        "kecamatan": [
            {"id": out.at[i, "code"], "name": out.at[i, "name"], "label": labels[i]}
            for i in out.sort_values("name").index
        ],
    }
    OUT_LIST.write_text(json.dumps(kecamatan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Simplified with coverage_simplify, tolerance {SIMPLIFY_TOLERANCE_M} m: {vertices[0]} -> {vertices[1]} vertices, max shift {shift:.1f} m")
    print(f"Wrote {OUT_GEOJSON.relative_to(ROOT)} ({OUT_GEOJSON.stat().st_size / 1024:.0f} KB) and {OUT_LIST.relative_to(ROOT)}")
    print(out.drop(columns="geometry").assign(source_LUASWH=gdf["LUASWH"].round(2)).to_string(index=False))


if __name__ == "__main__":
    main()
