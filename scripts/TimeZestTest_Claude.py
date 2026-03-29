"""
TimeZest API Data Explorer
Read-only diagnostic script — maps everything available in the TimeZest API.
Run this before building the MCP server to understand your full data landscape.

Usage:
    pip install requests
    python explore_timezest.py
"""

import requests
import json
from datetime import datetime, timedelta
from collections import defaultdict
from urllib.parse import urlencode

# ─── CONFIG ───────────────────────────────────────────────────────────────────
API_KEY      = "IViu8ZqgFMgY74mAbqYjHnrg9ieUHf0g"
BASE_URL     = "https://api.timezest.com/v1"

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Accept":        "application/json",
}

# How many days back/forward to pull for the main exploration dataset
DAYS_BACK    = 14
DAYS_FORWARD = 30


# ─── CORE FETCH ───────────────────────────────────────────────────────────────
def fetch_paginated(path: str, params: dict = None) -> list:
    """
    GET {BASE_URL}/{path} and follow next_page links until exhausted.
    Returns the combined list from all pages' `data` arrays.
    """
    results = []
    url = f"{BASE_URL}/{path.lstrip('/')}"
    if params:
        url = f"{url}?{urlencode(params)}"

    while url:
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            r.raise_for_status()
            body = r.json()
            results.extend(body.get("data") or [])
            url = body.get("next_page") or None
        except requests.exceptions.HTTPError as e:
            print(f"  HTTP {e.response.status_code} — {e.response.text[:300]}")
            break
        except Exception as e:
            print(f"  Error: {e}")
            break

    return results


def get_single(path: str) -> dict | None:
    """GET a single resource. Returns parsed JSON body or None on failure."""
    url = f"{BASE_URL}/{path.lstrip('/')}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        return r.json()
    except requests.exceptions.HTTPError as e:
        print(f"  HTTP {e.response.status_code} — {e.response.text[:200]}")
        return None
    except Exception as e:
        print(f"  Error: {e}")
        return None


def probe_endpoint(path: str, description: str) -> bool:
    """Check whether an endpoint exists and is accessible. Returns True if 200."""
    url = f"{BASE_URL}/{path.lstrip('/')}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        if r.status_code == 200:
            print(f"  ✅ {description} ({path}) — 200 OK")
            body = r.json()
            keys = list(body.keys()) if isinstance(body, dict) else f"list[{len(body)}]"
            print(f"     Response keys: {keys}")
            if isinstance(body, dict) and "data" in body:
                print(f"     data length: {len(body['data'])}")
            return True
        else:
            print(f"  ❌ {description} ({path}) — {r.status_code}")
            return False
    except Exception as e:
        print(f"  ❌ {description} ({path}) — Error: {e}")
        return False


# ─── DATE HELPERS ─────────────────────────────────────────────────────────────
def today_str()  -> str: return datetime.now().strftime("%Y-%m-%d")
def date_str(d: datetime) -> str: return d.strftime("%Y-%m-%d")
def start_str()  -> str: return date_str(datetime.now() - timedelta(days=DAYS_BACK))
def end_str()    -> str: return date_str(datetime.now() + timedelta(days=DAYS_FORWARD))

