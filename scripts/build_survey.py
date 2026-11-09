"""Publish reviewed BRIN Survey points to the dashboard.

Input:  "for claude/survey/*.json"   export files from the dashboard's BRIN Survey panel
        data/raw/BATASWILAYAH_KECAMATAN_20260601.gdb.zip   BIG kecamatan boundaries (via build_boundaries)
Output: data/web/brin_survey.geojson   public points
        data/web/brin_survey/*.jpg     public photos

The export files contain informant names, so they are copied only to data/raw/survey/, which
is not committed. Public output keeps the role of informants who agreed to be listed, and never
an informant's name. The contributor (the researcher or team who recorded the point) is public. Findings are published as written: read the list this script prints before pushing.
Points outside the BIG kecamatan boundaries are reported and left out. Where several files
hold the same point, the most recently edited version is used. Photos are re-encoded, which
drops any metadata. Records with the same survey time and contributor are merged.

Run from the repository root:  .venv/Scripts/python.exe scripts/build_survey.py
"""
import base64
import io
import json
import shutil

import geopandas as gpd
from PIL import Image
from shapely.geometry import Point

from build_boundaries import DECIMALS, ROOT, read_kecamatan

INBOX = ROOT / "for claude/survey"
RAW = ROOT / "data/raw/survey"
OUT = ROOT / "data/web/brin_survey.geojson"
PHOTOS = ROOT / "data/web/brin_survey"
MAX_SIDE = 1600


def read_entries():
    RAW.mkdir(parents=True, exist_ok=True)
    entries = {}
    for path in sorted(INBOX.glob("*.json")):
        shutil.copy2(path, RAW / path.name)
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data.get("format") == "brin-survey-export", f"{path.name} is not a BRIN Survey export"
        for entry in data["entries"]:
            current = entries.get(entry["id"])
            if current is None or entry["updatedAt"] > current["updatedAt"]:
                entries[entry["id"]] = entry
    return merge_duplicates(list(entries.values()))


def append_once(text, addition):
    if not addition or addition in text:
        return text
    return f"{text}\n\n{addition}" if text else addition


def merge_entries(newer, older):
    """Combines a duplicate into the more recently edited record, as the dashboard does.

    Findings, photos and informants from both are kept. A second location is written into the
    findings so the reviewer sees it. An informant counts as consenting only if both records say so.
    """
    informants = [dict(person) for person in newer["informants"]]
    for person in older["informants"]:
        same = next((p for p in informants if p.get("name") == person.get("name") and p.get("role") == person.get("role")), None)
        if same:
            same["consent"] = bool(same.get("consent") and person.get("consent"))
        else:
            informants.append(person)
    findings = append_once(newer["findings"], older["findings"])
    if (older["lat"], older["lon"]) != (newer["lat"], newer["lon"]):
        place = f" ({older['place']})" if older.get("place") else ""
        findings = append_once(findings, f"Lokasi lain yang digabung: {older['lat']}, {older['lon']}{place}")
    photos = list(dict.fromkeys(newer["photos"] + older["photos"]))
    return {**newer, "place": newer.get("place") or older.get("place"), "findings": findings, "informants": informants, "photos": photos}


def merge_duplicates(entries):
    """Merges records whose survey time and contributor are both filled in and identical."""
    groups, kept = {}, []
    for entry in entries:
        if entry.get("surveyedAt") and entry.get("contributor"):
            groups.setdefault((entry["surveyedAt"], entry["contributor"]), []).append(entry)
        else:
            kept.append(entry)
    for (surveyed_at, contributor), group in groups.items():
        group.sort(key=lambda e: e["updatedAt"], reverse=True)
        merged = group[0]
        for other in group[1:]:
            merged = merge_entries(merged, other)
        kept.append(merged)
        if len(group) > 1:
            print(f"Merged {len(group)} records with the same time and contributor: {surveyed_at}, {contributor}")
    return kept


def write_photo(data_url, path):
    image = Image.open(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1]))).convert("RGB")
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    image.save(path, "JPEG", quality=82)


def main():
    entries = read_entries()
    kecamatan = read_kecamatan()
    points = gpd.GeoDataFrame(entries, geometry=[Point(e["lon"], e["lat"]) for e in entries], crs=4326) if entries else None
    joined = gpd.sjoin(points, kecamatan[["KDCPUM", "NAMOBJ", "geometry"]], predicate="within", how="left") if entries else []

    if PHOTOS.exists():
        shutil.rmtree(PHOTOS)
    PHOTOS.mkdir(parents=True)

    features, left_out = [], []
    for _, row in (joined.iterrows() if entries else []):
        if not isinstance(row["KDCPUM"], str):
            left_out.append(row)
            continue
        photos = []
        for number, data_url in enumerate(row["photos"], start=1):
            path = PHOTOS / f"{row['id']}-{number}.jpg"
            write_photo(data_url, path)
            photos.append(path.relative_to(ROOT).as_posix())
        roles = [p["role"] for p in row["informants"] if p.get("consent") and p.get("role")]
        # Exports made before the contributor field existed have no value here.
        contributor = row.get("contributor")
        contributor = contributor if isinstance(contributor, str) and contributor else None
        features.append({
            "type": "Feature",
            "properties": {
                "id": row["id"],
                "place": row["place"],
                "surveyedAt": row["surveyedAt"],
                "updatedAt": row["updatedAt"],
                "contributor": contributor,
                "kecamatan": row["NAMOBJ"],
                "code": row["KDCPUM"],
                "findings": row["findings"],
                "roles": roles,
                "photos": photos,
            },
            "geometry": {"type": "Point", "coordinates": [round(row["lon"], DECIMALS), round(row["lat"], DECIMALS)]},
        })
        print(f"{row['surveyedAt']} {row['NAMOBJ']}: {row['place'] or '(no place name)'}; contributor {contributor}; {len(photos)} photos; roles {roles}")
        print(f"    findings: {row['findings']}")

    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(features)} points")
    for row in left_out:
        print(f"Left out, outside the kabupaten: {row['place'] or row['id']} ({row['lat']}, {row['lon']})")
    print("Before pushing: check the findings above for names, and the photos for faces of people who did not agree.")


if __name__ == "__main__":
    main()
