"""Review (curation) of BRIN Survey records before they are published.

Only records approved here are published by build_survey.py. Review decisions are kept in
data/raw/survey/curation.json, which is private (data/raw is not committed). Each decision
records the content it was made on (contentKey): if the record changes afterwards, for example
after a new upload, it needs review again and is not published until approved again.

A reviewer can change the text that is published (place, findings, notes, contributor, photo
captions), leave out photos, and leave out informant roles. The uploaded records themselves are
never changed: the edits are applied when publishing. Locations cannot be edited.

Used by the local admin page (scripts/admin-server.mjs):
  survey_review.py list      all records with their review state, as JSON (holds informant names)
  survey_review.py save      saves one decision, read as JSON from stdin
  survey_review.py publish   runs build_survey.py and reports a summary as JSON
"""
import contextlib
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone

from build_boundaries import ROOT

CURATION = ROOT / "data/raw/survey/curation.json"
CURATION_BACKUP = ROOT / "data/raw/survey/curation_backup"
STATUSES = ("approved", "rejected")
EDITABLE = {"place", "findings", "notes", "contributor"}


def short_hash(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def photo_key(data_url):
    """Identifies one photo by its content, so review choices follow the photo, not its position."""
    return short_hash(data_url)


def informant_key(person):
    return short_hash(f"{person.get('name') or ''}|{person.get('role') or ''}")


def content_key(record):
    """Changes when what could be published changes; not when a record is only saved or uploaded again."""
    skip = {"updatedAt", "versions", "uploadedVersion", "originals", "createdAt"}
    data = {k: v for k, v in record.items() if k not in skip and not k.startswith("_")}
    if record.get("kind") == "documentation":
        data["photos"] = [{**{k: v for k, v in p.items() if k not in ("photo", "original")}, "photo": photo_key(p["photo"])}
                          for p in record["photos"]]
    else:
        data["photos"] = [photo_key(p) for p in record["photos"]]
    return short_hash(json.dumps(data, sort_keys=True, ensure_ascii=False))


def load_curation():
    if not CURATION.exists():
        return {}
    return json.loads(CURATION.read_text(encoding="utf-8")).get("records", {})


def save_curation(records):
    CURATION.parent.mkdir(parents=True, exist_ok=True)
    if CURATION.exists():
        CURATION_BACKUP.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        shutil.copy2(CURATION, CURATION_BACKUP / f"curation-{stamp}.json")
    CURATION.write_text(json.dumps({"records": records}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def review_state(record, curation):
    review = curation.get(record["id"])
    if not review:
        return "pending"
    if review.get("contentKey") != content_key(record):
        return "changed"
    return review["status"]


def apply_review(record, review):
    """The record as it will be published: the reviewer's text edits, without left-out photos and roles."""
    edits = review.get("edits") or {}
    hidden_photos = set(review.get("hiddenPhotos") or [])
    out = {**record, **{k: v for k, v in edits.items() if k in EDITABLE and isinstance(v, str)}}
    if record.get("kind") == "documentation":
        captions = edits.get("captions") or {}
        out["photos"] = [{**p, "caption": captions.get(photo_key(p["photo"]), p.get("caption") or "")}
                         for p in record["photos"] if photo_key(p["photo"]) not in hidden_photos]
    else:
        out["photos"] = [p for p in record["photos"] if photo_key(p) not in hidden_photos]
        hidden_roles = set(review.get("hiddenInformants") or [])
        out["informants"] = [{**p, "hidden": informant_key(p) in hidden_roles} for p in record["informants"]]
    return out


def select_approved(records, curation, label):
    """Keeps approved records, with the reviewer's edits applied, and reports the others."""
    approved, waiting = [], {}
    for record in records:
        state = review_state(record, curation)
        if state == "approved":
            approved.append(apply_review(record, curation[record["id"]]))
        else:
            waiting[state] = waiting.get(state, 0) + 1
    detail = ", ".join(f"{n} {state}" for state, n in sorted(waiting.items())) or "none"
    print(f"{label}: {len(approved)} approved and published; not published: {detail}")
    return approved


# ------------------------------------------------------------ admin commands

def list_records():
    from build_survey import read_entries
    with contextlib.redirect_stdout(sys.stderr):
        entries, docs = read_entries(copy=False)
    curation = load_curation()
    records = []
    for record in entries + docs:
        public = {k: v for k, v in record.items() if k != "originals"}
        if record.get("kind") == "documentation":
            public["photos"] = [{**{k: v for k, v in p.items() if k != "original"}, "key": photo_key(p["photo"])} for p in record["photos"]]
        else:
            public["photos"] = [{"photo": p, "key": photo_key(p)} for p in record["photos"]]
            public["informants"] = [{**p, "key": informant_key(p)} for p in record["informants"]]
        records.append({"record": public, "contentKey": content_key(record), "state": review_state(record, curation),
                        "review": curation.get(record["id"])})
    return {"ok": True, "records": records}


def save_review(body):
    record_id, review = body.get("id"), body.get("review") or {}
    if not isinstance(record_id, str) or not record_id:
        raise ValueError("No record id.")
    curation = load_curation()
    if review.get("status") == "pending":
        curation.pop(record_id, None)
    else:
        if review.get("status") not in STATUSES:
            raise ValueError("The status must be approved, rejected or pending.")
        if not isinstance(body.get("contentKey"), str):
            raise ValueError("No content key.")
        edits = review.get("edits") or {}
        curation[record_id] = {
            "status": review["status"],
            "contentKey": body["contentKey"],
            "reviewedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "edits": {k: v for k, v in edits.items() if (k in EDITABLE and isinstance(v, str)) or k == "captions"},
            "hiddenPhotos": [str(k) for k in review.get("hiddenPhotos") or []],
            "hiddenInformants": [str(k) for k in review.get("hiddenInformants") or []],
            "note": str(review.get("note") or ""),
        }
    save_curation(curation)
    return {"ok": True, "saved": record_id}


def publish():
    import build_survey
    with contextlib.redirect_stdout(sys.stderr):
        build_survey.main()
    count = lambda path: len(json.loads(path.read_text(encoding="utf-8"))["features"])  # noqa: E731
    return {"ok": True, "points": count(build_survey.OUT), "photos": count(build_survey.DOC_OUT)}


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        if command == "list":
            result = list_records()
        elif command == "save":
            result = save_review(json.loads(sys.stdin.read() or "{}"))
        elif command == "publish":
            result = publish()
        else:
            result = {"ok": False, "error": f"Unknown command {command!r}."}
    except Exception as error:  # reported to the admin page
        result = {"ok": False, "error": f"{type(error).__name__}: {error}"}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
