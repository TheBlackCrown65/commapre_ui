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

def test_detect_text_box(client, admin_token, db_session, tmp_path, monkeypatch):
    import cv2
    import numpy as np
    from app.models import Flow, Page

    # Create dummy image with text
    test_img = np.ones((600, 400, 3), dtype=np.uint8) * 255
    cv2.putText(test_img, "1,500.00", (100, 200), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)

    img_dir = tmp_path / "images"
    img_dir.mkdir()
    img_file = img_dir / "test_page.png"
    cv2.imwrite(str(img_file), test_img)

    from app.api import endpoints
    monkeypatch.setattr(endpoints, "OUTPUT_DIR", str(tmp_path))

    flow = Flow(name="Test Flow")
    db_session.add(flow)
    db_session.commit()

    page = Page(flow_id=flow.id, page_name="P1", image_path="images/test_page.png")
    db_session.add(page)
    db_session.commit()

    headers = {"Authorization": f"Bearer {admin_token}"}
    res = client.post(
        "/api/v1/masks/detect-text",
        json={"page_id": page.id, "x": 120, "y": 195},
        headers=headers
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["width"] > 20
    assert data["height"] > 10
    assert 50 <= data["x"] <= 120
    assert 150 <= data["y"] <= 205
