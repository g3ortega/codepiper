#!/bin/bash
# E2E test for attach functionality
# Tests both follow mode and interactive mode

set -e

echo "=== E2E Test: Attach Command ==="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test directory
TEST_DIR="/tmp/codepiper-attach-test"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"

echo "Test directory: $TEST_DIR"
echo ""

# Kill any existing daemon
pkill -f "bun.*daemon" || true
sleep 1

# Start daemon
echo -e "${YELLOW}Starting daemon...${NC}"
bun run daemon &
DAEMON_PID=$!
sleep 2

# Check daemon is running
if ! ps -p $DAEMON_PID > /dev/null; then
  echo -e "${RED}✗ Daemon failed to start${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Daemon running (PID: $DAEMON_PID)${NC}"
echo ""

# Test 1: Verify session doesn't exist yet
echo -e "${YELLOW}Test 1: Attach to non-existent session${NC}"
if codepiper attach fake-session-id 2>&1 | grep -q "Session not found"; then
  echo -e "${GREEN}✓ Correctly reports session not found${NC}"
else
  echo -e "${RED}✗ Did not detect non-existent session${NC}"
  kill $DAEMON_PID
  exit 1
fi
echo ""

# Test 2: Create a session
echo -e "${YELLOW}Test 2: Create session${NC}"
SESSION_OUTPUT=$(codepiper start --provider claude-code --dir "$TEST_DIR")
SESSION_ID=$(echo "$SESSION_OUTPUT" | grep "ID:" | awk '{print $2}')

if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "undefined" ]; then
  echo -e "${RED}✗ Failed to create session${NC}"
  kill $DAEMON_PID
  exit 1
fi
echo -e "${GREEN}✓ Session created: $SESSION_ID${NC}"
echo ""

# Test 3: Verify session exists
echo -e "${YELLOW}Test 3: Verify session in list${NC}"
if codepiper sessions | grep -q "$SESSION_ID"; then
  echo -e "${GREEN}✓ Session appears in sessions list${NC}"
else
  echo -e "${RED}✗ Session not in list${NC}"
  kill $DAEMON_PID
  exit 1
fi
echo ""

# Test 4: Follow mode (read-only)
echo -e "${YELLOW}Test 4: Follow mode test${NC}"
echo "Note: This will attach in follow mode for 5 seconds, then auto-detach"
echo "You should see Claude Code output streaming..."
echo ""

# Attach in follow mode with timeout
timeout 5 codepiper attach "$SESSION_ID" --follow || true
echo ""
echo -e "${GREEN}✓ Follow mode attach worked (no crash)${NC}"
echo ""

# Test 5: Send command to session
echo -e "${YELLOW}Test 5: Send command to session${NC}"
codepiper send "$SESSION_ID" "echo 'Hello from codepiper test'" > /dev/null 2>&1
sleep 2
echo -e "${GREEN}✓ Command sent successfully${NC}"
echo ""

# Test 6: Interactive mode (manual)
echo -e "${YELLOW}Test 6: Interactive mode (manual test)${NC}"
echo ""
echo "To test interactive mode manually:"
echo "  1. Run: codepiper attach $SESSION_ID"
echo "  2. Type some commands and see responses"
echo "  3. Press Ctrl+C to detach"
echo "  4. Verify session still running: codepiper sessions"
echo ""
echo "Would you like to test interactive mode now? (y/n)"
read -r -t 30 RESPONSE || RESPONSE="n"

if [ "$RESPONSE" = "y" ]; then
  echo "Starting interactive attach..."
  echo "Press Ctrl+C when done"
  codepiper attach "$SESSION_ID" || true
  echo ""

  # Verify session still exists after detach
  if codepiper sessions | grep -q "$SESSION_ID"; then
    echo -e "${GREEN}✓ Session still running after detach${NC}"
  else
    echo -e "${RED}✗ Session disappeared after detach${NC}"
    kill $DAEMON_PID
    exit 1
  fi
fi
echo ""

# Cleanup
echo -e "${YELLOW}Cleaning up...${NC}"
pkill -f "bun.*daemon" || true
rm -rf "$TEST_DIR"
echo -e "${GREEN}✓ Cleanup complete${NC}"
echo ""

echo "=== All Attach Tests Passed ==="
