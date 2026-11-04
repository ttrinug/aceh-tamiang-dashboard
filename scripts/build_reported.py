"""Build the reported impact figures (BPBD Aceh Tamiang) for the dashboard.

Input:  data/raw/bpbd/cekdatabencana_<date>.json   snapshot of https://cekdatabencana.acehtamiangkab.go.id/
        config/kecamatan.json                      BIG kecamatan codes and names (from build_boundaries)
Output: data/web/reported_by_kecamatan.json        one flat record per kecamatan code, plus kabupaten totals

Aggregate figures only. Kecamatan are matched to BIG codes by exact name, with one explicit
spelling difference; any other mismatch stops the script. A value missing on the page ("-",
or a facility type not listed for a kecamatan) stays null and is shown as missing, never as zero.

Run from the repository root:  .venv/Scripts/python.exe scripts/build_reported.py
"""
import json

from build_boundaries import ROOT

SOURCE = ROOT / "data/raw/bpbd/cekdatabencana_2026-03-19.json"
OUT = ROOT / "data/web/reported_by_kecamatan.json"

# BPBD spelling -> BIG spelling. Only names that differ are listed.
NAME_TO_BIG = {"Kota Kualasimpang": "Kota Kualasinpang"}

FACILITIES = ("education", "health", "worship", "market", "office", "shophouse")


def flatten(record):
    houses = record["houses"]
    detail = record["displaced_detail"]
    row = {
        "affected": record["affected"],
        "displaced": record["displaced"],
        "shelters": record["shelters"],
        "deaths": record["deaths"],
        "injured": record["injured"],
        "houses_total": houses["total"],
        "houses_light": houses["light"],
        "houses_moderate": houses["moderate"],
        "houses_heavy": houses["heavy"],
        "road_km": record["road_km"],
        "bridges": record["bridges"],
        "farmland_ha": record["farmland_ha"],
        "displaced_kk": detail["kk"],
        "displaced_under5": detail["under5"],
    }
    for facility in FACILITIES:
        row[f"{facility}_damaged"] = record[facility]["damaged"] if record[facility] else None
    return row


def main():
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    big = {k["name"]: k["id"] for k in json.loads((ROOT / "config/kecamatan.json").read_text(encoding="utf-8"))["kecamatan"]}

    kecamatan = {}
    for record in source["kecamatan"]:
        name = NAME_TO_BIG.get(record["name"], record["name"])
        assert name in big, f"no BIG kecamatan named {name!r}"
        kecamatan[big[name]] = {"name": name, **flatten(record)}
    missing = set(big.values()) - set(kecamatan)
    assert not missing, f"kecamatan missing from the source: {missing}"

    # The page's kabupaten totals must equal the sum of its kecamatan figures.
    totals = source["totals"]
    for field, total_field in [("affected", "affected"), ("displaced", "displaced"), ("deaths", "deaths"),
                               ("injured", "injured"), ("houses_total", "houses_damaged"), ("farmland_ha", "farmland_ha")]:
        summed = sum(row[field] or 0 for row in kecamatan.values())
        assert summed == totals[total_field], f"{field}: kecamatan sum {summed} != page total {totals[total_field]}"

    OUT.write_text(json.dumps({
        "source": f"{source['source']} ({source['url']}), page updated {source['page_updated']}, retrieved {source['retrieved']}",
        "kabupaten": totals,
        "kecamatan": dict(sorted(kecamatan.items())),
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(kecamatan)} kecamatan, totals match the page")


if __name__ == "__main__":
    main()
