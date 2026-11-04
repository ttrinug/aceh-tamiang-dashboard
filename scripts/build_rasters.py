"""Build the WorldPop population and Esri land cover layers for the dashboard.

Input:  data/raw/worldpop/POP_{2017,2025}.tif  WorldPop R2025A v1 constrained, 3 arc-second (~100 m), EPSG:4326
        data/raw/lulc/LULC_{2017,2025}.tif     Esri 10 m land use / land cover, EPSG:32647
        data/raw/BATASWILAYAH_KECAMATAN_20260601.gdb.zip   BIG kecamatan boundaries (via build_boundaries)
        data/web/flood_observed.geojson        observed flood extent (from build_flood)
Output: data/web/population_by_kecamatan.json  estimated population per kecamatan, and within the flood extent
        data/web/lulc_by_kecamatan.json        land cover area per class per kecamatan, and within the flood extent
        data/web/worldpop_2025.png, data/web/lulc_2025.png   map images in EPSG:3857, clipped to the kabupaten
        data/web/rasters.json                  corner coordinates of the map images

Population (WorldPop):
- NoData cells lie outside WorldPop's built-settlement mask, where the constrained model places
  no people, so they add nothing to the sums.
- Each 100 m cell is split into 10 x 10 sub-cells. A kecamatan gets the share of a cell's
  population equal to the share of sub-cells whose centre falls inside it; the same is done
  for the flood extent. This assumes people are spread evenly within a cell. Grid values are
  summed as they are, without resampling.
- "Population in the flood extent" is a modelled estimate of people living where flooding was
  observed. It is not a count of affected people.

Land cover (Esri):
- Cells are assigned to a kecamatan, and to the flood extent, by cell centre. Each cell is 100 m2.

Run from the repository root:  .venv/Scripts/python.exe scripts/build_rasters.py
"""
import json

import geopandas as gpd
import numpy as np
import rasterio
from affine import Affine
from PIL import Image
from rasterio.features import rasterize
from rasterio.warp import Resampling, calculate_default_transform, reproject, transform_bounds
from rasterio.windows import from_bounds

from build_boundaries import AREA_CRS, ROOT, read_kecamatan

POP_YEARS = (2017, 2025)
LULC_YEARS = (2017, 2025)
MAP_YEAR = 2025
SUBCELLS = 10  # per side, for splitting 100 m population cells

FLOOD = ROOT / "data/web/flood_observed.geojson"
OUT = ROOT / "data/web"

# Esri land cover classes and their usual colours (Karra et al. 2021).
LULC_CLASSES = {
    1: ("Water", "#419bdf"), 2: ("Trees", "#397d49"), 4: ("Flooded vegetation", "#7a87c6"),
    5: ("Crops", "#e49635"), 7: ("Built area", "#c4281b"), 8: ("Bare ground", "#a59b8f"),
    9: ("Snow/Ice", "#a8ebff"), 10: ("Clouds", "#616161"), 11: ("Rangeland", "#e3e2c3"),
}
# People per 100 m cell, for the map image only. Single-hue sequential (purples).
POP_BREAKS = [0, 5, 25, 50, 100]
POP_COLOURS = ["#dadaeb", "#bcbddc", "#9e9ac8", "#756bb1", "#54278f"]


def hex_rgb(colour):
    return tuple(int(colour[i:i + 2], 16) for i in (1, 3, 5))


