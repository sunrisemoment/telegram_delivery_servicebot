from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from . import models

from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://admin:password@localhost:5432/deliver")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

Base.metadata = models.Base.metadata
# For debugging - print the connection URL
print(f"🔗 Database URL: {DATABASE_URL}")

def create_tables():
    """Create all tables in the database"""
    try:
        # Drop all tables first (use with caution in production)
        # Base.metadata.drop_all(bind=engine)

        Base.metadata.create_all(bind=engine)
        ensure_runtime_schema()
        print("✅ All tables created successfully!")

        # Verify tables were created
        from sqlalchemy import inspect
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        print(f"📊 Tables in database: {tables}")
        return True
    except Exception as e:
        print(f"❌ Error creating tables: {e}")
        return False


def ensure_runtime_schema():
    """Apply lightweight runtime schema updates for environments without migrations."""
    statements = [
        "ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT TRUE",
        "ALTER TABLE drivers ADD COLUMN IF NOT EXISTS accepts_delivery BOOLEAN DEFAULT TRUE",
        "ALTER TABLE drivers ADD COLUMN IF NOT EXISTS accepts_pickup BOOLEAN DEFAULT TRUE",
        "ALTER TABLE drivers ADD COLUMN IF NOT EXISTS max_delivery_distance_miles DOUBLE PRECISION DEFAULT 15.0",
        "ALTER TABLE drivers ADD COLUMN IF NOT EXISTS max_concurrent_orders INTEGER DEFAULT 1",
        "ALTER TABLE drivers ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) DEFAULT 'America/New_York'",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS display_name VARCHAR(150)",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS alias_username VARCHAR(100)",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS alias_email VARCHAR(200)",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS app_role VARCHAR(20) DEFAULT 'customer'",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) DEFAULT 'active'",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS invite_id BIGINT",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE customer_invites ADD COLUMN IF NOT EXISTS target_role VARCHAR(20) DEFAULT 'customer'",
        "UPDATE drivers SET is_online = TRUE WHERE is_online IS NULL",
        "UPDATE drivers SET accepts_delivery = TRUE WHERE accepts_delivery IS NULL",
        "UPDATE drivers SET accepts_pickup = TRUE WHERE accepts_pickup IS NULL",
        "UPDATE drivers SET max_delivery_distance_miles = 15.0 WHERE max_delivery_distance_miles IS NULL",
        "UPDATE drivers SET max_concurrent_orders = 1 WHERE max_concurrent_orders IS NULL",
        "UPDATE customers SET app_role = 'customer' WHERE app_role IS NULL",
        "UPDATE customers SET account_status = 'active' WHERE account_status IS NULL",
        "UPDATE customer_invites SET target_role = 'customer' WHERE target_role IS NULL",
        "UPDATE orders SET status = 'delivered' WHERE status = 'completed'",
        "UPDATE orders SET payment_status = 'paid_confirmed' WHERE payment_status = 'paid' AND payment_confirmed = TRUE",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS central_location_name VARCHAR(120) DEFAULT 'Atlantic Station'",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS central_location_address VARCHAR(255) DEFAULT 'Atlantic Station, Atlanta, GA'",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS central_location_lat DOUBLE PRECISION DEFAULT 33.7901",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS central_location_lng DOUBLE PRECISION DEFAULT -84.3972",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS atlantic_station_radius_miles DOUBLE PRECISION DEFAULT 2.0",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS atlantic_station_fee_cents INTEGER DEFAULT 500",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS inside_i285_radius_miles DOUBLE PRECISION DEFAULT 10.0",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS inside_i285_fee_cents INTEGER DEFAULT 1000",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS outside_i285_radius_miles DOUBLE PRECISION DEFAULT 18.0",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS outside_i285_fee_cents INTEGER DEFAULT 2000",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS max_delivery_radius_miles DOUBLE PRECISION DEFAULT 18.0",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS delivery_radius_enforced BOOLEAN DEFAULT TRUE",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS dispatch_offer_timeout_seconds INTEGER DEFAULT 90",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS dispatch_auto_escalate BOOLEAN DEFAULT TRUE",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS admin_session_hours INTEGER DEFAULT 12",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_alias_username ON customers(alias_username) WHERE alias_username IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_alias_email ON customers(alias_email) WHERE alias_email IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS ix_pickup_eta_updates_order_created_at ON pickup_eta_updates(order_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_pickup_arrival_photos_order_created_at ON pickup_arrival_photos(order_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_driver_working_hours_driver_day ON driver_working_hours(driver_id, day_of_week)",
        "CREATE INDEX IF NOT EXISTS ix_dispatch_queue_entries_status ON dispatch_queue_entries(status)",
        "CREATE INDEX IF NOT EXISTS ix_driver_assignment_offers_driver_status ON driver_assignment_offers(driver_id, status)",
        "CREATE INDEX IF NOT EXISTS ix_support_tickets_status_created_at ON support_tickets(status, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_referrals_referrer_status ON referrals(referrer_customer_id, status)",
        "CREATE INDEX IF NOT EXISTS ix_audit_logs_created_at ON audit_logs(created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_admin_sessions_expires_at ON admin_sessions(expires_at)",
    ]

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))

def get_db():
    """Database session dependency"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

if __name__ == "__main__":
    create_tables()
