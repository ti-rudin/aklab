#!/usr/bin/env python3
"""
Fedresurs API client — curl_cffi + /qauth bypass.
Called by Node.js parser-fedresurs as subprocess.
Outputs JSON to stdout.
"""
import sys
import json
import time
from curl_cffi import requests

FEDRESURS_URL = "https://fedresurs.ru"
BANKROT_URL = "https://bankrot.fedresurs.ru"
TIMEOUT = 30
MAX_RETRIES = 3

def create_session():
    """Create curl_cffi session with Chrome impersonation."""
    s = requests.Session(impersonate="chrome124")
    s.headers.update({
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    })
    return s

def solve_qrator(session, url=FEDRESURS_URL):
    """Get qrator_ssid2 cookie via /qauth endpoint."""
    for attempt in range(MAX_RETRIES):
        try:
            r = session.get(f"{url}/qauth", timeout=TIMEOUT)
            if r.status_code == 200 and "qrator_ssid2" in dict(session.cookies):
                return True
            # Try PoW solve if needed
            cookies = dict(session.cookies)
            if "qrator_jsr" in cookies:
                qrator_jsr = cookies["qrator_jsr"]
                parts = qrator_jsr.split("-")
                if len(parts) >= 3:
                    challenge, salt, difficulty = parts[0], parts[1], parts[2]
                    import hashlib
                    for w in range(10000000):
                        h = hashlib.md5((challenge + str(w)).encode()).hexdigest()
                        if h.startswith(difficulty):
                            # POST validate
                            session.post(f"{url}/__qrator/validate", data={
                                "state": "cb",
                                "token": f"{challenge}-{salt}",
                                "pow": str(w),
                            }, timeout=TIMEOUT)
                            break
            time.sleep(2)
        except Exception as e:
            print(f"Retry {attempt+1}: {e}", file=sys.stderr)
            time.sleep(3)
    return "qrator_ssid2" in dict(session.cookies)

def api_get(session, path, base_url=FEDRESURS_URL, params=None):
    """Make API request with proper headers."""
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Referer": f"{base_url}/",
        "Origin": base_url,
    }
    r = session.get(f"{base_url}{path}", headers=headers, params=params, timeout=TIMEOUT)
    if r.status_code == 403 or r.status_code == 401:
        # Re-auth
        solve_qrator(session, base_url)
        r = session.get(f"{base_url}{path}", headers=headers, params=params, timeout=TIMEOUT)
    return r

def fetch_pledged_subjects(session, limit=100, offset=0):
    """Fetch pledged subjects (best for real estate)."""
    r = api_get(session, "/backend/pledged-subjects", params={
        "limit": limit, "offset": offset, "onlyAvailableToParticipate": "false"
    })
    if r.status_code != 200:
        return {"error": r.status_code, "body": r.text[:200]}
    return r.json()

def fetch_biddings(session, limit=50, offset=0):
    """Fetch biddings list."""
    r = api_get(session, "/backend/biddings", params={
        "limit": limit, "offset": offset, "onlyAvailableToParticipate": "true"
    })
    if r.status_code != 200:
        return {"error": r.status_code, "body": r.text[:200]}
    return r.json()

def fetch_bidding_lots(session, guid):
    """Fetch lots for a specific bidding."""
    r = api_get(session, f"/backend/biddings/{guid}/lots", params={
        "limit": 20, "offset": 0
    })
    if r.status_code != 200:
        return {"error": r.status_code}
    return r.json()

def fetch_cmpbankrupts(session, limit=50, offset=0, search=None):
    """Fetch bankrupt companies from bankrot domain."""
    params = {"isActiveLegalCase": "true", "limit": limit, "offset": offset}
    if search:
        params["searchString"] = search
    r = api_get(session, "/backend/cmpbankrupts", base_url=BANKROT_URL, params=params)
    if r.status_code != 200:
        return {"error": r.status_code, "body": r.text[:200]}
    return r.json()

def main():
    """Main entry — reads command from stdin, outputs JSON to stdout."""
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: fedresurs_client.py <command> [args...]"}))
        sys.exit(1)

    command = sys.argv[1]
    session = create_session()

    # Always authenticate first
    if not solve_qrator(session):
        print(json.dumps({"error": "Failed to get qrator_ssid2"}))
        sys.exit(1)

    if command == "pledged-subjects":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 100
        offset = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        result = fetch_pledged_subjects(session, limit, offset)
        print(json.dumps(result, ensure_ascii=False))

    elif command == "biddings":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 50
        offset = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        result = fetch_biddings(session, limit, offset)
        print(json.dumps(result, ensure_ascii=False))

    elif command == "lots":
        guid = sys.argv[2] if len(sys.argv) > 2 else ""
        if not guid:
            print(json.dumps({"error": "guid required"}))
            sys.exit(1)
        result = fetch_bidding_lots(session, guid)
        print(json.dumps(result, ensure_ascii=False))

    elif command == "cmpbankrupts":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 50
        offset = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        search = sys.argv[4] if len(sys.argv) > 4 else None
        # Need separate auth for bankrot domain
        if not solve_qrator(session, BANKROT_URL):
            print(json.dumps({"error": "Failed to get qrator_ssid2 for bankrot"}))
            sys.exit(1)
        result = fetch_cmpbankrupts(session, limit, offset, search)
        print(json.dumps(result, ensure_ascii=False))

    elif command == "test":
        # Quick test — fetch 2 pledged subjects
        result = fetch_pledged_subjects(session, 2, 0)
        print(json.dumps(result, ensure_ascii=False, indent=2))

    else:
        print(json.dumps({"error": f"Unknown command: {command}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
