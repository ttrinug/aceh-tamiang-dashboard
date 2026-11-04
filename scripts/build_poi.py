"""Build the places-of-worship point layer (OpenStreetMap) for the dashboard.

Input:  data/raw/poi/cultural_places_points.shp   OpenStreetMap export for Indonesia, points only
        data/raw/BATASWILAYAH_KECAMATAN_20260601.gdb.zip   BIG kecamatan boundaries (via build_boundaries)
Output: data/web/worship_osm.geojson   places of worship inside the kabupaten, EPSG:4326

Places of worship are selected by amenity = place_of_worship; the export has no religion field.
Each point gets the code and name of the BIG kecamatan it falls in. The layer is far from
complete (see docs/DATA_LOG.md), so it is shown on the map only and never counted as a total.

Run from the repository root:  .venv/Scripts/python.exe scripts/build_poi.py
"""
import geopandas as gpd

from build_boundaries import DECIMALS, ROOT, read_kecamatan

SOURCE = ROOT / "data/raw/poi/cultural_places_points.shp"
OUT = ROOT / "data/web/worship_osm.geojson"


def main():
    kecamatan = read_kecamatan()
    points = gpd.read_file(SOURCE, bbox=tuple(kecamatan.total_bounds))
    points = points[points["amenity"] == "place_of_worship"]
    inside = gpd.sjoin(points, kecamatan[["KDCPUM", "NAMOBJ", "geometry"]], predicate="within")
    out = gpd.GeoDataFrame({
        "osm_id": inside["id"],
        "name": inside["name"],
        "code": inside["KDCPUM"],
        "kecamatan": inside["NAMOBJ"],
    }, geometry=inside.geometry, crs=4326)
    out.to_file(OUT, driver="GeoJSON", COORDINATE_PRECISION=DECIMALS, RFC7946="YES", WRITE_BBOX="NO")
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(out)} places of worship, {int(out['name'].isna().sum())} without a name")
    print(out.groupby("kecamatan").size().to_string())


if __name__ == "__main__":
    main()
