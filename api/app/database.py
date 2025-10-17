from sqlalchemy import create_engine
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

def get_db():
    """Database session dependency"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

if __name__ == "__main__":
    create_tables()
