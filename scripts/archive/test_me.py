import requests
try:
    res = requests.post("http://localhost:8000/api/v1/auth/login", json={"username": "admin", "password": "password"}) # default pass might be different
    print("Login:", res.status_code)
    if res.status_code == 200:
        token = res.json()["access_token"]
        res = requests.get("http://localhost:8000/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        print("Me:", res.json())
except Exception as e:
    print(e)
