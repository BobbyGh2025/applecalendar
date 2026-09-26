#!/bin/bash
set -e

cd /home/z/my-project

# Start server
node server-keeper.js &
KEEPER_PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do
  if ss -tlnp 2>/dev/null | rg -q "3000"; then
    echo "✅ Server ready on port 3000"
    break
  fi
  sleep 1
done

sleep 2

echo ""
echo "=========================================="
echo "STEP 1: Open page"
echo "=========================================="
agent-browser open http://127.0.0.1:3000 2>&1 || true
sleep 5

echo ""
echo "=========================================="
echo "STEP 2: Check page title and snapshot"
echo "=========================================="
agent-browser get title 2>&1 || true
agent-browser get url 2>&1 || true

echo ""
echo "=========================================="
echo "STEP 3: Check for page errors"
echo "=========================================="
agent-browser errors 2>&1 || true

echo ""
echo "=========================================="
echo "STEP 4: Take interactive snapshot"
echo "=========================================="
agent-browser snapshot -i 2>&1 || true

echo ""
echo "=========================================="
echo "STEP 5: Click on AI & Machine Learning Workshop (upcoming events)"
echo "=========================================="
# First get the snapshot to find the right ref
agent-browser snapshot -i 2>&1 > /tmp/snapshot1.txt || true
# Try clicking via semantic locator
agent-browser find text "AI & Machine Learning Workshop" click 2>&1 || true
sleep 5

echo ""
echo "=========================================="
echo "STEP 6: Check event detail page"
echo "=========================================="
agent-browser snapshot 2>&1 || true

echo ""
echo "=========================================="
echo "STEP 7: Check for errors after navigation"
echo "=========================================="
agent-browser errors 2>&1 || true

echo ""
echo "=========================================="
echo "STEP 8: Get current URL"
echo "=========================================="
agent-browser get url 2>&1 || true

echo ""
echo "=========================================="
echo "STEP 9: Scroll down to see sessions, participants, media"
echo "=========================================="
agent-browser scroll down 500 2>&1 || true
sleep 1
agent-browser snapshot 2>&1 || true

echo ""
echo "=========================================="
echo "STEP 10: Scroll more"
echo "=========================================="
agent-browser scroll down 500 2>&1 || true
sleep 1
agent-browser snapshot 2>&1 || true

echo ""
echo "=========================================="
echo "STEP 11: Final error check"
echo "=========================================="
agent-browser errors 2>&1 || true
agent-browser console 2>&1 || true

echo ""
echo "=========================================="
echo "BROWSER VERIFICATION COMPLETE"
echo "=========================================="
