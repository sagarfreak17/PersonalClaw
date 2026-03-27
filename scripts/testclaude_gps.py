"""
Team GPS CSAT Data Explorer
Read-only diagnostic script — maps everything available in the API.
Run this to understand your full data landscape before building the MCP server.
"""

import requests
import json
from datetime import datetime, timedelta
from collections import defaultdict
import re

# ─── CONFIG ───────────────────────────────────────────────────────────────────
API_KEY = "7aj8XQ7dBObd92GUrXGrb37HA8OY7jewOeFo.R7j1MFxyNscgAtYsoIQI8nY9gVCmUNZfR1wo9yVfrsI5ftqVI7hNm0eHJT0VO6fhAnClnZV3Nfl30lqgyxw"
BASE_URL = "https://api.team-gps.net/open-api/v1/csat/"

HEADERS = {
    "x-api-key": API_KEY,
    "Accept": "application/json"
}

# ─── CORE FETCH ───────────────────────────────────────────────────────────────
def fetch_csat(params: dict) -> list:
    """Paginate through all results for given filters."""
    results = []
    page = 1
    while True:
        p = {**params, "page": page, "page_size": 100}
        try:
            r = requests.get(BASE_URL, headers=HEADERS, params=p, timeout=15)
            r.raise_for_status()
            data = r.json().get("data", {})
            page_results = data.get("results", [])
            if not page_results:
                break
            results.extend(page_results)
            if page >= data.get("total_pages", 1):
                break
            page += 1
        except requests.exceptions.HTTPError as e:
            print(f"  HTTP Error: {e.response.status_code} — {e.response.text[:200]}")
            break
        except Exception as e:
            print(f"  Error: {e}")
            break
    return results


