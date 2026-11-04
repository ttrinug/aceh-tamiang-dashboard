"""Data processing behind the local admin page (scripts/admin-server.mjs).

Commands (the server calls these; they can also be run by hand):
  inspect <path>          describe a source file in "for claude/" as JSON
  process                 read a JSON spec on stdin, build a dataset, print a JSON summary
  template <out.xlsx>     write the kecamatan spreadsheet template

Every source is first copied to data/raw/<dataset id>/ and only the copy is read, so the
owner's files are never opened for writing. Outputs go to data/web/. Kecamatan boundaries,
area CRS and rounding come from build_boundaries, so all datasets use the same kecamatan.

Dataset types for "process":
  classes         polygons with a class field (e.g. hazard index) -> area per class per kecamatan
  extent          polygons forming one extent (e.g. observed flood) -> area and share per kecamatan
  raster-sum      count raster (e.g. population) -> total per kecamatan, map image
  raster-classes  categorical raster (e.g. land cover) -> area per class per kecamatan, map image
  table           filled kecamatan spreadsheet template -> one value per column per kecamatan

The last line printed to stdout is the JSON result; progress messages go to stderr.

Run from the repository root:  .venv/Scripts/python.exe scripts/admin_tool.py inspect "for claude/x.shp"
"""
import json
import re
import shutil
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
import shapely
from affine import Affine
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from rasterio.features import rasterize
from rasterio.windows import Window, from_bounds

from build_boundaries import AREA_CRS, DECIMALS, ROOT, read_kecamatan
from build_rasters import POP_BREAKS, POP_COLOURS, block_sum, write_map_image

INBOX = ROOT / "for claude"
WEB = ROOT / "data/web"
SHAPEFILE_PARTS = (".shp", ".shx", ".dbf", ".prj", ".cpg", ".sbn", ".sbx", ".qix", ".xml")
TEMPLATE_COLUMNS = [
    # key, label id, label en, unit id, unit en, decimals
    ("penduduk", "Jumlah penduduk", "Population", "jiwa", "people", 0),
    ("laki_laki", "Penduduk laki-laki", "Male population", "jiwa", "people", 0),
    ("perempuan", "Penduduk perempuan", "Female population", "jiwa", "people", 0),
    ("kk", "Jumlah kepala keluarga", "Number of households", "KK", "households", 0),
    ("usia_0_14", "Penduduk usia 0-14", "Population aged 0-14", "jiwa", "people", 0),
    ("usia_15_64", "Penduduk usia 15-64", "Population aged 15-64", "jiwa", "people", 0),
    ("usia_65_plus", "Penduduk usia 65+", "Population aged 65+", "jiwa", "people", 0),
]


def log(message):
    print(message, file=sys.stderr, flush=True)


def inbox_path(relative):
    """Resolves a path inside "for claude/" and refuses anything outside it."""
    path = (INBOX / relative).resolve()
    if INBOX.resolve() not in path.parents:
        raise ValueError(f"{relative} is not inside the 'for claude' folder")
    if not path.exists():
        raise FileNotFoundError(relative)
    return path


def copy_source(path, dataset_id):
    """Copies a source file (and a shapefile's sidecar files) to data/raw/<id>/."""
    target = ROOT / "data/raw" / dataset_id
    target.mkdir(parents=True, exist_ok=True)
    parts = [path.with_suffix(s) for s in SHAPEFILE_PARTS] if path.suffix.lower() == ".shp" else [path]
    for part in parts:
        if part.exists():
            shutil.copy2(part, target / part.name)
    log(f"Copied {path.name} to {target.relative_to(ROOT)}")
    return target / path.name


# ---------------------------------------------------------------- inspect

def inspect(relative):
    path = inbox_path(relative)
    suffix = path.suffix.lower()
    if suffix in (".tif", ".tiff"):
        return inspect_raster(path)
    if suffix in (".xlsx",):
        return inspect_table(path)
    return inspect_vector(path)


def inspect_vector(path):
    import pyogrio
    info = pyogrio.read_info(path)
    kecamatan = read_kecamatan()
    sample = gpd.read_file(path, bbox=tuple(kecamatan.total_bounds), max_features=200000)
    fields = []
    for name, dtype in zip(info["fields"], info["dtypes"]):
        values = sample[name].dropna().unique()
        fields.append({
            "name": name,
            "dtype": str(dtype),
            "distinct": int(len(values)),
            # Up to 30 distinct values, enough to set up classes.
            "values": sorted(v.item() if hasattr(v, "item") else v for v in values)[:30] if len(values) <= 30 else None,
        })
    return {
        "kind": "vector",
        "crs": str(info["crs"]),
        "geometry": info["geometry_type"],
        "features": int(info["features"]),
        "bounds": [round(b, 4) for b in info["total_bounds"]],
        "features_in_kabupaten_box": int(len(sample)),
        "fields": fields,
        "suggested_types": ["classes", "extent"],
    }


