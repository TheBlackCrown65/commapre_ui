import pytest

def test_read_departments(client):
    response = client.get("/api/v1/org/public/departments")
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_login_invalid_credentials(client):
    response = client.post("/api/v1/auth/login", json={"username": "wrong", "password": "wrong"})
    assert response.status_code in [401, 429]

def test_get_monitor_stats_unauthorized(client):
    response = client.get("/api/v1/monitor/stats")
    assert response.status_code == 401

def test_get_monitor_stats_authorized(client, admin_token):
    response = client.get(
        "/api/v1/monitor/stats",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert response.status_code == 200
    assert "cpu_percent" in response.json()