# ─── HELPER: EXTRACT ENGINEER NAME FROM TICKET_NAME ───────────────────────────
def extract_engineer(ticket_name: str) -> str:
    """
    Parses 'Monthly Feedback for Hampton for the Month of January' → 'Hampton'
    Also handles variations we might discover.
    """
    if not ticket_name:
        return "Unknown"
    # Pattern 1: "Monthly Feedback for {Name} for the Month of"
    m = re.search(r"Monthly Feedback for (.+?) (?:for the Month|For the Month)", ticket_name, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    # Pattern 2: "Monthly Feedback for {Name} - Month"
    m = re.search(r"Monthly Feedback for (.+?)(?:\s*[-–]|\s*$)", ticket_name, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return ticket_name  # fallback: return raw


def extract_month(ticket_name: str) -> str:
    """Extracts 'January' from ticket_name string."""
    months = ["January","February","March","April","May","June",
              "July","August","September","October","November","December"]
    for month in months:
        if month.lower() in ticket_name.lower():
            return month
    return "Unknown"


# ─── SECTION 1: API CONNECTIVITY CHECK ────────────────────────────────────────
def check_connectivity():
    print("\n" + "="*60)
    print("SECTION 1: API CONNECTIVITY CHECK")
    print("="*60)
    
    # Minimal request — just 1 record
    r = fetch_csat({"page_size": 1})
    if r:
        print("✅ API connection successful")
        print(f"   Sample record ID: {r[0].get('id')}")
        print(f"   Sample company:   {r[0].get('company')}")
        print(f"   Sample date:      {r[0].get('submitted_date', '')[:10]}")
    else:
        print("❌ API connection failed or no data returned")
        print("   Check: Is your API key correct?")
        print("   Check: Is 'Public APIs' toggled ON in Admin Settings > Integrations?")
        return False
    return True


# ─── SECTION 2: DISCOVER ALL COMPANIES ────────────────────────────────────────
def discover_companies():
    print("\n" + "="*60)
    print("SECTION 2: DISCOVER ALL COMPANIES (Partners)")
    print("="*60)
    print("Fetching last 90 days of data to map all companies...")
    
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    
    all_data = fetch_csat({
        "from_submitted_date": start_date,
        "to_submitted_date": end_date,
    })
    
    companies = defaultdict(lambda: {"total": 0, "positive": 0, "neutral": 0, "negative": 0})
    for r in all_data:
        co = r.get("company", "Unknown")
        companies[co]["total"] += 1
        rating = r.get("rating", "")
        if rating == "Positive":   companies[co]["positive"] += 1
        elif rating == "Neutral":  companies[co]["neutral"] += 1
        elif rating == "Negative": companies[co]["negative"] += 1
    
    print(f"\nFound {len(companies)} companies across {len(all_data)} records:\n")
    print(f"{'Company':<35} {'Total':>6} {'Pos':>5} {'Neu':>5} {'Neg':>5} {'Score':>7}")
    print("-"*65)
    for co, stats in sorted(companies.items(), key=lambda x: -x[1]["total"]):
        total = stats["total"]
        score = (stats["positive"] / total * 100) if total > 0 else 0
        print(f"{co:<35} {total:>6} {stats['positive']:>5} {stats['neutral']:>5} {stats['negative']:>5} {score:>6.1f}%")
    
    return list(companies.keys()), all_data


# ─── SECTION 3: DATA FIELD INVENTORY ──────────────────────────────────────────
def inventory_fields(all_data: list):
    print("\n" + "="*60)
    print("SECTION 3: DATA FIELD INVENTORY")
    print("="*60)
    print("Checking what fields actually have data (vs always null/empty)...\n")
    
    field_stats = defaultdict(lambda: {"populated": 0, "empty": 0, "sample_values": set()})
    
    for r in all_data:
        for field, value in r.items():
            if field == "team_members":
                # Special handling
                identifiers = [tm.get("identifier") for tm in (value or [])]
                has_real = any(i and i != "unassigned" for i in identifiers)
                if has_real:
                    field_stats["team_members(real)"]["populated"] += 1
                    field_stats["team_members(real)"]["sample_values"].add(str(identifiers[:2]))
                else:
                    field_stats["team_members(real)"]["empty"] += 1
                continue
            
            is_empty = (
                value is None or
                value == "" or
                value == [] or
                value == {}
            )
            key = field
            if is_empty:
                field_stats[key]["empty"] += 1
            else:
                field_stats[key]["populated"] += 1
                sv = field_stats[key]["sample_values"]
                if len(sv) < 3:
                    sv.add(str(value)[:60])
    
    total = len(all_data)
    print(f"{'Field':<30} {'Populated':>10} {'Empty':>8} {'Fill%':>7}  Sample")
    print("-"*90)
    for field, stats in sorted(field_stats.items()):
        pop = stats["populated"]
        emp = stats["empty"]
        pct = (pop / total * 100) if total > 0 else 0
        samples = " | ".join(list(stats["sample_values"])[:2])
        flag = "⚠️ " if pct < 20 else "✅ " if pct > 80 else "🔶 "
        print(f"{flag}{field:<28} {pop:>10} {emp:>8} {pct:>6.0f}%  {samples[:60]}")


# ─── SECTION 4: ENGINEER EXTRACTION TEST ──────────────────────────────────────
def test_engineer_extraction(all_data: list):
    print("\n" + "="*60)
    print("SECTION 4: ENGINEER NAME EXTRACTION")
    print("="*60)
    print("Testing ticket_name parsing to extract engineer names...\n")
    
    engineers = defaultdict(lambda: {"total": 0, "positive": 0, "neutral": 0, "negative": 0, "companies": set(), "ticket_names": set()})
    parse_failures = []
    
    for r in all_data:
        ticket_name = r.get("ticket_name", "")
        engineer = extract_engineer(ticket_name)
        month = extract_month(ticket_name)
        
        if engineer == ticket_name and ticket_name:
            # Parsing probably failed
            parse_failures.append(ticket_name)
        
        engineers[engineer]["total"] += 1
        rating = r.get("rating", "")
        if rating == "Positive":   engineers[engineer]["positive"] += 1
        elif rating == "Neutral":  engineers[engineer]["neutral"] += 1
        elif rating == "Negative": engineers[engineer]["negative"] += 1
        engineers[engineer]["companies"].add(r.get("company", ""))
        engineers[engineer]["ticket_names"].add(ticket_name[:60])
    
    print(f"Found {len(engineers)} unique engineers:\n")
    print(f"{'Engineer':<25} {'Total':>6} {'Pos':>5} {'Neu':>5} {'Neg':>5}  {'Clients'}")
    print("-"*75)
    for eng, stats in sorted(engineers.items(), key=lambda x: -x[1]["total"]):
        clients = ", ".join(list(stats["companies"])[:2])
        print(f"{eng:<25} {stats['total']:>6} {stats['positive']:>5} {stats['neutral']:>5} {stats['negative']:>5}  {clients}")
    
    if parse_failures:
        print(f"\n⚠️  {len(parse_failures)} ticket names failed to parse:")
        for f in parse_failures[:5]:
            print(f"   → '{f}'")
    else:
        print("\n✅ All ticket names parsed successfully")
    
    return engineers


# ─── SECTION 5: COMMENTS & NOTES ANALYSIS ─────────────────────────────────────
def analyze_comments_and_notes(all_data: list):
    print("\n" + "="*60)
    print("SECTION 5: COMMENTS & NOTES ANALYSIS")
    print("="*60)
    
    with_comments = [r for r in all_data if r.get("comment", "").strip()]
    with_notes    = [r for r in all_data if r.get("notes", "")]
    reviewed      = [r for r in all_data if r.get("is_reviewed")]
    unreviewed_concerns = [r for r in all_data if not r.get("is_reviewed") and r.get("rating") in ("Neutral", "Negative")]
    
    total = len(all_data)
    print(f"Total records:              {total}")
    print(f"Have comment text:          {len(with_comments)} ({len(with_comments)/total*100:.0f}%)")
    print(f"Have internal notes:        {len(with_notes)} ({len(with_notes)/total*100:.0f}%)")
    print(f"Marked as reviewed:         {len(reviewed)} ({len(reviewed)/total*100:.0f}%)")
    print(f"Unreviewed concerns (⚠️):   {len(unreviewed_concerns)}")
    
    if unreviewed_concerns:
        print(f"\n⚠️  UNREVIEWED NEUTRAL/NEGATIVE REVIEWS:")
        for r in unreviewed_concerns:
            engineer = extract_engineer(r.get("ticket_name", ""))
            print(f"   [{r['submitted_date'][:10]}] {r['rating']:8s} | {r['company']:20s} | Eng: {engineer}")
            if r.get("comment"):
                print(f"   Comment: \"{r['comment'][:100]}\"")
    
    if with_comments:
        print(f"\n📝 ALL COMMENTS (for NLP potential):")
        for r in with_comments:
            engineer = extract_engineer(r.get("ticket_name", ""))
            print(f"\n  [{r['submitted_date'][:10]}] {r['rating']} | {r['company']} | Eng: {engineer}")
            print(f"  Comment: \"{r['comment']}\"")
    
    if with_notes:
        print(f"\n📋 ALL INTERNAL NOTES (sensitive — admin only):")
        for r in with_notes:
            engineer = extract_engineer(r.get("ticket_name", ""))
            print(f"\n  [{r['submitted_date'][:10]}] {r['rating']} | Eng: {engineer}")
            print(f"  Notes: \"{r['notes'][:200]}\"")


# ─── SECTION 6: FILTER CAPABILITY TEST ────────────────────────────────────────
def test_filters(first_company: str):
    print("\n" + "="*60)
    print("SECTION 6: FILTER CAPABILITY TEST")
    print("="*60)
    
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    
    # Test is_reviewed filter
    print("\nTesting is_reviewed=true filter...")
    reviewed = fetch_csat({"from_submitted_date": start_date, "to_submitted_date": end_date, "is_reviewed": "true"})
    print(f"  is_reviewed=true  → {len(reviewed)} records")
    
    print("Testing is_reviewed=false filter...")
    unreviewed = fetch_csat({"from_submitted_date": start_date, "to_submitted_date": end_date, "is_reviewed": "false"})
    print(f"  is_reviewed=false → {len(unreviewed)} records")
    
    # Test company filter
    if first_company:
        print(f"\nTesting company filter with '{first_company}'...")
        co_data = fetch_csat({"from_submitted_date": start_date, "to_submitted_date": end_date, "company": first_company})
        print(f"  company='{first_company}' → {len(co_data)} records")
    
    # Test ticket_queue filter — discover unique queues first
    print("\nDiscovering unique ticket_queues...")
    all_data = fetch_csat({"from_submitted_date": start_date, "to_submitted_date": end_date})
    queues = set(r.get("ticket_queue", "") for r in all_data if r.get("ticket_queue"))
    print(f"  Unique queues found: {queues}")
    
    # Test date range granularity
    print("\nTesting narrow date range (last 7 days)...")
    week_start = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    week_data = fetch_csat({"from_submitted_date": week_start, "to_submitted_date": end_date})
    print(f"  Last 7 days → {len(week_data)} records")


# ─── SECTION 7: TAGS INVENTORY ────────────────────────────────────────────────
def analyze_tags(all_data: list):
    print("\n" + "="*60)
    print("SECTION 7: TAGS ANALYSIS")
    print("="*60)
    
    tag_stats = defaultdict(lambda: {"total": 0, "on_neutral": 0, "on_negative": 0})
    
    for r in all_data:
        for tag in r.get("tags", []):
            tag_stats[tag]["total"] += 1
            if r.get("rating") == "Neutral":  tag_stats[tag]["on_neutral"] += 1
            if r.get("rating") == "Negative": tag_stats[tag]["on_negative"] += 1
    
    print(f"\n{'Tag':<30} {'Total':>7} {'On Neutral':>12} {'On Negative':>13}")
    print("-"*65)
    for tag, stats in sorted(tag_stats.items(), key=lambda x: -x[1]["total"]):
        print(f"{tag:<30} {stats['total']:>7} {stats['on_neutral']:>12} {stats['on_negative']:>13}")
    
    if not tag_stats:
        print("  No tags found in this dataset.")


# ─── SECTION 8: SCORECARD API CHECK ───────────────────────────────────────────
def check_scorecard_api():
    print("\n" + "="*60)
    print("SECTION 8: SCORECARD API PROBE")
    print("="*60)
    print("Checking if Scorecard API is accessible (separate endpoint)...")
    
    scorecard_url = "https://api.team-gps.net/open-api/v1/scorecard/"
    try:
        r = requests.get(scorecard_url, headers=HEADERS, params={"page_size": 1}, timeout=10)
        print(f"  Status: {r.status_code}")
        if r.status_code == 200:
            print("  ✅ Scorecard API accessible")
            data = r.json()
            print(f"  Response keys: {list(data.keys())}")
        elif r.status_code == 403:
            print("  ❌ 403 Forbidden — Scorecard API not enabled or different key required")
        elif r.status_code == 404:
            print("  ❌ 404 — Scorecard endpoint may not exist or URL differs")
        else:
            print(f"  Response: {r.text[:200]}")
    except Exception as e:
        print(f"  Error: {e}")


# ─── MAIN ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════════════╗")
    print("║     Team GPS CSAT — Data Explorer & Diagnostic Tool     ║")
    print("║     Read-only | Generates exploration report            ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print(f"  Run at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Gate on connectivity
    if not check_connectivity():
        print("\n❌ Stopping — fix connectivity first.")
        exit(1)
    
    # Main data pull (90 days)
    print("\nFetching last 90 days of data for analysis...")
    end_date   = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    all_data   = fetch_csat({"from_submitted_date": start_date, "to_submitted_date": end_date})
    print(f"Total records fetched: {len(all_data)}")
    
    # Run all sections
    companies, _ = discover_companies()
    inventory_fields(all_data)
    engineers = test_engineer_extraction(all_data)
    analyze_comments_and_notes(all_data)
    test_filters(companies[0] if companies else None)
    analyze_tags(all_data)
    check_scorecard_api()
    
    # Save full raw dump
    output_file = f"teamgps_exploration_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(output_file, "w") as f:
        json.dump({
            "meta": {
                "run_at": datetime.now().isoformat(),
                "total_records": len(all_data),
                "date_range": f"{start_date} to {end_date}",
                "companies_found": companies,
                "engineers_found": list(engineers.keys()),
            },
            "raw_data": all_data
        }, f, indent=2)
    
    print(f"\n{'='*60}")
    print(f"✅ Exploration complete. Raw data saved to: {output_file}")
    print(f"{'='*60}")
    print("\nKey questions this run answers:")
    print("  1. Which companies (partners) exist in your data?")
    print("  2. Which fields are actually populated vs always empty?")
    print("  3. Does engineer name parsing work for your ticket_name format?")
    print("  4. How many comments/notes exist to work with?")
    print("  5. Which unreviewed concerns need attention?")
    print("  6. What filters does the API actually support?")
    print("  7. Is the Scorecard API also accessible?")