def inspect_raster(path):
    kecamatan = read_kecamatan()
    with rasterio.open(path) as src:
        bounds = kecamatan.to_crs(src.crs).total_bounds
        window = from_bounds(*bounds, transform=src.transform).round_offsets().round_lengths()
        data = src.read(1, window=window, masked=True)
        result = {
            "kind": "raster",
            "crs": str(src.crs),
            "resolution": [abs(src.res[0]), abs(src.res[1])],
            "size": [src.width, src.height],
            "dtype": src.dtypes[0],
            "nodata": src.nodata,
            "bands": src.count,
            "tags": dict(list(src.tags().items())[:6]),
            "kabupaten_window": [int(window.width), int(window.height)],
        }
    if np.issubdtype(data.dtype, np.integer):
        values, counts = np.unique(data.compressed(), return_counts=True)
        if len(values) <= 30:
            result["values"] = [{"value": int(v), "cells": int(c)} for v, c in zip(values, counts)]
    if data.count():
        result["min"], result["max"] = float(data.min()), float(data.max())
    result["suggested_types"] = ["raster-classes"] if "values" in result else ["raster-sum"]
    return result


def inspect_table(path):
    result = read_table(path, validate_only=True)
    result["kind"] = "table"
    result["suggested_types"] = ["table"]
    return result


# ---------------------------------------------------------------- process

def kecamatan_stats_file(dataset_id, payload):
    path = WEB / f"{dataset_id}_by_kecamatan.json"
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def write_geojson(dataset_id, frame):
    path = WEB / f"{dataset_id}.geojson"
    frame["geometry"] = shapely.make_valid(shapely.set_precision(frame.geometry.values, 10 ** -DECIMALS))
    frame.to_file(path, driver="GeoJSON", COORDINATE_PRECISION=DECIMALS, RFC7946="YES", WRITE_BBOX="NO")
    return path


def polygons_only(geometries):
    parts = shapely.get_parts(shapely.make_valid(np.asarray(geometries)))
    return parts[shapely.get_type_id(parts) == 3]


def process_classes(spec, source):
    kecamatan = read_kecamatan()
    field = spec["class_field"]
    classes = [c["value"] for c in spec["classes"]]
    frame = gpd.read_file(source, bbox=tuple(kecamatan.total_bounds)).to_crs(4326)
    unknown = set(frame[field].dropna().unique()) - set(classes)
    if unknown:
        log(f"Warning: values not in the class list are left out: {sorted(unknown)}")
    projected = kecamatan.to_crs(AREA_CRS)
    merged = {}
    for value in classes:
        parts = polygons_only(frame.loc[frame[field] == value].geometry.values)
        geometry = shapely.union_all(parts) if len(parts) else shapely.Polygon()
        merged[value] = gpd.GeoSeries([geometry], crs=4326).to_crs(AREA_CRS).iloc[0]
        log(f"Class {value}: {len(parts)} polygons merged")

    stats, rows = {}, []
    tolerance = spec.get("simplify_m", 15)
    for row in projected.itertuples():
        area = row.geometry.area / 1e6
        areas = {}
        for value, geometry in merged.items():
            piece = shapely.intersection(geometry, row.geometry)
            areas[str(value)] = round(piece.area / 1e6, 3)
            if not piece.is_empty:
                rows.append({"code": row.KDCPUM, "name": row.NAMOBJ, "class": value,
                             "area_km2": round(piece.area / 1e6, 3),
                             "geometry": shapely.simplify(piece, tolerance, preserve_topology=True)})
        stats[row.KDCPUM] = {"name": row.NAMOBJ, "area_km2": round(area, 2), "classes_km2": areas,
                             "unrated_km2": round(max(area - sum(areas.values()), 0), 2)}
    out = gpd.GeoDataFrame(rows, crs=AREA_CRS).to_crs(4326)
    geojson = write_geojson(spec["id"], out)
    stats_path = kecamatan_stats_file(spec["id"], {"source": spec.get("source", ""), "kecamatan": stats})
    return {"file": rel(geojson), "stats": rel(stats_path), "renderer": "classes",
            "fields": {"classes_km2": "km2 per class", "unrated_km2": "km2 with no class"}, "kecamatan": stats}


