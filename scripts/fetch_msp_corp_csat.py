import requests
import json
from datetime import datetime

# Configuration
API_KEY = "7aj8XQ7dBObd92GUrXGrb37HA8OY7jewOeFo.R7j1MFxyNscgAtYsoIQI8nY9gVCmUNZfR1wo9yVfrsI5ftqVI7hNm0eHJT0VO6fhAnClnZV3Nfl30lqgyxw"
BASE_URL = "https://api.team-gps.net/open-api/v1/csat/"
CLIENT_NAME = "MSP Corp"
# Last Month: February 2026
START_DATE = "2026-02-01"
END_DATE = "2026-02-28"

headers = {
    "x-api-key": API_KEY,
    "Accept": "application/json"
}

def fetch_csat_data():
    print(f"--- Aggregating CSAT Data for {CLIENT_NAME} (Feb 2026) ---")
    results = []
    page = 1
    
    while True:
        params = {
            "from_submitted_date": START_DATE,
            "to_submitted_date": END_DATE,
            "company": CLIENT_NAME,
            "page": page,
            "page_size": 100
        }
        
        try:
            response = requests.get(BASE_URL, headers=headers, params=params)
            response.raise_for_status()
            data = response.json()
            
            page_results = data.get("data", {}).get("results", [])
            if not page_results:
                break
                
            results.extend(page_results)
            
            total_pages = data.get("data", {}).get("total_pages", 1)
            if page >= total_pages:
                break
            page += 1
            
        except Exception as e:
            print(f"Error fetching data: {e}")
            break
            
    return results

def process_and_display(data):
    if not data:
        print(f"No CSAT records found for '{CLIENT_NAME}' in February 2026.")
        return

    total = len(data)
    positive = len([d for d in data if d['rating'] == 'Positive'])
    neutral = len([d for d in data if d['rating'] == 'Neutral'])
    negative = len([d for d in data if d['rating'] == 'Negative'])
    
    score = (positive / total) * 100 if total > 0 else 0

    print(f"\n[ SUMMARY ]")
    print(f"Total Responses: {total}")
    print(f"CSAT Score:      {score:.1f}%")
    print(f"Positive:        {positive}")
    print(f"Neutral:         {neutral}")
    print(f"Negative:        {negative}")
    
    print(f"\n[ QUALITATIVE FEEDBACK ]")
    has_comments = False
    for entry in data:
        if entry.get('comment'):
            has_comments = True
            date_str = entry['submitted_date'].split('T')[0]
            print(f"- [{date_str}] {entry['rating']}: \"{entry['comment']}\" (Tech: {entry['team_members'][0]['identifier'] if entry['team_members'] else 'N/A'})")
    
    if not has_comments:
        print("No qualitative comments found for this period.")

if __name__ == "__main__":
    csat_data = fetch_csat_data()
    process_and_display(csat_data)
    
    # Save a local copy of the raw filtered data
    filename = f"MSP_Corp_CSAT_Feb_2026.json"
    with open(filename, "w") as f:
        json.dump(csat_data, f, indent=4)
    print(f"\nRaw data saved to: {filename}")
