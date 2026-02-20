#!/bin/bash
# Basic usage example for CodePiper daemon

SOCKET="/tmp/codepiper.sock"

echo "=== CodePiper Daemon Basic Usage Example ==="
echo

echo "1. Health Check"
curl --unix-socket $SOCKET http://localhost/health | jq .
echo

echo "2. Version Info"
curl --unix-socket $SOCKET http://localhost/version | jq .
echo

echo "3. List Sessions (should be empty)"
curl --unix-socket $SOCKET http://localhost/sessions | jq .
echo

echo "4. Create a new session"
SESSION_ID=$(curl --unix-socket $SOCKET \
  -X POST http://localhost/sessions \
  -H "Content-Type: application/json" \
  -d "{\"provider\": \"claude-code\", \"cwd\": \"$(pwd)\"}" | jq -r .session.id)
echo "Created session: $SESSION_ID"
echo

echo "5. Get session details"
curl --unix-socket $SOCKET http://localhost/sessions/$SESSION_ID | jq .
echo

echo "6. List all sessions"
curl --unix-socket $SOCKET http://localhost/sessions | jq .
echo

echo "7. Send text to session"
curl --unix-socket $SOCKET \
  -X POST http://localhost/sessions/$SESSION_ID/send \
  -H "Content-Type: application/json" \
  -d '{"text": "help", "newline": true}' | jq .
echo

echo "8. Send keys to session"
curl --unix-socket $SOCKET \
  -X POST http://localhost/sessions/$SESSION_ID/keys \
  -H "Content-Type: application/json" \
  -d '{"keys": ["ctrl+c"]}' | jq .
echo

echo "9. Stop session"
curl --unix-socket $SOCKET \
  -X POST http://localhost/sessions/$SESSION_ID/stop | jq .
echo

echo "10. Verify session is stopped"
curl --unix-socket $SOCKET http://localhost/sessions/$SESSION_ID | jq .
echo

echo "=== Example complete ==="