def process_extent(spec, source):
    kecamatan = read_kecamatan()
    frame = gpd.read_file(source, bbox=tuple(kecamatan.total_bounds)).to_crs(4326)
    parts = polygons_only(frame.geometry.values)
    extent = gpd.GeoSeries([shapely.union_all(parts)], crs=4326).to_crs(AREA_CRS).iloc[0]
    log(f"Merged {len(parts)} polygons into one extent")
    projected = kecamatan.to_crs(AREA_CRS)
    stats, rows = {}, []
    tolerance = spec.get("simplify_m", 5)
    for row in projected.itertuples():
        piece = shapely.intersection(extent, row.geometry)
        area, inside = row.geometry.area / 1e6, piece.area / 1e6
        stats[row.KDCPUM] = {"name": row.NAMOBJ, "extent_km2": round(inside, 2), "area_km2": round(area, 2),
                             "extent_pct": round(100 * inside / area, 1)}
        rows.append({"code": row.KDCPUM, "name": row.NAMOBJ, "extent_km2": round(inside, 2),
                     "geometry": shapely.simplify(piece, tolerance, preserve_topology=True)})
    out = gpd.GeoDataFrame(rows, crs=AREA_CRS).to_crs(4326)
    geojson = write_geojson(spec["id"], out)
    stats_path = kecamatan_stats_file(spec["id"], {"source": spec.get("source", ""), "kecamatan": stats})
    return {"file": rel(geojson), "stats": rel(stats_path), "renderer": "fill",
            "fields": {"extent_km2": "km2 inside the extent", "extent_pct": "% of kecamatan area"}, "kecamatan": stats}


def raster_window(src, kecamatan, pad_cells=2):
    left, bottom, right, top = kecamatan.to_crs(src.crs).total_bounds
    window = from_bounds(left, bottom, right, top, transform=src.transform).round_offsets().round_lengths()
    return Window(window.col_off - pad_cells, window.row_off - pad_cells, window.width + 2 * pad_cells, window.height + 2 * pad_cells)


def merge_corners(key, corners):
    path = WEB / "rasters.json"
    existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    existing[key] = corners
    path.write_text(json.dumps(existing, indent=2) + "\n", encoding="utf-8")


def process_raster_sum(spec, source):
    """Sums cell values per kecamatan, splitting boundary cells into 10 x 10 sub-cells."""
    kecamatan = read_kecamatan()
    subcells = 10
    with rasterio.open(source) as src:
        window = raster_window(src, kecamatan)
        data = src.read(1, window=window, masked=True)
        transform, crs = src.window_transform(window), src.crs
    geometries = kecamatan.to_crs(crs).geometry
    h, w = data.shape
    labels = rasterize(((g, i + 1) for i, g in enumerate(geometries)), out_shape=(h * subcells, w * subcells),
                       transform=transform * Affine.scale(1 / subcells), fill=0, dtype="uint8")
    values = data.filled(0).astype("float64")
    stats, inside = {}, np.zeros((h, w))
    for i, row in enumerate(kecamatan.itertuples()):
        share = block_sum(labels == i + 1, subcells) / subcells ** 2
        inside += share
        stats[row.KDCPUM] = {"name": row.NAMOBJ, "total": round(float((values * share).sum()), 1)}
    log(f"{int(data.mask.sum())} NoData cells in the window are counted as 0")

    breaks = spec.get("breaks", POP_BREAKS)
    colours = spec.get("colours", POP_COLOURS)
    shown = np.ma.masked_array(values, mask=(inside < 0.5) | (values <= 0))
    classes = np.where(shown.mask, 0, np.digitize(shown.filled(0), breaks[1:]) + 1).astype("uint8")
    image_key = spec["id"]
    corners = write_map_image(classes, transform, crs, {i + 1: c for i, c in enumerate(colours)}, f"{image_key}.png")
    merge_corners(image_key, corners)
    stats_path = kecamatan_stats_file(spec["id"], {"source": spec.get("source", ""), "kecamatan": stats})
    return {"file": f"data/web/{image_key}.png", "image": image_key, "stats": rel(stats_path), "renderer": "image",
            "fields": {"total": "sum of cell values"}, "kecamatan": stats}