def block_sum(fine, factor):
    """Sums factor x factor blocks of a 2-D array."""
    h, w = fine.shape
    return fine.reshape(h // factor, factor, w // factor, factor).sum(axis=(1, 3))


def write_map_image(classes, transform, crs, palette, name):
    """Reprojects a uint8 class array (0 = transparent) to EPSG:3857 and writes a palette PNG.

    Returns the image corners in lon/lat, in the order MapLibre's image source expects.
    """
    h, w = classes.shape
    left, bottom, right, top = rasterio.transform.array_bounds(h, w, transform)
    dst_transform, dst_w, dst_h = calculate_default_transform(crs, 3857, w, h, left, bottom, right, top)
    projected = np.zeros((dst_h, dst_w), dtype=np.uint8)
    reproject(classes, projected, src_transform=transform, src_crs=crs, dst_transform=dst_transform,
              dst_crs=3857, resampling=Resampling.nearest, src_nodata=0, dst_nodata=0)

    image = Image.fromarray(projected, mode="P")
    flat = [0, 0, 0]
    for index in range(1, 256):
        flat += list(hex_rgb(palette[index])) if index in palette else [0, 0, 0]
    image.putpalette(flat)
    path = OUT / name
    image.save(path, transparency=0, optimize=True)

    west, south, east, north = transform_bounds(3857, 4326, *rasterio.transform.array_bounds(dst_h, dst_w, dst_transform))
    corners = [[west, north], [east, north], [east, south], [west, south]]
    print(f"Wrote {path.relative_to(ROOT)} ({dst_w} x {dst_h} px, {path.stat().st_size / 1024:.0f} KB)")
    return [[round(x, 6), round(y, 6)] for x, y in corners]


def build_population(kecamatan, flood):
    with rasterio.open(ROOT / f"data/raw/worldpop/POP_{MAP_YEAR}.tif") as src:
        window = from_bounds(*kecamatan.total_bounds, transform=src.transform)
        window = window.round_offsets().round_lengths()
        window = rasterio.windows.Window(window.col_off - 2, window.row_off - 2, window.width + 4, window.height + 4)
        transform = src.window_transform(window)
        crs = src.crs

    h, w = int(window.height), int(window.width)
    fine_transform = transform * Affine.scale(1 / SUBCELLS)
    fine_shape = (h * SUBCELLS, w * SUBCELLS)
    labels = rasterize(((g, i + 1) for i, g in enumerate(kecamatan.geometry)), out_shape=fine_shape,
                       transform=fine_transform, fill=0, dtype="uint8")
    flooded = rasterize(((g, 1) for g in flood.geometry), out_shape=fine_shape,
                        transform=fine_transform, fill=0, dtype="uint8").astype(bool)
    share = [block_sum(labels == i + 1, SUBCELLS) / SUBCELLS ** 2 for i in range(len(kecamatan))]
    flood_share = [block_sum((labels == i + 1) & flooded, SUBCELLS) / SUBCELLS ** 2 for i in range(len(kecamatan))]

    people = {}
    for year in POP_YEARS:
        with rasterio.open(ROOT / f"data/raw/worldpop/POP_{year}.tif") as src:
            assert src.transform * (window.col_off, window.row_off) == transform * (0, 0), "WorldPop grids differ between years"
            data = src.read(1, window=window, masked=True)
        inside = sum(share) > 0
        print(f"WorldPop {year}: {int((~data.mask & inside).sum())} populated cells touch the kabupaten; "
              f"{int((data.mask & inside).sum())} are NoData (outside the settlement mask, counted as no people)")
        people[year] = data.filled(0).astype("float64")

    stats = {}
    for i, row in enumerate(kecamatan.itertuples()):
        values = {year: float((people[year] * share[i]).sum()) for year in POP_YEARS}
        in_flood = float((people[MAP_YEAR] * flood_share[i]).sum())
        stats[row.KDCPUM] = {
            "name": row.NAMOBJ,
            **{f"pop_{year}": round(values[year]) for year in POP_YEARS},
            "change_pct": round(100 * (values[POP_YEARS[1]] - values[POP_YEARS[0]]) / values[POP_YEARS[0]], 1),
            f"pop_flood_{MAP_YEAR}": round(in_flood),
            f"flood_share_pct_{MAP_YEAR}": round(100 * in_flood / values[MAP_YEAR], 1),
        }

    # Map image: cells mostly inside the kabupaten, classed by people per cell.
    inside_map = sum(share) >= 0.5
    data = np.ma.masked_array(people[MAP_YEAR], mask=~inside_map | (people[MAP_YEAR] <= 0))
    classes = np.where(data.mask, 0, np.digitize(data.filled(0), POP_BREAKS[1:]) + 1).astype("uint8")
    corners = write_map_image(classes, transform, crs, {i + 1: c for i, c in enumerate(POP_COLOURS)}, f"worldpop_{MAP_YEAR}.png")
    return stats, corners


def build_lulc(kecamatan, flood):
    projected = kecamatan.to_crs(AREA_CRS)
    with rasterio.open(ROOT / f"data/raw/lulc/LULC_{MAP_YEAR}.tif") as src:
        assert src.crs.to_epsg() == AREA_CRS, "unexpected land cover CRS"
        left, bottom, right, top = projected.total_bounds
        window = from_bounds(left - 20, bottom - 20, right + 20, top + 20, transform=src.transform)
        window = window.round_offsets().round_lengths()
        transform = src.window_transform(window)
        crs = src.crs
        cell_km2 = abs(src.res[0] * src.res[1]) / 1e6

    shape = (int(window.height), int(window.width))
    labels = rasterize(((g, i + 1) for i, g in enumerate(projected.geometry)), out_shape=shape,
                       transform=transform, fill=0, dtype="uint8")
    flooded = rasterize(((g, 1) for g in flood.to_crs(AREA_CRS).geometry), out_shape=shape,
                        transform=transform, fill=0, dtype="uint8").astype(bool)

    def tally(classes, mask):
        counts = np.bincount(labels[mask].astype("int64") * 256 + classes[mask], minlength=256 * (len(projected) + 1))
        return counts.reshape(len(projected) + 1, 256)

    stats = {row.KDCPUM: {"name": row.NAMOBJ} for row in projected.itertuples()}
    for year in LULC_YEARS:
        with rasterio.open(ROOT / f"data/raw/lulc/LULC_{year}.tif") as src:
            assert src.transform * (window.col_off, window.row_off) == transform * (0, 0), "land cover grids differ between years"
            classes = src.read(1, window=window)
        unknown = set(np.unique(classes[labels > 0])) - set(LULC_CLASSES) - {0}
        assert not unknown, f"unexpected land cover values in {year}: {unknown}"
        everywhere = tally(classes, labels > 0)
        in_flood = tally(classes, (labels > 0) & flooded)
        for i, row in enumerate(projected.itertuples()):
            s = stats[row.KDCPUM]
            s[f"area_{year}_km2"] = {str(c): round(float(everywhere[i + 1, c] * cell_km2), 3) for c in LULC_CLASSES if everywhere[i + 1, c]}
            s[f"nodata_{year}_km2"] = round(float(everywhere[i + 1, 0] * cell_km2), 3)
            s[f"flooded_{year}_km2"] = {str(c): round(float(in_flood[i + 1, c] * cell_km2), 3) for c in LULC_CLASSES if in_flood[i + 1, c]}
        print(f"Land cover {year}: {int((labels > 0).sum())} cells inside the kabupaten, {int(((labels > 0) & (classes == 0)).sum())} NoData")
        if year == MAP_YEAR:
            map_classes = np.where(labels > 0, classes, 0).astype("uint8")

    corners = write_map_image(map_classes, transform, crs, {c: colour for c, (_, colour) in LULC_CLASSES.items()}, f"lulc_{MAP_YEAR}.png")
    return stats, corners


def main():
    kecamatan = read_kecamatan()
    flood = gpd.read_file(FLOOD)

    pop_stats, pop_corners = build_population(kecamatan, flood)
    (OUT / "population_by_kecamatan.json").write_text(json.dumps({
        "source": "WorldPop R2025A v1 constrained 100 m (POP_2017.tif, POP_2025.tif), summed per BIG kecamatan by scripts/build_rasters.py",
        "kecamatan": pop_stats,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    lulc_stats, lulc_corners = build_lulc(kecamatan, flood)
    (OUT / "lulc_by_kecamatan.json").write_text(json.dumps({
        "source": "Esri 10 m land use / land cover (LULC_2017.tif, LULC_2025.tif), tallied per BIG kecamatan by scripts/build_rasters.py",
        "classes": {str(c): name for c, (name, _) in LULC_CLASSES.items()},
        "kecamatan": lulc_stats,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    (OUT / "rasters.json").write_text(json.dumps({
        f"worldpop_{MAP_YEAR}": pop_corners,
        f"lulc_{MAP_YEAR}": lulc_corners,
    }, indent=2) + "\n", encoding="utf-8")

    total = {year: sum(s[f"pop_{year}"] for s in pop_stats.values()) for year in POP_YEARS}
    print(f"Population, kabupaten: {total}; in flood extent {MAP_YEAR}: {sum(s[f'pop_flood_{MAP_YEAR}'] for s in pop_stats.values())}")
    for code, s in pop_stats.items():
        print(f"  {code} {s['name']:<18} 2017 {s['pop_2017']:>7}  2025 {s['pop_2025']:>7}  in flood {s['pop_flood_2025']:>6} ({s['flood_share_pct_2025']}%)")
    for code, s in lulc_stats.items():
        top = sorted(s["area_2025_km2"].items(), key=lambda kv: -kv[1])[:3]
        flooded = sorted(s["flooded_2025_km2"].items(), key=lambda kv: -kv[1])[:3]
        print(f"  {code} {s['name']:<18} 2025 top {[(LULC_CLASSES[int(c)][0], a) for c, a in top]}  flooded {[(LULC_CLASSES[int(c)][0], a) for c, a in flooded]}")


if __name__ == "__main__":
    main()
