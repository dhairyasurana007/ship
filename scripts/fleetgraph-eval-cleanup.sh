#!/usr/bin/env bash
# Deletes FleetGraph eval test data left behind by Playwright evals.
# Exits 0 always so cleanup failure does not fail CI.

SHIP_API_URL="${SHIP_API_URL:-http://localhost:3000}"

response=$(curl -s -w "\n%{http_code}" \
  -X DELETE \
  -H "Content-Type: application/json" \
  "${SHIP_API_URL}/api/fleetgraph/test/cleanup")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n -1)

echo "HTTP $http_code"
echo "$body"

exit 0
