# [file name]: reset_database.py
from app.database import engine, Base
from app import models
import os

def reset_database():
    """Drop and recreate all database tables"""
    print("🗑️ Dropping all tables...")
    Base.metadata.drop_all(bind=engine)
    
    print("🔄 Creating all tables...")
    Base.metadata.create_all(bind=engine)
    
    print("✅ Database reset complete!")

if __name__ == "__main__":
    reset_database()