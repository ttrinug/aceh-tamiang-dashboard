"""Publish reviewed BRIN Survey points and documentation to the dashboard.

Only records approved in the admin page's Survey review tab are published (see
scripts/survey_review.py and data/raw/survey/curation.json), with the reviewer's edits applied.

Input:  "for claude/survey/**/*.json"   export files from the dashboard's BRIN Survey panel, or the
                                       unzipped Drive upload folder (JSON files plus originals/<id>/)
        data/raw/BATASWILAYAH_KECAMATAN_20260601.gdb.zip   BIG kecamatan boundaries (via build_boundaries)
Output: data/web/brin_survey.geojson   public points
        data/web/brin_survey/*.jpg     public photos
        data/web/documentation.geojson   public documentation, one feature per photo
        data/web/documentation/*.jpg     public documentation photos
        data/raw/survey/originals/<id>/  original photo files (private, not committed)

The export files contain informant names, so they are copied only to data/raw/survey/, which
is not committed. Public output keeps the role of informants who agreed to be listed, and never
an informant's name. The contributor (the researcher or team who recorded the point) is public. Findings are published as written: read the list this script prints before pushing.
Points outside the BIG kecamatan boundaries are reported and left out. Where several files
hold the same record, a version is dropped only when a later one was edited from it; versions
edited separately are merged and reported (see resolve_versions). Photos are re-encoded, which
drops any metadata. Records with the same survey time and contributor are merged.

Documentation entries (kind "documentation") hold photos placed by the GPS position read from
each photo on the device, with a caption each, notes and a contributor. Photos outside the BIG
kecamatan boundaries are reported and left out; the rest keep their order.

Run from the repository root:  .venv/Scripts/python.exe scripts/build_survey.py
"""
import base64
import io
import json
import re
import shutil
from pathlib import Path

import geopandas as gpd
from PIL import Image
from shapely.geometry import Point

from build_boundaries import DECIMALS, ROOT, read_kecamatan
from survey_review import load_curation, select_approved

INBOX = ROOT / "for claude/survey"
RAW = ROOT / "data/raw/survey"
OUT = ROOT / "data/web/brin_survey.geojson"
PHOTOS = ROOT / "data/web/brin_survey"
ORIGINALS = RAW / "originals"
DOC_OUT = ROOT / "data/web/documentation.geojson"
DOC_PHOTOS = ROOT / "data/web/documentation"
MAX_SIDE = 1600


def read_entries(copy=True):
    """Every record in the inbox, each resolved from all its versions. With copy, the files are
    also kept in data/raw/survey/ (private)."""
    RAW.mkdir(parents=True, exist_ok=True)
    versions = {}
    for path in sorted(INBOX.rglob("*.json")):
        if copy:
            shutil.copy2(path, RAW / path.name)
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data.get("format") == "brin-survey-export", f"{path.name} is not a BRIN Survey export"
        for entry in data["entries"]:
            versions.setdefault(entry["id"], {})[entry["updatedAt"]] = entry
    values = [resolve_versions(record_id, list(found.values())) for record_id, found in versions.items()]
    docs = [e for e in values if e.get("kind") == "documentation"]
    surveys = [e for e in values if e.get("kind") != "documentation"]
    return merge_duplicates(surveys), docs


def resolve_versions(record_id, found):
    """One record from all its uploaded and exported versions, as the dashboard's import does.

    Nothing in the Drive folder is ever overwritten, so every version arrives here. A version is
    dropped only when a later one was edited from it (its updatedAt is in the later one's
    "versions" list). Versions edited separately, for example on two tablets, are merged, so no
    edit is lost, and reported for review.
    """
    edited_from = {v for entry in found for v in entry.get("versions") or []}
    heads = sorted((e for e in found if e["updatedAt"] not in edited_from), key=lambda e: e["updatedAt"], reverse=True)
    if len(found) > 1:
        print(f"Record {record_id}: {len(found)} versions, {len(found) - len(heads)} replaced by later edits")
    merged = heads[0]
    for other in heads[1:]:
        merged = merge_docs(merged, other) if merged.get("kind") == "documentation" else merge_entries(merged, other)
    if len(heads) > 1:
        print(f"    CHECK: {len(heads)} versions were edited separately and have been merged")
        merged = {**merged, "_separateEdits": len(heads)}
    return merged


def merge_docs(newer, older):
    """Documentation edited separately: photos from both (the same photo once), notes from both."""
    def signature(photo):
        return (photo.get("takenAt"), round(photo["lat"], 6), round(photo["lon"], 6))
    seen = {signature(p) for p in newer["photos"]}
    photos = newer["photos"] + [p for p in older["photos"] if signature(p) not in seen]
    return {**newer, "notes": append_once(newer.get("notes") or "", older.get("notes") or ""), "photos": photos}


def safe_id(value):
    """Record ids come from the device; keep only characters that are safe in a file name."""
    return re.sub(r"[^A-Za-z0-9-]", "_", value)


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
    # Each photo keeps its original file, matched by position in the two lists.
    pairs = {}
    for entry in (newer, older):
        originals = entry.get("originals") or []
        for i, photo in enumerate(entry["photos"]):
            pairs.setdefault(photo, originals[i] if i < len(originals) else None)
    return {**newer, "place": newer.get("place") or older.get("place"), "findings": findings, "informants": informants,
            "photos": list(pairs), "originals": list(pairs.values())}


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
        if len(group) > 1:
            print(f"Merged {len(group)} records with the same time and contributor: {surveyed_at}, {contributor}")
            merged = {**merged, "_duplicates": len(group)}
        kept.append(merged)
    return kept


