#!/bin/bash
# Cleanup script for zombie codepiper tmux sessions

echo "🧹 Cleaning up zombie codepiper tmux sessions..."

# Get list of codepiper sessions
sessions=$(tmux list-sessions 2>/dev/null | grep "^codepiper-" | cut -d: -f1)

if [ -z "$sessions" ]; then
  echo "✅ No zombie sessions found"
  exit 0
fi

count=0
while IFS= read -r session; do
  echo "   Killing: $session"
  tmux kill-session -t "$session" 2>/dev/null
  ((count++))
done <<< "$sessions"

echo "✅ Cleaned up $count zombie sessions"