def process_raster_classes(spec, source):
    """Counts cells per class per kecamatan, assigning each cell by its centre."""
    kecamatan = read_kecamatan()
    classes = {c["value"]: c["color"] for c in spec["classes"]}
    with rasterio.open(source) as src:
        window = raster_window(src, kecamatan)
        data = src.read(1, window=window)
        transform, crs = src.window_transform(window), src.crs
        nodata = src.nodata
        if crs.is_projected:
            cell_km2 = abs(src.res[0] * src.res[1]) / 1e6
        else:
            raise ValueError("raster-classes needs a projected raster (metres), so cell areas are known")
    labels = rasterize(((g, i + 1) for i, g in enumerate(kecamatan.to_crs(crs).geometry)), out_shape=data.shape,
                       transform=transform, fill=0, dtype="uint8")
    stats = {}
    for i, row in enumerate(kecamatan.itertuples()):
        cells = data[labels == i + 1]
        values, counts = np.unique(cells, return_counts=True)
        areas = {str(int(v)): round(float(c * cell_km2), 3) for v, c in zip(values, counts) if int(v) in classes}
        unrated = sum(int(c) for v, c in zip(values, counts) if int(v) not in classes)  # includes NoData
        stats[row.KDCPUM] = {"name": row.NAMOBJ, "area_km2": round(float(len(cells) * cell_km2), 2), "classes_km2": areas,
                             "unrated_km2": round(unrated * cell_km2, 3)}
    shown = np.where((labels > 0) & np.isin(data, list(classes)), data, 0).astype("uint8")
    image_key = spec["id"]
    corners = write_map_image(shown, transform, crs, {int(v): c for v, c in classes.items()}, f"{image_key}.png")
    merge_corners(image_key, corners)
    stats_path = kecamatan_stats_file(spec["id"], {"source": spec.get("source", ""), "kecamatan": stats})
    return {"file": f"data/web/{image_key}.png", "image": image_key, "stats": rel(stats_path), "renderer": "image",
            "fields": {"classes_km2": "km2 per class"}, "kecamatan": stats}


def parse_number(cell):
    """A number from a spreadsheet cell. Text is read in Indonesian style ("12.345,6"),
    except a plain decimal like "3.5". Returns None when the text is not a number."""
    if isinstance(cell, (int, float)):
        return cell
    text = str(cell).strip().replace(" ", "")
    if re.fullmatch(r"-?\d{1,3}(\.\d{3})+(,\d+)?", text) or "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def read_table(path, validate_only=False):
    """Reads a filled kecamatan template. Empty cells stay empty (shown as "No data yet")."""
    workbook = load_workbook(path, data_only=True, read_only=True)
    problems = []
    for sheet in ("Data", "Kolom"):
        if sheet not in workbook.sheetnames:
            raise ValueError(f"sheet '{sheet}' is missing; use the template from the admin page")

    columns = []
    for key, label_id, label_en, unit_id, unit_en, decimals in workbook["Kolom"].iter_rows(min_row=2, max_col=6, values_only=True):
        if key:
            columns.append({"field": str(key).strip(), "label": {"id": label_id or key, "en": label_en or label_id or key},
                            "unit": {"id": unit_id or "", "en": unit_en or unit_id or ""}, "digits": int(decimals or 0)})

    rows = list(workbook["Data"].iter_rows(values_only=True))
    header = [str(h).strip() if h is not None else "" for h in rows[0]]
    if header[:2] != ["kode_kecamatan", "nama_kecamatan"]:
        raise ValueError("the first two columns of 'Data' must be kode_kecamatan and nama_kecamatan")
    known = {c["field"] for c in columns}
    for name in header[2:]:
        if name and name not in known:
            problems.append(f"column '{name}' is in Data but not described in Kolom; it is skipped")

    codes = {k["id"]: k["name"] for k in json.loads((ROOT / "config/kecamatan.json").read_text(encoding="utf-8"))["kecamatan"]}
    values, filled = {}, 0
    for number, row in enumerate(rows[1:], start=2):
        if not any(row):
            continue
        code = str(row[0]).strip() if row[0] else ""
        if code not in codes:
            problems.append(f"row {number}: kode_kecamatan '{code}' is not a BIG kecamatan code")
            continue
        record = {"name": codes[code]}
        for name, cell in zip(header[2:], row[2:]):
            if name not in known:
                continue
            if cell is None or (isinstance(cell, str) and not cell.strip()):
                record[name] = None
            else:
                record[name] = parse_number(cell)
                if record[name] is None:
                    problems.append(f"row {number}, column {name}: '{cell}' is not a number; left empty")
                else:
                    filled += 1
        values[code] = record
    missing = sorted(set(codes) - set(values))
    if missing:
        problems.append(f"no row for: {', '.join(codes[c] for c in missing)} (shown as no data)")
    info = {}
    if "Info" in workbook.sheetnames:
        for key, value in workbook["Info"].iter_rows(min_row=1, max_col=2, values_only=True):
            if key:
                info[str(key).strip()] = value
    return {"columns": columns, "kecamatan": values, "filled_cells": filled, "problems": problems, "info": info}