def write_photo(data_url, path):
    image = Image.open(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1]))).convert("RGB")
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    image.save(path, "JPEG", quality=82)


def write_originals(entries, docs):
    """Saves each original photo file unchanged, metadata included, under data/raw (not committed)."""
    if ORIGINALS.exists():
        shutil.rmtree(ORIGINALS)
    found = [(e["id"], n, o) for e in entries for n, o in enumerate(e.get("originals") or [], start=1)]
    found += [(d["id"], n, p.get("original")) for d in docs for n, p in enumerate(d["photos"], start=1)]
    count = 0
    for record_id, number, original in found:
        if not original:
            continue
        data = original_bytes(record_id, number, original)
        if data is None:
            print(f"Missing original photo {number} of {record_id}: not in the export and not found under originals/")
            continue
        # The name comes from the device; keep only safe characters and no folders.
        name = re.sub(r"[^A-Za-z0-9._-]", "_", Path(original.get("name") or "photo").name)[-80:]
        folder = ORIGINALS / safe_id(record_id)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{number}-{name}").write_bytes(data)
        count += 1
    print(f"Saved {count} original photos in {ORIGINALS.relative_to(ROOT)} (private)")


def original_bytes(record_id, number, original):
    """An original photo: inside the export file, or uploaded to Drive as originals/<id>/<n>-<name>."""
    if original.get("data"):
        return base64.b64decode(original["data"].split(",", 1)[1])
    wanted = Path(original.get("file") or "").name
    for path in INBOX.rglob(wanted or f"{number}-*"):
        if path.parent.name == safe_id(record_id) and path.parent.parent.name == "originals":
            return path.read_bytes()
    return None


def build_documentation(docs, kecamatan):
    """One public feature per documentation photo, at the position read from the photo."""
    if DOC_PHOTOS.exists():
        shutil.rmtree(DOC_PHOTOS)
    DOC_PHOTOS.mkdir(parents=True)
    features, published = [], set()
    for doc in docs:
        photos = doc["photos"]
        points = gpd.GeoDataFrame(geometry=[Point(p["lon"], p["lat"]) for p in photos], crs=4326)
        joined = gpd.sjoin(points, kecamatan[["KDCPUM", "NAMOBJ", "geometry"]], predicate="within", how="left")
        joined = joined[~joined.index.duplicated()]
        contributor = doc.get("contributor") or None
        print(f"Documentation {doc['id']}: contributor {contributor}; {len(photos)} photos")
        print(f"    notes: {doc.get('notes') or ''}")
        kept = 0
        for i, photo in enumerate(photos):
            name, code = joined.loc[i, "NAMOBJ"], joined.loc[i, "KDCPUM"]
            if not isinstance(name, str):
                print(f"    Left out, outside the kabupaten: photo {i + 1} ({photo['lat']}, {photo['lon']})")
                continue
            signature = (photo.get("takenAt"), round(photo["lat"], 6), round(photo["lon"], 6))
            if signature in published:
                print(f"    Left out, already published in another entry: photo {i + 1}")
                continue
            published.add(signature)
            path = DOC_PHOTOS / f"{safe_id(doc['id'])}-{kept + 1}.jpg"
            write_photo(photo["photo"], path)
            features.append({
                "type": "Feature",
                "properties": {
                    "id": doc["id"],
                    "photo": kept,
                    "url": path.relative_to(ROOT).as_posix(),
                    "caption": photo.get("caption") or "",
                    "takenAt": photo.get("takenAt"),
                    "kecamatan": name,
                    "code": code,
                    "contributor": contributor,
                    "notes": doc.get("notes") or "",
                    "updatedAt": doc["updatedAt"],
                },
                "geometry": {"type": "Point", "coordinates": [round(photo["lon"], DECIMALS), round(photo["lat"], DECIMALS)]},
            })
            print(f"    photo {i + 1}: {name}, {photo.get('takenAt')}; caption: {photo.get('caption') or ''}")
            kept += 1
    DOC_OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {DOC_OUT.relative_to(ROOT)}: {len(features)} photos")


def main():
    entries, docs = read_entries()
    write_originals(entries, docs)
    curation = load_curation()
    entries = select_approved(entries, curation, "Survey points")
    docs = select_approved(docs, curation, "Documentation")
    for entry in entries:
        entry.pop("originals", None)  # not needed for the public output
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
            path = PHOTOS / f"{safe_id(row['id'])}-{number}.jpg"
            write_photo(data_url, path)
            photos.append(path.relative_to(ROOT).as_posix())
        # Roles of informants who agreed to be listed, unless the reviewer left the role out.
        roles = [p["role"] for p in row["informants"] if p.get("consent") and p.get("role") and not p.get("hidden")]
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
    build_documentation(docs, kecamatan)
    print("Before pushing: check the findings, notes and captions above for names, and the photos for faces of people who did not agree.")


if __name__ == "__main__":
    main()
