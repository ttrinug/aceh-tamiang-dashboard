"""Build the SITABA (Kementerian PU) infrastructure point layers for the dashboard.

Input:  data/raw/sitaba_20261105/02_Jalan_Terdampak.geojson
        data/raw/sitaba_20261105/02_Jembatan_Terdampak.geojson
        data/raw/sitaba_20261105/03_Detail_Infra_CK_Terdampak.geojson
        (snapshot of the SITABA feature services, 2026-11-05 09:31 WIB; see manifest.json)
        data/raw/BATASWILAYAH_KECAMATAN_20260601.gdb.zip   BIG kecamatan boundaries (via build_boundaries)
Output: data/web/sitaba_jalan.geojson, sitaba_jembatan.geojson, sitaba_ck.geojson
        data/web/sitaba_summary.json   attribute totals, mapped counts and excluded rows

Selection, per layer:
1. Rows whose key field is non-blank after trimming (the SITABA dashboard's own filter).
2. Rows whose trimmed kabupaten is "Aceh Tamiang" (case-insensitive). These give the totals.
3. For the map, only those rows with server geometry that fall within the BIG kecamatan.
   The coordinate attribute fields are not used, and nothing is geocoded or repaired.
kecamatan and code come from the spatial join, not from the source kecamatan field.
Rows labelled Aceh Tamiang with a point outside the kabupaten, and points inside the
kabupaten labelled with another kabupaten, are listed in the summary and left off the map.

Run from the repository root:  .venv/Scripts/python.exe scripts/build_sitaba.py
"""
import json

import geopandas as gpd
import pandas as pd

from build_boundaries import DECIMALS, ROOT, read_kecamatan

SOURCE_DIR = ROOT / "data/raw/sitaba_20261105"
SNAPSHOT = "2026-11-05T09:31:37+07:00"
KABUPATEN = "aceh tamiang"

# output name -> source file, key field, id field, name field, other fields to keep
LAYERS = {
    "jalan": ("02_Jalan_Terdampak", "status_jalan", "objectid", "nama_ruas",
              ["status_jalan", "status_fungsional", "status_penanganan"]),
    "jembatan": ("02_Jembatan_Terdampak", "status", "oid", "nama_jembatan",
                 ["nama_ruas_jalan", "status_akses", "status_penanganan"]),
    "ck": ("03_Detail_Infra_CK_Terdampak", "sektor", "oid", "nama_infrastruktur",
           ["sektor", "jenis_infrastruktur", "status_penanganan"]),
}


def clean(value):
    """Trims text; blank text becomes None. Other values are kept as they are."""
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return None if pd.isna(value) else value


def build(name, kecamatan):
    source, key, id_field, name_field, fields = LAYERS[name]
    frame = gpd.read_file(SOURCE_DIR / f"{source}.geojson")
    kept = frame[frame[key].map(clean).notna()].copy()
    label = kept["kabupaten"].map(clean).str.lower()
    labelled = kept[label == KABUPATEN]

    def inside(rows):
        located = rows[rows.geometry.notna() & ~rows.geometry.is_empty]
        joined = gpd.sjoin(located, kecamatan[["KDCPUM", "NAMOBJ", "geometry"]], predicate="within", how="left")
        return located, joined

    located, joined = inside(labelled)
    mapped = joined[joined["KDCPUM"].notna()]
    outside = joined[joined["KDCPUM"].isna()]
    # Points inside the kabupaten that carry another kabupaten's label (reported, not mapped).
    _, others = inside(kept[label != KABUPATEN])
    mislabelled = others[others["KDCPUM"].notna()]

    out = gpd.GeoDataFrame({
        "oid": mapped[id_field].astype(int).values,
        "nama": mapped[name_field].map(clean).values,
        **{field: mapped[field].map(clean).values for field in fields},
        "code": mapped["KDCPUM"].values,
        "kecamatan": mapped["NAMOBJ"].values,
    }, geometry=mapped.geometry.values, crs=4326)
    path = ROOT / f"data/web/sitaba_{name}.geojson"
    out.to_file(path, driver="GeoJSON", COORDINATE_PRECISION=DECIMALS, RFC7946="YES", WRITE_BBOX="NO")

    def listed(rows, issue):
        return [{
            "oid": int(row[id_field]),
            "name": clean(row[name_field]),
            "kabupaten": clean(row["kabupaten"]),
            "point": [round(row.geometry.x, 4), round(row.geometry.y, 4)],
            "issue": issue,
        } for _, row in rows.iterrows()]

    summary = {
        "source_file": f"{source}.geojson",
        "id_field": id_field,
        "aceh_tamiang_rows": int(len(labelled)),
        "with_geometry": int(len(located)),
        "mapped": int(len(out)),
        "without_geometry": int(len(labelled) - len(located)),
        "excluded": listed(outside, "labelled Aceh Tamiang, point outside the BIG kecamatan boundaries")
                    + listed(mislabelled, "point inside Aceh Tamiang, labelled with another kabupaten"),
    }
    print(f"{name}: {summary['aceh_tamiang_rows']} Aceh Tamiang rows, {summary['with_geometry']} with geometry, "
          f"{summary['mapped']} mapped -> {path.relative_to(ROOT)}")
    for row in summary["excluded"]:
        print(f"  excluded oid {row['oid']} {row['name']!r} ({row['kabupaten']}) at {row['point']}: {row['issue']}")
    return summary


def main():
    kecamatan = read_kecamatan()
    layers = {name: build(name, kecamatan) for name in LAYERS}
    (ROOT / "data/web/sitaba_summary.json").write_text(json.dumps({
        "source": "Kementerian PU, SITABA, Portal Penanganan Bencana Sumatera (https://sitaba.pu.go.id/bencana-sumatera)",
        "snapshot": SNAPSHOT,
        "selection": "key field non-blank; kabupaten = Aceh Tamiang; mapped only with server geometry within the BIG kecamatan",
        "layers": layers,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("Wrote data/web/sitaba_summary.json")


if __name__ == "__main__":
    main()
