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

def test_update_folder(client, admin_token, db_session):
    from app.models import Department, Squad, FlowFolder
    
    # Setup test data
    dept = Department(name="Test Dept")
    db_session.add(dept)
    db_session.commit()
    
    squad = Squad(name="Test Squad", department_id=dept.id)
    db_session.add(squad)
    db_session.commit()
    
    folder1 = FlowFolder(name="Folder 1", squad_id=squad.id)
    folder2 = FlowFolder(name="Folder 2", squad_id=squad.id)
    db_session.add(folder1)
    db_session.add(folder2)
    db_session.commit()
    
    headers = {"Authorization": f"Bearer {admin_token}"}
    
    # 1. Update Name
    res = client.put(f"/api/v1/folders/{folder1.id}", json={"name": "Folder 1 Updated"}, headers=headers)
    assert res.status_code == 200
    db_session.refresh(folder1)
    assert folder1.name == "Folder 1 Updated"
    
    # 2. Move folder1 into folder2
    res = client.put(f"/api/v1/folders/{folder1.id}", json={"parent_id": folder2.id}, headers=headers)
    assert res.status_code == 200
    db_session.refresh(folder1)
    assert folder1.parent_id == folder2.id
    
    # 3. Circular Dependency check: try moving folder2 into folder1 (folder1 is child of folder2)
    res = client.put(f"/api/v1/folders/{folder2.id}", json={"parent_id": folder1.id}, headers=headers)
    assert res.status_code == 400
    assert "Cannot move folder into its own subfolder" in res.text
    
    # 4. Move folder1 to root
    res = client.put(f"/api/v1/folders/{folder1.id}", json={"move_to_root": True}, headers=headers)
    assert res.status_code == 200
    db_session.refresh(folder1)
    assert folder1.parent_id is None
