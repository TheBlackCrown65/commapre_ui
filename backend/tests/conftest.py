import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.main import app
from app.database import Base, get_db
from app.models import User
from app.core.security import create_access_token

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="session")
def db_engine():
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="function")
def db_session(db_engine):
    connection = db_engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()

@pytest.fixture(scope="function")
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()

@pytest.fixture(scope="function")
def admin_token(db_session):
    from app.core.security import decode_access_token
    from app.models import UserSession
    from datetime import datetime, timezone

    user = User(username="admin_test", hashed_password="hashed", role="ADMIN", is_active=True, status="ACTIVE", must_change_password=False)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    token = create_access_token(data={"sub": str(user.id), "role": user.role})
    payload = decode_access_token(token)
    jti = payload.get("jti", "-") if payload else "-"
    
    session_record = UserSession(
        user_id=user.id,
        jti=jti,
        status="ACTIVE",
        ip="127.0.0.1",
        user_agent="pytest",
        last_seen=datetime.now(timezone.utc).replace(tzinfo=None)
    )
    db_session.add(session_record)
    db_session.commit()
    
    return token
