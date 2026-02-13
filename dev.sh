#!/usr/bin/env bash
# Two-server dev launcher: FastAPI backend (:8000) + Vite dev server (:5173)
# Open http://localhost:5173 for development (HMR, bare imports, etc.)

set -euo pipefail

# Remove stale dist so the backend serves the raw frontend/index.html
rm -rf frontend/dist

# Unset CLAUDECODE to prevent SDK errors when run from a Claude Code terminal
unset CLAUDECODE 2>/dev/null || true

cleanup() {
    echo ""
    echo "Shutting down..."
    kill "$BACKEND_PID" "$VITE_PID" 2>/dev/null || true
    wait "$BACKEND_PID" "$VITE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Start backend
python run.py &
BACKEND_PID=$!

# Start Vite dev server
cd frontend && npx vite &
VITE_PID=$!
cd ..

echo ""
echo "========================================="
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5174  <-- open this"
echo "========================================="
echo ""

wait