def process_table(spec, source):
    table = read_table(source)
    stats_path = kecamatan_stats_file(spec["id"], {"source": spec.get("source", ""), "kecamatan": table["kecamatan"]})
    return {"file": rel(stats_path), "stats": rel(stats_path), "renderer": None, "columns": table["columns"],
            "problems": table["problems"], "filled_cells": table["filled_cells"], "kecamatan": table["kecamatan"]}


PROCESSORS = {
    "classes": process_classes,
    "extent": process_extent,
    "raster-sum": process_raster_sum,
    "raster-classes": process_raster_classes,
    "table": process_table,
}


def rel(path):
    return path.relative_to(ROOT).as_posix()


def process(spec):
    if not spec.get("id") or not spec["id"].replace("-", "").isalnum() or spec["id"] != spec["id"].lower():
        raise ValueError("the dataset id must be lower-case letters, digits and hyphens")
    source = copy_source(inbox_path(spec["path"]), spec["id"])
    result = PROCESSORS[spec["type"]](spec, source)
    log(f"Done: {result['file']}")
    return result


# ---------------------------------------------------------------- template

def template(out):
    kecamatan = json.loads((ROOT / "config/kecamatan.json").read_text(encoding="utf-8"))["kecamatan"]
    bold = Font(bold=True)
    fill = PatternFill("solid", fgColor="E6F0FA")
    book = Workbook()

    guide = book.active
    guide.title = "Petunjuk"
    for line in [
        "Template data per kecamatan untuk dasbor Aceh Tamiang",
        "",
        "1. Isi angka di sheet 'Data', satu baris per kecamatan. Jangan ubah kolom kode_kecamatan.",
        "2. Sel kosong berarti belum ada data (ditampilkan sebagai '—', bukan nol).",
        "3. Untuk menambah kolom: tambahkan kolom di 'Data' dan jelaskan di 'Kolom' (nama kolom harus sama).",
        "4. Hapus kolom yang tidak dipakai dari kedua sheet.",
        "5. Isi sumber dan tanggal data di sheet 'Info'.",
        "6. Simpan file di folder 'for claude', lalu buka halaman admin > Tabel kecamatan.",
    ]:
        guide.append([line])
    guide["A1"].font = bold
    guide.column_dimensions["A"].width = 110

    data = book.create_sheet("Data")
    data.append(["kode_kecamatan", "nama_kecamatan", *[c[0] for c in TEMPLATE_COLUMNS]])
    for k in sorted(kecamatan, key=lambda k: k["id"]):
        data.append([k["id"], k["name"]])
    for cell in data[1]:
        cell.font, cell.fill = bold, fill
    data.column_dimensions["A"].width = 16
    data.column_dimensions["B"].width = 22
    data.freeze_panes = "C2"

    columns = book.create_sheet("Kolom")
    columns.append(["kolom", "label_id", "label_en", "satuan_id", "satuan_en", "desimal"])
    for row in TEMPLATE_COLUMNS:
        columns.append(list(row))
    for cell in columns[1]:
        cell.font, cell.fill = bold, fill
    for letter, width in zip("ABCDEF", (16, 30, 30, 12, 12, 9)):
        columns.column_dimensions[letter].width = width

    info = book.create_sheet("Info")
    for row in [("nama_dataset", ""), ("sumber", ""), ("tanggal", ""), ("catatan", "")]:
        info.append(row)
    for cell in info["A"]:
        cell.font = bold
    info.column_dimensions["A"].width = 16
    info.column_dimensions["B"].width = 60

    Path(out).parent.mkdir(parents=True, exist_ok=True)
    book.save(out)
    return {"file": str(out)}


def main():
    command = sys.argv[1]
    try:
        if command == "inspect":
            result = inspect(sys.argv[2])
        elif command == "process":
            result = process(json.loads(sys.stdin.read()))
        elif command == "template":
            result = template(sys.argv[2])
        else:
            raise ValueError(f"unknown command {command}")
        print(json.dumps({"ok": True, **result}, ensure_ascii=False, default=str))
    except Exception as error:  # reported to the admin page as a message, not a stack trace
        log(f"Error: {error}")
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
