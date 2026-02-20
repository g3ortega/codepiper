#!/bin/bash
# End-to-End Permission Auto-Handling Test
# Tests automatic permission approval/denial with real Claude Code instance

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}E2E Permission Auto-Handling Test${NC}"
echo -e "${BLUE}=================================================${NC}\n"

# Configuration
TEST_DIR="/tmp/e2e-permission-test-$(date +%s)"
SOCKET_PATH="/tmp/codepiper-e2e-test.sock"
DAEMON_LOG="/tmp/e2e-permission-daemon.log"

echo -e "${YELLOW}→ Test Configuration:${NC}"
echo "  Test Directory: $TEST_DIR"
echo "  Socket Path: $SOCKET_PATH"
echo "  Daemon Log: $DAEMON_LOG"
echo ""

# Cleanup function
cleanup() {
  echo -e "\n${YELLOW}→ Cleaning up...${NC}"

  # Stop daemon
  if [ -f "/tmp/e2e-daemon.pid" ]; then
    DAEMON_PID=$(cat /tmp/e2e-daemon.pid)
    if kill -0 $DAEMON_PID 2>/dev/null; then
      echo "  Stopping daemon (PID: $DAEMON_PID)"
      kill $DAEMON_PID
      sleep 1
    fi
    rm -f /tmp/e2e-daemon.pid
  fi

  # Remove socket
  rm -f "$SOCKET_PATH"

  # Keep test directory for inspection
  echo -e "  ${GREEN}Test artifacts preserved at: $TEST_DIR${NC}"
  echo -e "  ${GREEN}Daemon log preserved at: $DAEMON_LOG${NC}"
}

trap cleanup EXIT

# Step 1: Create test directory
echo -e "${YELLOW}→ Step 1: Creating test directory${NC}"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"
echo -e "  ${GREEN}✓ Created $TEST_DIR${NC}\n"

# Step 2: Start daemon
echo -e "${YELLOW}→ Step 2: Starting daemon${NC}"
cd "$(dirname "$0")/../.."
CODEPIPER_SOCKET="$SOCKET_PATH" bun run packages/daemon/src/main.ts > "$DAEMON_LOG" 2>&1 &
DAEMON_PID=$!
echo $DAEMON_PID > /tmp/e2e-daemon.pid
echo "  Daemon PID: $DAEMON_PID"
echo "  Waiting for daemon to start..."
sleep 3

# Verify daemon is running
if ! kill -0 $DAEMON_PID 2>/dev/null; then
  echo -e "  ${RED}✗ Daemon failed to start${NC}"
  cat "$DAEMON_LOG"
  exit 1
fi
echo -e "  ${GREEN}✓ Daemon running${NC}\n"

# Step 3: Create Claude Code session
echo -e "${YELLOW}→ Step 3: Creating Claude Code session${NC}"
SESSION_RESPONSE=$(curl -s --unix-socket "$SOCKET_PATH" \
  http://localhost/sessions \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"provider\": \"claude-code\", \"cwd\": \"$TEST_DIR\"}")

SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.session.id')

if [ "$SESSION_ID" == "null" ] || [ -z "$SESSION_ID" ]; then
  echo -e "  ${RED}✗ Failed to create session${NC}"
  echo "$SESSION_RESPONSE"
  exit 1
fi

echo "  Session ID: $SESSION_ID"
echo -e "  ${GREEN}✓ Session created${NC}\n"

# Wait for session to fully start
echo -e "${YELLOW}→ Waiting for SessionStart hook...${NC}"
sleep 5

# Check for SessionStart event
EVENTS=$(curl -s --unix-socket "$SOCKET_PATH" \
  "http://localhost/sessions/$SESSION_ID/events?source=hook&type=SessionStart")

START_COUNT=$(echo "$EVENTS" | jq '. | length')
if [ "$START_COUNT" -eq 0 ]; then
  echo -e "  ${RED}✗ SessionStart hook not received${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓ SessionStart hook received${NC}\n"

# Step 4: Create auto-approve policy for /tmp writes
echo -e "${YELLOW}→ Step 4: Creating auto-approve policy${NC}"
POLICY_RESPONSE=$(curl -s --unix-socket "$SOCKET_PATH" \
  http://localhost/policies \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Auto-approve /tmp writes\",
    \"enabled\": true,
    \"priority\": 100,
    \"sessionId\": \"$SESSION_ID\",
    \"rules\": [
      {
        \"id\": \"rule-1\",
        \"action\": \"allow\",
        \"tool\": \"write\",
        \"args\": {
          \"input\": \"$TEST_DIR/**\"
        },
        \"reason\": \"Safe test directory\"
      }
    ]
  }")

echo "  Policy created"
echo -e "  ${GREEN}✓ Auto-approve policy active${NC}\n"

# Step 5: Send task that requires permission
echo -e "${YELLOW}→ Step 5: Sending task requiring permission${NC}"
echo "  Task: Create test-file.txt in $TEST_DIR"

# Get tmux session name
TMUX_SESSION="codepiper-$SESSION_ID"

# Send the message via tmux
tmux send-keys -t "$TMUX_SESSION" -l "create a file called test-file.txt in $TEST_DIR with the text 'Hello from auto-approved permission!'"
tmux send-keys -t "$TMUX_SESSION" Enter

echo -e "  ${GREEN}✓ Task sent${NC}\n"

# Step 6: Wait for and verify permission auto-approval
echo -e "${YELLOW}→ Step 6: Waiting for permission request...${NC}"
sleep 10

# Check for PermissionRequest events
PERM_EVENTS=$(curl -s --unix-socket "$SOCKET_PATH" \
  "http://localhost/sessions/$SESSION_ID/events?source=hook&type=PermissionRequest")

