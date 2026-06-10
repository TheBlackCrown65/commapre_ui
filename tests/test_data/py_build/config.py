"""
Shared configuration and helper functions for all build scripts.
"""
import sys

BASE_URL = "http://localhost"

# Check sys.argv backwards to safely check and remove host argument
for i in range(len(sys.argv) - 1, 0, -1):
    arg = sys.argv[i]
    if arg.startswith("--") and not arg.startswith("--flows"):
        val = arg[2:]
        if val == "localhost":
            BASE_URL = "http://localhost"
        elif val.startswith("http://") or val.startswith("https://"):
            BASE_URL = val
        else:
            BASE_URL = f"http://{val}"
        
        # Remove it from sys.argv so argparse in other scripts doesn't complain
        sys.argv.pop(i)
        break

# API_KEY = "rv_AN84Vv2LcQa1byuQGTk65Da5SpUVUXMe3WD20QPy9F0"
API_KEY = "rv_ArB1zeY0e7qsefwYbD5oY92HEDzp26CXQfrfAnSI0qQ"  #port 9000


# Naming pattern
DEPT_COUNT = 50

def auth_headers(content_json=False):
    headers = {"Authorization": f"Bearer {API_KEY}"}
    if content_json:
        headers["Content-Type"] = "application/json"
    return headers

def dept_name(n):
    return f"{n}A"

def squad_name(n):
    return f"{n}T"

def flow_name(n):
    return f"{n}F"

