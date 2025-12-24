#!/bin/bash
# Setup local PostgreSQL 16 database for ScuffedSnap

echo "🐘 Setting up local PostgreSQL database..."

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL not found. Installing..."
    sudo apt update
    sudo apt install -y postgresql postgresql-contrib
fi

# Check if PostgreSQL is running
if ! sudo systemctl is-active --quiet postgresql; then
    echo "🔄 Starting PostgreSQL..."
    sudo systemctl start postgresql
    sudo systemctl enable postgresql
fi

echo "✅ PostgreSQL is running"

# Create database and user
echo "📝 Creating database and user..."
sudo -u postgres psql << EOF
-- Create database
DROP DATABASE IF EXISTS scuffedsnap;
CREATE DATABASE scuffedsnap;

-- Create user
DROP USER IF EXISTS scuffedsnap_user;
CREATE USER scuffedsnap_user WITH PASSWORD 'scuffedsnap_pass_2024';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE scuffedsnap TO scuffedsnap_user;

-- Connect to database and grant schema permissions
\c scuffedsnap
GRANT ALL ON SCHEMA public TO scuffedsnap_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO scuffedsnap_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO scuffedsnap_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO scuffedsnap_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO scuffedsnap_user;

\q
EOF

echo "✅ Database and user created"

# Run schema as postgres user
echo "📊 Creating tables and indexes..."
sudo -u postgres psql -d scuffedsnap -f local_postgres_schema.sql

if [ $? -eq 0 ]; then
    echo "✅ Schema created successfully!"
else
    echo "❌ Failed to create schema"
    exit 1
fi

# Set environment variable
export DATABASE_URL='postgresql://scuffedsnap_user:scuffedsnap_pass_2024@localhost:5432/scuffedsnap?sslmode=disable'

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📝 Connection details:"
echo "  Database: scuffedsnap"
echo "  User: scuffedsnap_user"
echo "  Password: scuffedsnap_pass_2024"
echo "  Host: localhost"
echo "  Port: 5432"
echo ""
echo "🔗 Connection string:"
echo "  DATABASE_URL='postgresql://scuffedsnap_user:scuffedsnap_pass_2024@localhost:5432/scuffedsnap?sslmode=disable'"
echo ""
echo "📋 Next steps:"
echo "  1. Set DATABASE_URL environment variable:"
echo "     export DATABASE_URL='postgresql://scuffedsnap_user:scuffedsnap_pass_2024@localhost:5432/scuffedsnap?sslmode=disable'"
echo ""
echo "  2. Switch to PostgreSQL database:"
echo "     ./switch_to_postgres.sh"
echo ""
echo "  3. Run your app:"
echo "     ./scuffedsnap"
echo ""
echo "💡 Tip: Add the export command to ~/.bashrc to make it permanent"
