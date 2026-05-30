#!/bin/bash
set -euo pipefail

echo "[postdeploy] Ensuring due-soon sprint seed data exists..."
cd /var/app/current
node api/dist/db/scripts/seed-due-soon-sprint.js
echo "[postdeploy] Due-soon sprint seed complete."
