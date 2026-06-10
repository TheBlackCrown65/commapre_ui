"""
Seed Script — Initial Data + Migrations
==========================================
รันอัตโนมัติตอน app startup
"""
from sqlalchemy.orm import Session
from sqlalchemy import text
from .models import User, Department, Squad, FlowFolder, SystemConfig
from .core.security import hash_password
from .database import SessionLocal


def ensure_cascade_fks():
    """Fix FK constraints to include ON DELETE CASCADE"""
    db = SessionLocal()
    try:
        # List of (table, constraint_name, column, ref_table) to fix
        fks_to_fix = [
            ("masks", "masks_flow_id_fkey", "flow_id", "flows(id)"),
            ("masks", "masks_page_id_fkey", "page_id", "pages(id)"),
            ("jobs", "jobs_flow_id_fkey", "flow_id", "flows(id)"),
            ("pages", "pages_flow_id_fkey", "flow_id", "flows(id)"),
        ]
        for table, constraint, column, ref in fks_to_fix:
            try:
                db.execute(text(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {constraint}"))
                db.execute(text(f"ALTER TABLE {table} ADD CONSTRAINT {constraint} FOREIGN KEY ({column}) REFERENCES {ref} ON DELETE CASCADE"))
            except Exception:
                pass
        db.commit()
    except Exception as e:
        print(f"FK fix warning: {e}")
        db.rollback()
    finally:
        db.close()


def seed_admin_user():
    """สร้าง admin user ถ้ายังไม่มี"""
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == "admin").first()
        if existing:
            return

        from .core.config import settings
        admin_password = settings.ADMIN_DEFAULT_PASSWORD

        admin = User(
            username="admin",
            hashed_password=hash_password(admin_password),
            role="ADMIN",
            must_change_password=True,
            is_active=1
        )
        db.add(admin)
        db.commit()
        print(f"🔐 Created default admin user (username: admin)")
        print("⚠️  IMPORTANT: Change the admin password immediately!")
    except Exception as e:
        print(f"Seed error (admin): {e}")
        db.rollback()
    finally:
        db.close()


def seed_default_org():
    """สร้าง Default Department + Default Squad ถ้ายังไม่มี"""
    db = SessionLocal()
    try:
        # Ensure squad_id column exists on flow_folders (create_all ไม่ alter existing tables)
        from sqlalchemy import text, inspect
        inspector = inspect(db.bind)
        columns = [c['name'] for c in inspector.get_columns('flow_folders')]
        if 'squad_id' not in columns:
            db.execute(text("ALTER TABLE flow_folders ADD COLUMN squad_id INTEGER REFERENCES squads(id)"))
            db.commit()
            print("📐 Added squad_id column to flow_folders")

        # Ensure max_images_per_flow column exists on departments
        dept_columns = [c['name'] for c in inspector.get_columns('departments')]
        if 'max_images_per_flow' not in dept_columns:
            db.execute(text("ALTER TABLE departments ADD COLUMN max_images_per_flow INTEGER"))
            db.commit()
            print("📸 Added max_images_per_flow column to departments")
            
        if 'storage_limit_gb' in dept_columns:
            try:
                db.execute(text("ALTER TABLE departments DROP COLUMN storage_limit_gb"))
                db.commit()
                print("🗑️ Dropped storage_limit_gb column from departments")
            except Exception:
                db.rollback()

        # Ensure note column exists on flows
        flow_columns = [c['name'] for c in inspector.get_columns('flows')]
        if 'note' not in flow_columns:
            db.execute(text("ALTER TABLE flows ADD COLUMN note TEXT"))
            db.commit()
            print("📝 Added note column to flows")

        # Ensure squad_id column exists on flows (for root flows without folder)
        if 'squad_id' not in flow_columns:
            db.execute(text("ALTER TABLE flows ADD COLUMN squad_id INTEGER REFERENCES squads(id)"))
            db.commit()
            print("📐 Added squad_id column to flows")

        # Ensure department_id, squad_id, position columns exist on users
        user_columns = [c['name'] for c in inspector.get_columns('users')]
        if 'department_id' not in user_columns:
            db.execute(text("ALTER TABLE users ADD COLUMN department_id INTEGER REFERENCES departments(id)"))
            db.commit()
            print("🏢 Added department_id column to users")
        if 'squad_id' not in user_columns:
            db.execute(text("ALTER TABLE users ADD COLUMN squad_id INTEGER REFERENCES squads(id)"))
            db.commit()
            print("👥 Added squad_id column to users")
        if 'position' not in user_columns:
            db.execute(text("ALTER TABLE users ADD COLUMN position VARCHAR"))
            db.commit()
            print("💼 Added position column to users")

        existing_dept = db.query(Department).first()
        if not existing_dept:
            dept = Department(name="Default Department", description="Auto-created department")
            db.add(dept)
            db.flush()

            squad = Squad(name="Default Squad", department_id=dept.id, description="Auto-created squad")
            db.add(squad)
            db.flush()
            db.commit()
            print(f"🏢 Created Default Department + Default Squad")
            existing_dept = dept

        # Always fix orphan folders (squad_id = NULL) → assign to first squad
        first_squad = db.query(Squad).first()
        if first_squad:
            orphan_folders = db.query(FlowFolder).filter(FlowFolder.squad_id == None).all()
            if orphan_folders:
                for folder in orphan_folders:
                    folder.squad_id = first_squad.id
                db.commit()
                print(f"🔗 Linked {len(orphan_folders)} orphan folder(s) to '{first_squad.name}'")

    except Exception as e:
        print(f"Seed error (org): {e}")
        db.rollback()
    finally:
        db.close()


def seed_system_configs():
    """สร้างค่า System Config เริ่มต้น"""
    db = SessionLocal()
    default_configs = [
        {"key": "max_image_size_mb", "value": "5", "description": "Max image size in MB"},
        {"key": "max_images_per_flow", "value": "50", "description": "Max images allowed per flow"},
        {"key": "max_folder_depth", "value": "3", "description": "Maximum allowed depth for nested folders"},
        {"key": "max_queue_size", "value": "50", "description": "Maximum queued jobs allowed in system (returns HTTP 429 if full)"},
        {"key": "max_jobs_per_department", "value": "10", "description": "Maximum number of jobs to keep per department"},
        {"key": "max_flow_note_length", "value": "500", "description": "Maximum number of characters allowed for flow notes"},
        {"key": "worker_concurrency", "value": "2", "description": "Maximum parallel jobs to process simultaneously"},
        {"key": "offline_suspend_days", "value": "30", "description": "Days of inactivity before auto-suspending user"}
    ]

    obsolete_keys = ["default_ai_model", "master_system_prompt", "target_engine_api_url", "api_timeout_seconds", "ocr_similarity_threshold", "enable_ocr_check", "enable_image_alignment"]

    try:
        inserted = 0
        for conf in default_configs:
            existing = db.query(SystemConfig).filter(SystemConfig.key == conf["key"]).first()
            if not existing:
                db.add(SystemConfig(**conf))
                inserted += 1
        
        # Clean up obsolete keys
        deleted = db.query(SystemConfig).filter(SystemConfig.key.in_(obsolete_keys)).delete(synchronize_session=False)

        if inserted > 0 or deleted > 0:
            db.commit()
            print(f"⚙️ Seeded {inserted} default system configs, Deleted {deleted} obsolete configs")
    except Exception as e:
        print(f"Seed error (system configs): {e}")
        db.rollback()
    finally:
        db.close()
