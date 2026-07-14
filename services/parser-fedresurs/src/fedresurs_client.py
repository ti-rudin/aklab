#!/usr/bin/env python3
"""
Fedresurs API client — curl_cffi + /qauth bypass.
Batch mode: fetches all data in one call, outputs JSON to stdout.
"""
import sys
import json
import time
import hashlib
from curl_cffi import requests

FEDRESURS_URL = "https://fedresurs.ru"
BANKROT_URL = "https://bankrot.fedresurs.ru"
TIMEOUT = 30
MAX_RETRIES = 3

def create_session():
    s = requests.Session(impersonate="chrome124")
    s.headers.update({
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    })
    return s

def solve_qrator(session, url=FEDRESURS_URL):
    for attempt in range(MAX_RETRIES):
        try:
            r = session.get(f"{url}/qauth", timeout=TIMEOUT)
            if r.status_code == 200 and "qrator_ssid2" in dict(session.cookies):
                return True
            cookies = dict(session.cookies)
            if "qrator_jsr" in cookies:
                qrator_jsr = cookies["qrator_jsr"]
                parts = qrator_jsr.split("-")
                if len(parts) >= 3:
                    challenge, salt, difficulty = parts[0], parts[1], parts[2]
                    for w in range(10000000):
                        h = hashlib.md5((challenge + str(w)).encode()).hexdigest()
                        if h.startswith(difficulty):
                            session.post(f"{url}/__qrator/validate", data={
                                "state": "cb",
                                "token": f"{challenge}-{salt}",
                                "pow": str(w),
                            }, timeout=TIMEOUT)
                            break
            time.sleep(2)
        except Exception as e:
            time.sleep(3)
    return "qrator_ssid2" in dict(session.cookies)

def api_get(session, path, base_url=FEDRESURS_URL, params=None):
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Referer": f"{base_url}/",
        "Origin": base_url,
    }
    r = session.get(f"{base_url}{path}", headers=headers, params=params, timeout=TIMEOUT)
    if r.status_code in (403, 401, 451):
        # Re-auth and retry once
        solve_qrator(session, base_url)
        r = session.get(f"{base_url}{path}", headers=headers, params=params, timeout=TIMEOUT)
    return r

def main():
    session = create_session()
    results = {"pledged_subjects": [], "biddings": [], "errors": []}

    # Auth
    if not solve_qrator(session):
        results["errors"].append("Failed to authenticate with fedresurs.ru")
        print(json.dumps(results, ensure_ascii=False))
        sys.exit(1)

    # === Pledged subjects ===
    offset = 0
    limit = 100
    while True:
        r = api_get(session, "/backend/pledged-subjects", params={
            "limit": limit, "offset": offset, "onlyAvailableToParticipate": "false"
        })
        if r.status_code != 200:
            results["errors"].append(f"pledged-subjects offset={offset}: HTTP {r.status_code}")
            break
        data = r.json()
        items = data.get("pageData", [])
        results["pledged_subjects"].extend(items)
        offset += limit
        if len(items) < limit:
            break
        time.sleep(1)  # Rate limit protection

    # === Biddings ===
    offset = 0
    limit = 50
    max_biddings = int(sys.argv[1]) if len(sys.argv) > 1 else 500
    while len(results["biddings"]) < max_biddings:
        r = api_get(session, "/backend/biddings", params={
            "limit": limit, "offset": offset, "onlyAvailableToParticipate": "true"
        })
        if r.status_code != 200:
            results["errors"].append(f"biddings offset={offset}: HTTP {r.status_code}")
            break
        data = r.json()
        biddings = data.get("pageData", [])
        if not biddings:
            break

        # Fetch lots for each bidding
        for bidding in biddings:
            if len(results["biddings"]) >= max_biddings:
                break
            try:
                r_lots = api_get(session, f"/backend/biddings/{bidding['guid']}/lots", params={
                    "limit": 20, "offset": 0
                })
                if r_lots.status_code == 200:
                    lots_data = r_lots.json()
                    lots = lots_data.get("pageData", [])
                    bidding["_lots"] = lots
                else:
                    bidding["_lots"] = []
            except Exception:
                bidding["_lots"] = []
            results["biddings"].append(bidding)
            time.sleep(0.5)

        offset += limit
        if len(biddings) < limit:
            break
        time.sleep(1)

    print(json.dumps(results, ensure_ascii=False))

if __name__ == "__main__":
    main()
