"""HaveIBeenPwned and breach database queries."""

import json
import urllib.request
import urllib.parse
from typing import Any


def lookup_email(email: str = "", api_key: str = "", **kwargs: Any) -> dict:
    """Check if an email appears in known data breaches via HIBP API."""
    if not email:
        return {"error": "email is required"}

    if not api_key:
        return {
            "error": "HIBP API key required",
            "note": "Get a key at https://haveibeenpwned.com/API/Key",
        }

    headers = {
        "hibp-api-key": api_key,
        "User-Agent": "AgentV0-OSINT/0.1",
    }

    try:
        encoded_email = urllib.parse.quote(email)
        url = f"https://haveibeenpwned.com/api/v3/breachedaccount/{encoded_email}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as response:
            breaches = json.loads(response.read().decode())

        return {
            "email": email,
            "breached": True,
            "breach_count": len(breaches),
            "breaches": [
                {
                    "name": b.get("Name"),
                    "domain": b.get("Domain"),
                    "breach_date": b.get("BreachDate"),
                    "data_classes": b.get("DataClasses", []),
                    "is_verified": b.get("IsVerified"),
                }
                for b in breaches
            ],
        }

    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"email": email, "breached": False, "breach_count": 0, "breaches": []}
        return {"error": f"HIBP API error: {e.code} {e.reason}"}
    except Exception as e:
        return {"error": str(e)}


def lookup_domain(domain: str = "", api_key: str = "", **kwargs: Any) -> dict:
    """Search for breaches associated with a domain."""
    if not domain:
        return {"error": "domain is required"}

    # HIBP doesn't have a direct domain search; this would use a search API
    return {
        "domain": domain,
        "note": "Domain breach search requires enterprise HIBP subscription or alternative source",
        "alternatives": ["dehashed.com", "leakcheck.io", "intelx.io"],
    }