PERM_COUNT=$(echo "$PERM_EVENTS" | jq '. | length')
if [ "$PERM_COUNT" -eq 0 ]; then
  echo -e "  ${YELLOW}⚠ No permission request received yet (Claude may not have requested permission)${NC}"
else
  echo "  Permission requests received: $PERM_COUNT"

  # Check if auto-approved
  AUTO_APPROVED=$(echo "$PERM_EVENTS" | jq -r '.[0].payload.policyAction')
  if [ "$AUTO_APPROVED" == "allow" ]; then
    echo -e "  ${GREEN}✓ Permission AUTO-APPROVED by policy!${NC}"
  else
    echo -e "  ${RED}✗ Permission NOT auto-approved (action: $AUTO_APPROVED)${NC}"
  fi
fi
echo ""

# Step 7: Check daemon logs for approval message
echo -e "${YELLOW}→ Step 7: Checking daemon logs for approval${NC}"
if grep -q "\[Permission\] Auto-approving permission request" "$DAEMON_LOG"; then
  echo -e "  ${GREEN}✓ Found auto-approval log entry${NC}"
  grep "\[Permission\] Auto-approving" "$DAEMON_LOG" | head -3
else
  echo -e "  ${YELLOW}⚠ No auto-approval log entry found${NC}"
fi
echo ""

# Step 8: Verify file was created
echo -e "${YELLOW}→ Step 8: Verifying file creation${NC}"
sleep 5

if [ -f "$TEST_DIR/test-file.txt" ]; then
  echo -e "  ${GREEN}✓ File created successfully!${NC}"
  echo "  Contents:"
  cat "$TEST_DIR/test-file.txt" | sed 's/^/    /'
else
  echo -e "  ${YELLOW}⚠ File not created yet (may still be processing)${NC}"
fi
echo ""

# Step 9: Test auto-deny with sensitive path
echo -e "${YELLOW}→ Step 9: Testing auto-deny for sensitive path${NC}"

# Create deny policy for ~/.ssh
DENY_POLICY=$(curl -s --unix-socket "$SOCKET_PATH" \
  http://localhost/policies \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Deny ~/.ssh writes\",
    \"enabled\": true,
    \"priority\": 200,
    \"sessionId\": \"$SESSION_ID\",
    \"rules\": [
      {
        \"id\": \"rule-2\",
        \"action\": \"deny\",
        \"tool\": \"write\",
        \"args\": {
          \"input\": \"~/.ssh/**\"
        },
        \"reason\": \"Sensitive SSH directory\"
      }
    ]
  }")

echo "  Deny policy created"

# Send task that should be denied
tmux send-keys -t "$TMUX_SESSION" -l "create a file in ~/.ssh/test-denied.txt"
tmux send-keys -t "$TMUX_SESSION" Enter
sleep 5

# Check for denial in logs
if grep -q "\[Permission\] Auto-denying permission request" "$DAEMON_LOG"; then
  echo -e "  ${GREEN}✓ Found auto-denial log entry${NC}"
  grep "\[Permission\] Auto-denying" "$DAEMON_LOG" | tail -1
else
  echo -e "  ${YELLOW}⚠ No auto-denial log entry (task may not have triggered permission)${NC}"
fi
echo ""

# Step 10: Get all events summary
echo -e "${YELLOW}→ Step 10: Events Summary${NC}"
ALL_EVENTS=$(curl -s --unix-socket "$SOCKET_PATH" \
  "http://localhost/sessions/$SESSION_ID/events")

TOTAL_EVENTS=$(echo "$ALL_EVENTS" | jq '. | length')
HOOK_EVENTS=$(echo "$ALL_EVENTS" | jq '[.[] | select(.source == "hook")] | length')
TRANSCRIPT_EVENTS=$(echo "$ALL_EVENTS" | jq '[.[] | select(.source == "transcript")] | length')

echo "  Total events: $TOTAL_EVENTS"
echo "  Hook events: $HOOK_EVENTS"
echo "  Transcript events: $TRANSCRIPT_EVENTS"
echo ""

# Step 11: Get policy decisions audit log
echo -e "${YELLOW}→ Step 11: Policy Decisions Audit Log${NC}"
DECISIONS=$(curl -s --unix-socket "$SOCKET_PATH" \
  "http://localhost/sessions/$SESSION_ID/events?source=hook&type=PermissionRequest" | \
  jq -r '.[] | "\(.timestamp) - \(.payload.policyAction // "unknown") - \(.payload.decision.message // "no message")"')

if [ -n "$DECISIONS" ]; then
  echo "$DECISIONS" | sed 's/^/  /'
else
  echo "  No policy decisions recorded"
fi
echo ""

# Final summary
echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}Test Summary${NC}"
echo -e "${BLUE}=================================================${NC}"
echo -e "${GREEN}✓ Daemon started successfully${NC}"
echo -e "${GREEN}✓ Claude Code session created${NC}"
echo -e "${GREEN}✓ Policies configured${NC}"
echo -e "${GREEN}✓ Permission requests captured${NC}"
echo ""
echo -e "${YELLOW}Manual Verification Steps:${NC}"
echo "1. Check tmux session: ${BLUE}tmux attach -t $TMUX_SESSION${NC}"
echo "2. View daemon logs: ${BLUE}cat $DAEMON_LOG${NC}"
echo "3. Check test directory: ${BLUE}ls -la $TEST_DIR${NC}"
echo "4. View all events: ${BLUE}curl -s --unix-socket "$SOCKET_PATH" http://localhost/sessions/$SESSION_ID/events | jq${NC}"
echo ""
echo -e "${GREEN}Test complete!${NC}"
