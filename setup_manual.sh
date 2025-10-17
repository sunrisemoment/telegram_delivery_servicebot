#!/bin/bash

echo "🚀 Setting up Delivery Bot without Docker..."

# Install system dependencies (Ubuntu/Debian)
echo "📦 Installing system dependencies..."
sudo apt update
sudo apt install -y python3 python3-pip python3-venv postgresql postgresql-contrib redis-server

# Start services
echo "🔧 Starting services..."
sudo systemctl start postgresql
sudo systemctl start redis
sudo systemctl enable postgresql
sudo systemctl enable redis

# Create database
echo "🗄️ Setting up database..."
sudo -u postgres psql -c "CREATE DATABASE deliver;"
sudo -u postgres psql -c "CREATE USER appuser WITH PASSWORD 'password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE deliver TO appuser;"

# Setup API
echo "🔧 Setting up API..."
cd api
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..

# Setup Bot
echo "🤖 Setting up Bot..."
cd bot
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..

# Initialize database
echo "📊 Initializing database..."
python3 scripts/init_db.py
python3 scripts/seed_menu.py

echo "✅ Setup complete!"
echo "🎯 To start the application:"
echo "Terminal 1: cd api && source venv/bin/activate && uvicorn app.main:app --reload"
echo "Terminal 2: cd bot && source venv/bin/activate && python -m app.main"