#!/bin/bash

# Stop the Java backend server
PROJECT_DIR="$(dirname "$(dirname "$0")")"
PID_FILE="$PROJECT_DIR/.java-backend.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill $PID 2>/dev/null; then
        echo "Stopped Java backend (PID: $PID)"
        rm "$PID_FILE"
    else
        echo "Java backend not running (cleaning up stale PID file)"
        rm "$PID_FILE"
    fi
else
    echo "Java backend is not running"
fi