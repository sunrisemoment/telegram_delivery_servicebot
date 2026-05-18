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
        "ALTER TABLE drivers ADD COLUMN IF NOT EXISTS max_concurrent_orders INTEGER DEFAULT 3",
        "ALTER TABLE drivers ALTER COLUMN max_concurrent_orders SET DEFAULT 3",
        "ALTER TABLE drivers ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) DEFAULT 'America/New_York'",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS display_name VARCHAR(150)",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS alias_username VARCHAR(100)",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS alias_email VARCHAR(200)",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS app_role VARCHAR(20) DEFAULT 'customer'",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS account_status VARCHAR(40) DEFAULT 'active'",
        "ALTER TABLE customers ALTER COLUMN account_status TYPE VARCHAR(40)",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'approved'",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS invite_id BIGINT",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_verification_code_hash VARCHAR(64)",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_verification_expires_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_verification_sent_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE customer_invites ADD COLUMN IF NOT EXISTS target_role VARCHAR(20) DEFAULT 'customer'",
        "ALTER TABLE customer_invites ADD COLUMN IF NOT EXISTS phone VARCHAR(32)",
        "ALTER TABLE customer_invites ADD COLUMN IF NOT EXISTS invite_kind VARCHAR(30) DEFAULT 'direct'",
        "ALTER TABLE customer_invites ADD COLUMN IF NOT EXISTS campaign_tag VARCHAR(100)",
        "ALTER TABLE customer_invites ADD COLUMN IF NOT EXISTS source_tag VARCHAR(100)",
        "ALTER TABLE customer_invites ADD COLUMN IF NOT EXISTS referral_batch_id BIGINT",
        "ALTER TABLE referrals ALTER COLUMN referrer_customer_id DROP NOT NULL",
        "ALTER TABLE referrals ALTER COLUMN status SET DEFAULT 'created'",
        "ALTER TABLE referrals ADD COLUMN IF NOT EXISTS signed_up_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE referrals ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE referrals ADD COLUMN IF NOT EXISTS approved_by VARCHAR(100)",
        "ALTER TABLE referrals ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE referrals ADD COLUMN IF NOT EXISTS rejected_by VARCHAR(100)",
        "ALTER TABLE referrals ADD COLUMN IF NOT EXISTS approval_note TEXT",
        "ALTER TABLE referrals ADD COLUMN IF NOT EXISTS qualifying_order_id BIGINT",
        "ALTER TABLE referrals ADD COLUMN IF NOT EXISTS qualifying_order_placed_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE referrals ADD COLUMN IF NOT EXISTS friend_discount_order_id BIGINT",
        "ALTER TABLE referrals ADD COLUMN IF NOT EXISTS friend_discount_applied_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE referrals ADD COLUMN IF NOT EXISTS reward_issued_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE referrals ADD COLUMN IF NOT EXISTS friend_discount_cents INTEGER DEFAULT 2500",
        "ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referrer_credit_cents INTEGER DEFAULT 1500",
        "UPDATE drivers SET is_online = TRUE WHERE is_online IS NULL",
        "UPDATE drivers SET accepts_delivery = TRUE WHERE accepts_delivery IS NULL",
        "UPDATE drivers SET accepts_pickup = TRUE WHERE accepts_pickup IS NULL",
        "UPDATE drivers SET max_delivery_distance_miles = 15.0 WHERE max_delivery_distance_miles IS NULL",
        "UPDATE drivers SET max_concurrent_orders = 3 WHERE max_concurrent_orders IS NULL OR max_concurrent_orders < 2",
        "UPDATE customers SET app_role = 'customer' WHERE app_role IS NULL",
        "UPDATE customers SET account_status = 'active' WHERE account_status IS NULL",
        "UPDATE customers SET approval_status = 'approved' WHERE approval_status IS NULL",
        "UPDATE customer_invites SET target_role = 'customer' WHERE target_role IS NULL",
        "UPDATE customer_invites SET invite_kind = 'direct' WHERE invite_kind IS NULL",
        "UPDATE referrals SET status = 'created' WHERE status = 'pending' AND referred_customer_id IS NULL",
        "UPDATE referrals SET status = 'signed_up', signed_up_at = COALESCE(signed_up_at, claimed_at) WHERE status IN ('pending', 'claimed') AND referred_customer_id IS NOT NULL",
        "UPDATE orders SET status = 'delivered' WHERE status = 'completed'",
        "UPDATE orders SET payment_status = 'paid_confirmed' WHERE payment_status = 'paid' AND payment_confirmed = TRUE",
        """
        CREATE TABLE IF NOT EXISTS menu_item_photos (
            id BIGSERIAL PRIMARY KEY,
            menu_item_id BIGINT NOT NULL REFERENCES menu_items(id),
            photo_url TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
        """,
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
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS delivery_minimum_subtotal_cents INTEGER DEFAULT 7500",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS dispatch_offer_timeout_seconds INTEGER DEFAULT 90",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS dispatch_auto_escalate BOOLEAN DEFAULT TRUE",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS admin_session_hours INTEGER DEFAULT 12",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_alias_username ON customers(alias_username) WHERE alias_username IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_alias_email ON customers(alias_email) WHERE alias_email IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS ix_customer_invites_phone ON customer_invites(phone)",
        "CREATE INDEX IF NOT EXISTS ix_customer_invites_invite_kind ON customer_invites(invite_kind)",
        "CREATE INDEX IF NOT EXISTS ix_customer_invites_referral_batch_id ON customer_invites(referral_batch_id)",
        "CREATE INDEX IF NOT EXISTS ix_menu_item_photos_menu_item_sort_order ON menu_item_photos(menu_item_id, sort_order)",
        "CREATE INDEX IF NOT EXISTS ix_pickup_eta_updates_order_created_at ON pickup_eta_updates(order_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_pickup_arrival_photos_order_created_at ON pickup_arrival_photos(order_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_driver_working_hours_driver_day ON driver_working_hours(driver_id, day_of_week)",
        "CREATE INDEX IF NOT EXISTS ix_dispatch_queue_entries_status ON dispatch_queue_entries(status)",
        "CREATE INDEX IF NOT EXISTS ix_driver_assignment_offers_driver_status ON driver_assignment_offers(driver_id, status)",
        "CREATE INDEX IF NOT EXISTS ix_support_tickets_status_created_at ON support_tickets(status, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_referrals_referrer_status ON referrals(referrer_customer_id, status)",
        "CREATE INDEX IF NOT EXISTS ix_referrals_status_created_at ON referrals(status, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_referral_rewards_recipient_status ON referral_rewards(recipient_customer_id, status)",
        "CREATE INDEX IF NOT EXISTS ix_referral_batches_created_at ON referral_batches(created_at DESC)",
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
