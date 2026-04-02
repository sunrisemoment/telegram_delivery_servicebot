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
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS display_name VARCHAR(150)",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS alias_username VARCHAR(100)",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS alias_email VARCHAR(200)",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) DEFAULT 'active'",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS invite_id BIGINT",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE",
        "UPDATE drivers SET is_online = TRUE WHERE is_online IS NULL",
        "UPDATE drivers SET accepts_delivery = TRUE WHERE accepts_delivery IS NULL",
        "UPDATE drivers SET accepts_pickup = TRUE WHERE accepts_pickup IS NULL",
        "UPDATE drivers SET max_delivery_distance_miles = 15.0 WHERE max_delivery_distance_miles IS NULL",
        "UPDATE drivers SET max_concurrent_orders = 1 WHERE max_concurrent_orders IS NULL",
        "UPDATE customers SET account_status = 'active' WHERE account_status IS NULL",
        "UPDATE orders SET status = 'delivered' WHERE status = 'completed'",
        "UPDATE orders SET payment_status = 'paid_confirmed' WHERE payment_status = 'paid' AND payment_confirmed = TRUE",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_alias_username ON customers(alias_username) WHERE alias_username IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_alias_email ON customers(alias_email) WHERE alias_email IS NOT NULL",
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
