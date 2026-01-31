#!/bin/bash
# DocVault - Cloudflare Setup Script
# This script helps you set up the Cloudflare resources needed for DocVault

set -e

echo "🚀 DocVault Cloudflare Setup"
echo "============================"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found. Installing..."
    npm install -g wrangler
fi

# Check login status
echo "📋 Checking Cloudflare login status..."
if ! wrangler whoami 2>&1 | grep -q "You are logged in"; then
    echo ""
    echo "🔐 Please login to Cloudflare..."
    echo "   This will open a browser window."
    echo ""
    wrangler login
fi

echo ""
echo "✅ Logged in to Cloudflare"
echo ""

# Create D1 Database
echo "📦 Creating D1 Database..."
D1_OUTPUT=$(wrangler d1 create docvault-db 2>&1 || true)

if echo "$D1_OUTPUT" | grep -q "already exists"; then
    echo "   Database 'docvault-db' already exists"
    D1_ID=$(wrangler d1 list 2>&1 | grep docvault-db | awk '{print $1}')
else
    D1_ID=$(echo "$D1_OUTPUT" | grep "database_id" | awk -F'"' '{print $2}')
    echo "   Created database with ID: $D1_ID"
fi

# Create R2 Bucket
echo ""
echo "🗄️  Creating R2 Bucket..."
R2_OUTPUT=$(wrangler r2 bucket create docvault-files 2>&1 || true)

if echo "$R2_OUTPUT" | grep -q "already exists"; then
    echo "   Bucket 'docvault-files' already exists"
else
    echo "   Created bucket 'docvault-files'"
fi

# Create Vectorize Index
echo ""
echo "🔍 Creating Vectorize Index..."
VEC_OUTPUT=$(wrangler vectorize create docvault-embeddings --dimensions=768 --metric=cosine 2>&1 || true)

if echo "$VEC_OUTPUT" | grep -q "already exists"; then
    echo "   Index 'docvault-embeddings' already exists"
else
    echo "   Created Vectorize index 'docvault-embeddings'"
fi

# Create Queue
echo ""
echo "📨 Creating Queue..."
QUEUE_OUTPUT=$(wrangler queues create docvault-processing 2>&1 || true)

if echo "$QUEUE_OUTPUT" | grep -q "already exists"; then
    echo "   Queue 'docvault-processing' already exists"
else
    echo "   Created queue 'docvault-processing'"
fi

# Update wrangler.toml with database ID
if [ -n "$D1_ID" ]; then
    echo ""
    echo "📝 Updating wrangler.toml with database ID..."
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/database_id = \"\"/database_id = \"$D1_ID\"/" wrangler.toml
    else
        sed -i "s/database_id = \"\"/database_id = \"$D1_ID\"/" wrangler.toml
    fi
fi

# Generate JWT secret
echo ""
echo "🔑 Setting up secrets..."
JWT_SECRET=$(openssl rand -base64 32)
echo "   Generated JWT secret"

echo ""
echo "   Run the following command to set the JWT secret:"
echo ""
echo "   wrangler secret put JWT_SECRET"
echo ""
echo "   When prompted, paste this value: $JWT_SECRET"
echo ""

# Run database migration
echo ""
echo "📊 Running database migration..."
wrangler d1 execute docvault-db --file=workers/migrations/0001_initial_schema.sql 2>&1 || true

echo ""
echo "✨ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Set JWT_SECRET: wrangler secret put JWT_SECRET"
echo "2. Start local development: npm run dev:workers"
echo "3. Deploy to production: npm run deploy:workers"
echo ""
