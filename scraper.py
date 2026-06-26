"""
Waterfront Warriors — Weekly Data Scraper
Run after each match week: python scraper.py
Run for an opponent:       python scraper.py --team=3821 --name="Storm Riders"
"""

import sys
import json
import re
import argparse
from datetime import date
from pathlib import Path

try:
    import requests
    import pandas as pd
    from bs4 import BeautifulSoup
except ImportError:
    print("Installing required packages...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "pandas", "lxml", "beautifulsoup4"])
    import requests
    import pandas as pd
    from bs4 import BeautifulSoup

BASE    = "https://cricclubs.com/NJSBCL"
WW_ID   = "3613"
CLUB_ID = "2690"
DATA    = Path("data")
TODAY   = str(date.today())

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
}

def fetch_tables(url):
    r = requests.get(url, headers=HEADERS, timeout=15)
    r.raise_for_status()
    return pd.read_html(r.text)

def fetch_soup(url):
    r = requests.get(url, headers=HEADERS, timeout=15)
    r.raise_for_status()
    return BeautifulSoup(r.text, "lxml")

def clean_float(val):
    try: return round(float(str(val).strip()), 2)
    except: return 0.0

def clean_int(val):
    try: return int(str(val).strip().split(".")[0])
    except: return 0

def scrape_batting(team_id, season_param=""):
    url = f"{BASE}/teamBatting.do?teamId={team_id}&clubId={CLUB_ID}{season_param}"
    print(f"  Fetching batting: {url}")
    tables = fetch_tables(url)
    if not tables:
        print("  No batting tables found.")
        return []
    df = tables[0]
    df.columns = [str(c).strip().lower() for c in df.columns]
    rows = []
    for i, row in df.iterrows():
        name = str(row.get("player", row.get("name", ""))).strip()
        if not name or name.lower() in ("player", "name", "nan"):
            continue
        rows.append({
            "rank":        i + 1,
            "name":        name,
            "mat":         clean_int(row.get("mat", row.get("m", 0))),
            "ins":         clean_int(row.get("ins", row.get("i", 0))),
            "no":          clean_int(row.get("no", 0)),
            "runs":        clean_int(row.get("runs", row.get("r", 0))),
            "balls":       clean_int(row.get("balls", row.get("b", 0))),
            "avg":         clean_float(row.get("avg", 0)),
            "sr":          clean_float(row.get("sr", 0)),
            "hs":          clean_int(row.get("hs", 0)),
            "fifties":     clean_int(row.get("50s", row.get("fifties", 0))),
            "twentyfives": clean_int(row.get("25s", row.get("twentyfives", 0))),
        })
    return rows

def scrape_bowling(team_id, season_param=""):
    url = f"{BASE}/teamBowling.do?teamId={team_id}&clubId={CLUB_ID}{season_param}"
    print(f"  Fetching bowling: {url}")
    tables = fetch_tables(url)
    if not tables:
        print("  No bowling tables found.")
        return []
    df = tables[0]
    df.columns = [str(c).strip().lower() for c in df.columns]
    rows = []
    for i, row in df.iterrows():
        name = str(row.get("player", row.get("name", ""))).strip()
        if not name or name.lower() in ("player", "name", "nan"):
            continue
        rows.append({
            "rank": i + 1,
            "name": name,
            "mat":  clean_int(row.get("mat", row.get("m", 0))),
            "inns": clean_int(row.get("inns", row.get("i", 0))),
            "overs":clean_float(row.get("overs", row.get("o", 0))),
            "runs": clean_int(row.get("runs", row.get("r", 0))),
            "wkts": clean_int(row.get("wkts", row.get("w", 0))),
            "bbf":  str(row.get("bbf", "-")).strip(),
            "dots": clean_int(row.get("dots", row.get("dot", 0))),
            "econ": clean_float(row.get("econ", row.get("economy", 0))),
            "ave":  clean_float(row.get("ave", row.get("avg", 0))),
            "sr":   clean_float(row.get("sr", 0)),
        })
    return rows

def scrape_matches(team_id):
    url = f"{BASE}/listFixtures.do?teamId={team_id}&clubId={CLUB_ID}"
    print(f"  Fetching fixtures: {url}")
    soup = fetch_soup(url)
    matches = []
    for row in soup.select("table tr")[1:]:
        cols = row.find_all("td")
        if len(cols) < 4:
            continue
        link = row.find("a", href=re.compile(r"viewScorecard"))
        match_id = ""
        if link:
            m = re.search(r"matchId=(\d+)", link["href"])
            if m: match_id = m.group(1)
        matches.append({
            "matchId":       match_id,
            "date":          cols[0].get_text(strip=True),
            "opponent":      cols[1].get_text(strip=True),
            "result":        cols[2].get_text(strip=True)[:1].upper(),
            "warriorsScore": cols[3].get_text(strip=True) if len(cols) > 3 else "",
            "opponentScore": cols[4].get_text(strip=True) if len(cols) > 4 else "",
            "youtubeUrl":    "",
        })
    return matches

def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"  Saved → {path}")

def update_warriors():
    print("\n── Waterfront Warriors ──")
    all_batting, all_bowling = [], []
    for season, param in [("2026", "&season=2026"), ("2025", "&season=2025")]:
        print(f"\n  Season {season}")
        bat  = scrape_batting(WW_ID, param)
        bowl = scrape_bowling(WW_ID, param)
        for r in bat:  r["season"] = season
        for r in bowl: r["season"] = season
        all_batting.extend(bat)
        all_bowling.extend(bowl)

    save(DATA / "warriors_batting.json", all_batting)
    save(DATA / "warriors_bowling.json", all_bowling)

    print("\n  Matches")
    matches = scrape_matches(WW_ID)
    # Preserve existing YouTube URLs
    existing = {}
    match_path = DATA / "warriors_matches.json"
    if match_path.exists():
        try:
            with open(match_path) as f:
                for m in json.load(f):
                    if m.get("youtubeUrl"):
                        existing[m["matchId"]] = m["youtubeUrl"]
        except: pass
    for m in matches:
        m["youtubeUrl"] = existing.get(m["matchId"], "")
    save(match_path, matches)

def update_opponent(team_id, team_name):
    slug = team_name.lower().replace(" ", "_")
    print(f"\n── {team_name} (ID {team_id}) ──")
    bat  = scrape_batting(team_id)
    bowl = scrape_bowling(team_id)
    data = {
        "teamId":       team_id,
        "teamName":     team_name,
        "season":       "2026",
        "last_updated": TODAY,
        "batting":      bat,
        "bowling":      bowl,
        "head_to_head": {},
        "key_threats":  [],
        "key_weaknesses": [],
        "counter_strategy": {},
    }
    save(DATA / "opponents" / f"{slug}.json", data)
    print(f"  Edit data/opponents/{slug}.json to add threats, weaknesses, and counter strategy.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--team", default="", help="Opponent team ID")
    parser.add_argument("--name", default="", help="Opponent team name")
    args = parser.parse_args()

    if args.team and args.name:
        update_opponent(args.team, args.name)
    else:
        update_warriors()

    print("\nDone. Commit and push to GitHub to update the live site.")