def build_filter(start: str, end: str) -> str:
    """Build the filter string used by the scheduling_requests endpoint."""
    return (
        f"scheduling_request.created_at~GTE~{start}"
        f"~AND~scheduling_request.created_at~LT~{end}"
    )


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — CONNECTIVITY CHECK
# ═══════════════════════════════════════════════════════════════════════════════
def check_connectivity() -> bool:
    print("\n" + "="*65)
    print("SECTION 1: API CONNECTIVITY CHECK")
    print("="*65)

    url = f"{BASE_URL}/scheduling_requests"
    params = {
        "filter": build_filter(today_str(), today_str()),
        "page_size": 1
    }
    try:
        r = requests.get(url, headers=HEADERS, params=params, timeout=15)
        print(f"  Status:          {r.status_code}")
        print(f"  Content-Type:    {r.headers.get('Content-Type', '?')}")

        if r.status_code == 200:
            body = r.json()
            print(f"  Response keys:   {list(body.keys())}")
            data = body.get("data", [])
            print(f"  Records on page: {len(data)}")
            if data:
                print(f"  Sample ID:       {data[0].get('id')}")
                print(f"  Sample status:   {data[0].get('status')}")
            print("\n  ✅ Connected to TimeZest API successfully")
            return True
        elif r.status_code == 401:
            print("\n  ❌ 401 Unauthorized — check your API key")
        elif r.status_code == 403:
            print("\n  ❌ 403 Forbidden — API key valid but insufficient permissions")
        else:
            print(f"\n  ❌ Unexpected status: {r.status_code}")
            print(f"  Body: {r.text[:300]}")
        return False
    except Exception as e:
        print(f"\n  ❌ Exception: {e}")
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — ENDPOINT DISCOVERY
# ═══════════════════════════════════════════════════════════════════════════════
def discover_endpoints():
    print("\n" + "="*65)
    print("SECTION 2: ENDPOINT DISCOVERY")
    print("="*65)
    print("Probing known and likely TimeZest API endpoints...\n")

    # Confirmed endpoints (from Firebase function code)
    probe_endpoint("scheduling_requests", "Scheduling Requests (confirmed)")
    probe_endpoint("appointment_types",   "Appointment Types (confirmed)")

    # Likely additional endpoints — probe speculatively
    print()
    probe_endpoint("appointments",         "Appointments (alternative name?)")
    probe_endpoint("users",                "Users / Agents")
    probe_endpoint("agents",               "Agents (alternative name?)")
    probe_endpoint("resources",            "Resources")
    probe_endpoint("schedules",            "Schedules")
    probe_endpoint("availability",         "Availability")
    probe_endpoint("webhooks",             "Webhooks")
    probe_endpoint("calendars",            "Calendars")


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — APPOINTMENT TYPES INVENTORY
# ═══════════════════════════════════════════════════════════════════════════════
def inventory_appointment_types() -> dict:
    print("\n" + "="*65)
    print("SECTION 3: APPOINTMENT TYPES")
    print("="*65)

    types = fetch_paginated("appointment_types")
    print(f"\n  Total appointment types found: {len(types)}\n")

    type_map = {}
    if types:
        # Print all fields from first record to understand the schema
        first = types[0]
        print("  Schema (fields on first record):")
        for k, v in first.items():
            print(f"    {k:<30} = {str(v)[:60]}")

        print(f"\n  {'ID':<10} {'Internal Name':<35} {'External Name':<35} {'Duration'}")
        print("  " + "-"*90)
        for t in types:
            tid  = str(t.get("id", ""))
            inam = str(t.get("internal_name", ""))[:34]
            enam = str(t.get("external_name", ""))[:34]
            dur  = str(t.get("duration_mins") or t.get("duration") or "?")
            print(f"  {tid:<10} {inam:<35} {enam:<35} {dur}")
            type_map[t["id"]] = t.get("external_name") or t.get("internal_name") or "?"

    return type_map


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — SCHEDULING REQUESTS: FIELD INVENTORY
# ═══════════════════════════════════════════════════════════════════════════════
def inventory_request_fields(requests_data: list):
    print("\n" + "="*65)
    print("SECTION 4: SCHEDULING REQUEST — FIELD INVENTORY")
    print("="*65)
    print("Checking which fields are populated vs always null/empty...\n")

    if not requests_data:
        print("  ⚠️  No data to analyse.")
        return

    field_stats = defaultdict(lambda: {"populated": 0, "empty": 0, "sample_values": []})

    def flatten(record: dict, prefix=""):
        """Walk one level into nested objects to expose sub-fields."""
        for k, v in record.items():
            key = f"{prefix}{k}"
            if isinstance(v, dict):
                flatten(v, prefix=f"{key}.")
            elif isinstance(v, list):
                is_empty = len(v) == 0
                if is_empty:
                    field_stats[key]["empty"] += 1
                else:
                    field_stats[key]["populated"] += 1
                    if len(field_stats[key]["sample_values"]) < 3:
                        field_stats[key]["sample_values"].append(str(v[0])[:60])
            else:
                is_empty = v is None or v == ""
                if is_empty:
                    field_stats[key]["empty"] += 1
                else:
                    field_stats[key]["populated"] += 1
                    if len(field_stats[key]["sample_values"]) < 3:
                        field_stats[key]["sample_values"].append(str(v)[:60])

    for rec in requests_data:
        flatten(rec)

    total = len(requests_data)
    print(f"  {'Field':<40} {'Populated':>10} {'Empty':>7} {'Fill%':>7}  Sample")
    print("  " + "-"*100)
    for field, stats in sorted(field_stats.items()):
        pop  = stats["populated"]
        pct  = (pop / total * 100) if total > 0 else 0
        flag = "✅ " if pct > 80 else ("🔶 " if pct > 20 else "⚠️  ")
        sample = (stats["sample_values"][0] if stats["sample_values"] else "")[:55]
        print(f"  {flag}{field:<38} {pop:>10} {total-pop:>7} {pct:>6.0f}%  {sample}")


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 5 — STATUS ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════
def analyse_statuses(requests_data: list):
    print("\n" + "="*65)
    print("SECTION 5: STATUS ANALYSIS")
    print("="*65)

    status_counts = defaultdict(int)
    for r in requests_data:
        status_counts[r.get("status", "unknown")] += 1

    print(f"\n  Found {len(status_counts)} distinct status values:\n")
    print(f"  {'Status':<25} {'Count':>8}")
    print("  " + "-"*35)
    for status, count in sorted(status_counts.items(), key=lambda x: -x[1]):
        print(f"  {status:<25} {count:>8}")

    print("\n  ℹ️  MCP relevance:")
    print("    scheduled → confirmed appointments (primary query target)")
    print("    sent      → invitation sent but client hasn't booked yet (follow-up candidates)")
    print("    cancelled → excluded from active views; useful for cancellation tracking")
    print("    Other statuses discovered above should inform tool filter options.")

    return list(status_counts.keys())


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 6 — ENGINEER ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════
def analyse_engineers(requests_data: list, type_map: dict) -> list:
    print("\n" + "="*65)
    print("SECTION 6: ENGINEER ANALYSIS")
    print("="*65)

    engineer_stats = defaultdict(lambda: {
        "total": 0, "scheduled": 0, "sent": 0, "cancelled": 0, "other": 0,
        "emails": set(), "from_scheduled_agents": 0, "from_resources": 0
    })

    for r in requests_data:
        name  = "Unassigned"
        email = ""
        source = "none"

        if r.get("scheduled_agents"):
            ag = r["scheduled_agents"][0]
            name   = ag.get("name", "Unassigned")
            email  = ag.get("email", "")
            source = "scheduled_agents"
        elif r.get("resources"):
            res = r["resources"][0]
            name   = res.get("name", "Unassigned")
            source = "resources"

        stats = engineer_stats[name]
        stats["total"] += 1
        status = r.get("status", "other")
        if status in stats:
            stats[status] += 1
        else:
            stats["other"] += 1
        if email:
            stats["emails"].add(email)
        if source == "scheduled_agents":
            stats["from_scheduled_agents"] += 1
        elif source == "resources":
            stats["from_resources"] += 1

    print(f"\n  Found {len(engineer_stats)} engineers/resources:\n")
    print(f"  {'Engineer':<25} {'Total':>6} {'Sched':>6} {'Sent':>6} {'Canc':>6}  Email / Source")
    print("  " + "-"*80)
    for name, s in sorted(engineer_stats.items(), key=lambda x: -x[1]["total"]):
        email_str = list(s["emails"])[0] if s["emails"] else "—"
        src_note  = f"sa:{s['from_scheduled_agents']}/res:{s['from_resources']}"
        print(f"  {name:<25} {s['total']:>6} {s['scheduled']:>6} {s['sent']:>6} {s['cancelled']:>6}  {email_str} ({src_note})")

    print("\n  ℹ️  'sa' = from scheduled_agents field | 'res' = from resources field")
    print("  ℹ️  The MCP server should prefer scheduled_agents[0] with resources as fallback.")

    return list(engineer_stats.keys())


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 7 — ASSOCIATED ENTITIES ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════
def analyse_associated_entities(requests_data: list):
    print("\n" + "="*65)
    print("SECTION 7: ASSOCIATED ENTITIES (Ticket Links)")
    print("="*65)

    no_entities  = 0
    has_number   = 0
    entity_types = defaultdict(int)
    sample_entities = []

    for r in requests_data:
        ents = r.get("associated_entities") or []
        if not ents:
            no_entities += 1
            continue
        for ent in ents:
            if ent.get("number"):
                has_number += 1
            if ent.get("type"):
                entity_types[ent.get("type")] += 1
            if len(sample_entities) < 5:
                sample_entities.append(ent)

    total = len(requests_data)
    print(f"\n  Total requests:                {total}")
    print(f"  With no associated entities:   {no_entities} ({no_entities/total*100:.0f}%)")
    print(f"  With a ticket number:          {has_number} ({has_number/total*100:.0f}%)")

    if entity_types:
        print(f"\n  Entity types found:")
        for t, count in sorted(entity_types.items(), key=lambda x: -x[1]):
            print(f"    {t:<30} {count}")

    if sample_entities:
        print(f"\n  Sample entity objects (up to 5):")
        for ent in sample_entities:
            print(f"    {json.dumps(ent)}")

    print("\n  ℹ️  The ticket number from associated_entities links back to ConnectWise.")
    print("  ℹ️  MCP tool `get_appointments_by_ticket` would use this field to look up a CW ticket.")


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 8 — DATE / TIME FIELD ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════
def analyse_timestamps(requests_data: list):
    print("\n" + "="*65)
    print("SECTION 8: DATE & TIME FIELD ANALYSIS")
    print("="*65)

    fields = ["selected_start_time", "created_at", "updated_at", "expires_at"]
    print(f"  Checking {len(fields)} time fields for format and population...\n")

    for field in fields:
        vals = [r.get(field) for r in requests_data if r.get(field) is not None]
        if not vals:
            print(f"  {field:<25} — not found / always null")
            continue

        # Determine type
        sample = vals[0]
        if isinstance(sample, (int, float)):
            fmt = "Unix timestamp (seconds)" if sample < 2e10 else "Unix timestamp (ms)"
            sample_parsed = datetime.fromtimestamp(sample).isoformat() if sample < 2e10 else datetime.fromtimestamp(sample/1000).isoformat()
        else:
            fmt = "ISO string"
            sample_parsed = sample

        print(f"  {field:<25}  {len(vals)}/{len(requests_data)} populated")
        print(f"    Format:  {fmt}")
        print(f"    Sample:  {sample} → {sample_parsed}")

    print("\n  ℹ️  The MCP server should normalise all timestamps to ISO 8601 strings in UTC.")
    print("  ℹ️  The dashboard filters by CST (America/Chicago) — MCP tools should accept")
    print("      a timezone parameter so callers can localise appropriately.")


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 9 — FILTER CAPABILITY TEST
# ═══════════════════════════════════════════════════════════════════════════════
def test_filters(known_statuses: list):
    print("\n" + "="*65)
    print("SECTION 9: FILTER CAPABILITY TEST")
    print("="*65)
    print("Testing which filter parameters the API actually supports...\n")

    base_params = {"filter": build_filter(start_str(), end_str())}

    # Test 1: date range (wide)
    results = fetch_paginated("scheduling_requests", base_params)
    print(f"  [1] Date range ({start_str()} → {end_str()}):  {len(results)} records ✅")

    # Test 2: today only
    today_filter = build_filter(today_str(), today_str())
    today_results = fetch_paginated("scheduling_requests", {"filter": today_filter})
    print(f"  [2] Today only ({today_str()}):                 {len(today_results)} records")

    # Test 3: future only
    tomorrow = date_str(datetime.now() + timedelta(days=1))
    fut_filter = build_filter(tomorrow, end_str())
    fut_results = fetch_paginated("scheduling_requests", {"filter": fut_filter})
    print(f"  [3] Future only ({tomorrow} → {end_str()}):    {len(fut_results)} records")

    # Test 4: status filter — try appending to existing filter
    for status in known_statuses[:3]:  # only test first 3 to avoid too many calls
        try:
            status_filter = f"{build_filter(start_str(), end_str())}~AND~scheduling_request.status~EQ~{status}"
            status_results = fetch_paginated("scheduling_requests", {"filter": status_filter})
            print(f"  [4] Status filter (status={status}): {len(status_results)} records")
        except Exception as e:
            print(f"  [4] Status filter (status={status}): FAILED — {e}")
            print(f"       → May need to use ~EQ~ vs =; check API docs for operator list")

    # Test 5: sort parameter
    try:
        sorted_results = fetch_paginated("scheduling_requests", {
            **base_params,
            "sort": "selected_start_time",
            "direction": "asc"
        })
        print(f"  [5] Sort by selected_start_time asc: {len(sorted_results)} records ✅")
    except Exception:
        print("  [5] Sort parameter: may not be supported — check raw response above")

    # Test 6: page_size
    try:
        paged = fetch_paginated("scheduling_requests", {**base_params, "per_page": 5})
        print(f"  [6] Pagination (per_page=5): {len(paged)} total records across multiple pages")
    except Exception:
        pass

    # Discover filter operators from any 400 error body
    print("\n  ℹ️  Filter syntax used: field~OPERATOR~value~AND~field~OPERATOR~value")
    print("  ℹ️  Observed operators from code: GTE, LT — probe for EQ, GT, LTE, LIKE")


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 10 — SINGLE RECORD DEEP DIVE
# ═══════════════════════════════════════════════════════════════════════════════
def deep_dive_single_record(requests_data: list):
    print("\n" + "="*65)
    print("SECTION 10: SINGLE RECORD DEEP DIVE")
    print("="*65)
    print("Fetching the first scheduling request by ID to see full raw schema...\n")

    if not requests_data:
        print("  No records available.")
        return

    # Try the first scheduled record for a richer record
    target = next((r for r in requests_data if r.get("status") == "scheduled"), requests_data[0])
    record_id = target.get("id")
    print(f"  Record ID: {record_id}")

    single = get_single(f"scheduling_requests/{record_id}")
    if single:
        print(f"\n  Full raw record:\n")
        print(json.dumps(single, indent=4))
    else:
        print("  ⚠️  Could not fetch individual record — endpoint may not support GET by ID.")
        print("  ℹ️  Falling back to full record from the list response:\n")
        print(json.dumps(target, indent=4))


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 11 — MCP TOOL DESIGN RECOMMENDATIONS
# ═══════════════════════════════════════════════════════════════════════════════
def print_tool_recommendations(engineers: list, statuses: list, type_map: dict):
    print("\n" + "="*65)
    print("SECTION 11: MCP TOOL DESIGN RECOMMENDATIONS")
    print("="*65)

    tools = [
        {
            "name": "get_todays_appointments",
            "description": "Get all appointments for today, grouped by engineer. The most common daily-standup query.",
            "params": "timezone? (default: America/Chicago)",
            "api_call": "GET /scheduling_requests?filter=selected_start_time range for today",
            "note": "Filter client-side by selected_start_time in target timezone."
        },
        {
            "name": "list_appointments",
            "description": "Get appointments for a flexible date range, with optional engineer and status filters.",
            "params": "start_date, end_date, engineer_name?, status?, timezone?",
            "api_call": "GET /scheduling_requests?filter=created_at range + optional status",
            "note": "Filter by engineer client-side (API filter may not support agent name directly)."
        },
        {
            "name": "get_engineer_schedule",
            "description": "Get all upcoming appointments assigned to a specific engineer.",
            "params": "engineer_name, days_ahead? (default: 7)",
            "api_call": "GET /scheduling_requests + client-side filter by scheduled_agents[0].name",
            "note": "Use fuzzy match on engineer name (first name only is common e.g. 'Aaron')."
        },
        {
            "name": "list_pending_requests",
            "description": "Get all scheduling requests in 'sent' status — invitations sent but not yet booked. Useful for follow-up.",
            "params": "days? (default: 14)",
            "api_call": "GET /scheduling_requests?filter=status~EQ~sent (or client filter)",
            "note": "Returns ticket number, end user name/email, scheduling URL for follow-up context."
        },
        {
            "name": "get_appointment_types",
            "description": "List all appointment type definitions — names, durations, IDs.",
            "params": "None",
            "api_call": "GET /appointment_types",
            "note": "Cache this per session; types rarely change."
        },
        {
            "name": "find_appointment_by_ticket",
            "description": "Given a ConnectWise ticket number, return all TimeZest scheduling requests linked to it.",
            "params": "ticket_number",
            "api_call": "GET /scheduling_requests (full scan) + filter by associated_entities[].number",
            "note": "No direct API filter observed — fetch wide range and match client-side."
        },
        {
            "name": "get_appointment_stats",
            "description": "Return a summary dashboard: counts by status, by engineer, appointments today/this week.",
            "params": "days? (default: 14)",
            "api_call": "GET /scheduling_requests + aggregate client-side",
            "note": "Pure aggregation — no extra API calls. Good for a 'morning briefing' prompt."
        },
        {
            "name": "list_cancelled_appointments",
            "description": "Get recently cancelled appointments, useful for rebooking workflows.",
            "params": "days_back? (default: 7)",
            "api_call": "GET /scheduling_requests + filter by status=cancelled",
            "note": "Include end_user_email and scheduling_url so rebooking link can be resent."
        },
    ]

    for i, t in enumerate(tools, 1):
        print(f"\n  [{i}] {t['name']}")
        print(f"       {t['description']}")
        print(f"       Params:   {t['params']}")
        print(f"       API call: {t['api_call']}")
        print(f"       Note:     {t['note']}")

    print(f"\n  Engineers discovered ({len(engineers)}):  {engineers}")
    print(f"  Statuses discovered  ({len(statuses)}):   {statuses}")
    print(f"  Appointment types    ({len(type_map)}):   {list(type_map.values())}")


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║     TimeZest API — Data Explorer & Diagnostic Tool          ║")
    print("║     Read-only | Generates exploration report                ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    print(f"  Run at:      {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Base URL:    {BASE_URL}")
    print(f"  Date window: {start_str()} → {end_str()}  ({DAYS_BACK}d back, {DAYS_FORWARD}d forward)")

    # Gate on connectivity
    if not check_connectivity():
        print("\n❌ Stopping — fix connectivity before continuing.")
        exit(1)

    # Discover what endpoints exist
    discover_endpoints()

    # Pull appointment types first (small call, used to enrich later)
    type_map = inventory_appointment_types()

    # Pull the main dataset for the exploration window
    print(f"\n\nFetching scheduling requests ({start_str()} → {end_str()})...")
    main_filter = build_filter(start_str(), end_str())
    all_requests = fetch_paginated("scheduling_requests", {"filter": main_filter})
    print(f"Total records fetched: {len(all_requests)}")

    if not all_requests:
        print("\n⚠️  No scheduling requests in the window. Try widening DAYS_BACK / DAYS_FORWARD.")
    else:
        # Run all analysis sections
        inventory_request_fields(all_requests)
        statuses  = analyse_statuses(all_requests)
        engineers = analyse_engineers(all_requests, type_map)
        analyse_associated_entities(all_requests)
        analyse_timestamps(all_requests)
        test_filters(statuses)
        deep_dive_single_record(all_requests)

    # Always print tool recommendations (even if data is sparse)
    print_tool_recommendations(
        engineers  = engineers if all_requests else [],
        statuses   = statuses  if all_requests else [],
        type_map   = type_map
    )

    # Save raw dump
    output_file = f"timezest_exploration_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(output_file, "w") as f:
        json.dump({
            "meta": {
                "run_at":         datetime.now().isoformat(),
                "base_url":       BASE_URL,
                "date_range":     f"{start_str()} to {end_str()}",
                "total_records":  len(all_requests),
                "appointment_types": type_map,
                "statuses_found": statuses   if all_requests else [],
                "engineers_found": engineers if all_requests else [],
            },
            "appointment_types": type_map,
            "raw_scheduling_requests": all_requests,
        }, f, indent=2, default=str)

    print(f"\n{'='*65}")
    print(f"✅ Exploration complete. Raw data saved to: {output_file}")
    print(f"{'='*65}")
    print("\nKey questions this run answers:")
    print("  1.  Can we authenticate? Which HTTP status codes do we get?")
    print("  2.  What other endpoints exist beyond scheduling_requests + appointment_types?")
    print("  3.  Which fields on scheduling_requests are actually populated?")
    print("  4.  What status values exist and what are their counts?")
    print("  5.  Which engineers appear, and do they come from scheduled_agents or resources?")
    print("  6.  How are ConnectWise ticket numbers linked (associated_entities structure)?")
    print("  7.  What timestamp formats does the API use?")
    print("  8.  What filter syntax / operators does the API support?")
    print("  9.  Can we fetch a single record by ID?")
    print("  10. What are the 8 recommended MCP tools and their exact API calls?")