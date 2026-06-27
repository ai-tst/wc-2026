import requests
import json

MATCH_ID = 1544371

MATCH_URL = f"https://api.sstats.net/games/{MATCH_ID}"

HEADERS = {
    "Accept": "application/json"
}


def log(title, data):
    print("\n" + "=" * 80)
    print(title)
    print("=" * 80)
    print(json.dumps(data, indent=2, ensure_ascii=False))


def get_match():
    res = requests.get(MATCH_URL, headers=HEADERS, timeout=20)
    res.raise_for_status()
    return res.json()["data"]["game"]


def get_team(team_id):
    url = f"https://api.sstats.net/teams/{team_id}"
    res = requests.get(url, headers=HEADERS, timeout=20)
    res.raise_for_status()
    return res.json()["data"]


def print_players(team_data, label):
    players = team_data.get("players", [])

    print("\n" + "=" * 80)
    print(label)
    print("=" * 80)

    if not players:
        print("Нет игроков")
        return

    for i, p in enumerate(players, 1):
        print(f"{i:2d}. {p.get('name', 'Unknown')}")


def main():
    match = get_match()

    home = match["homeTeam"]
    away = match["awayTeam"]

    home_id = home["id"]
    away_id = away["id"]

    print(f"\nМатч: {home['name']} vs {away['name']}\n")

    home_team = get_team(home_id)
    away_team = get_team(away_id)

    print_players(home_team, f"🏠 {home['name']} (HOME)")
    print_players(away_team, f"✈️ {away['name']} (AWAY)")


if __name__ == "__main__":
    main()