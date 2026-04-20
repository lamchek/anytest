#!/bin/zsh

set -e

PORT=8080
URL="http://127.0.0.1:$PORT"

echo "Starting WebGL server in: $(pwd)"
echo "Checking index.html..."

if [ ! -f "index.html" ]; then
  echo "ERROR: index.html not found in working directory"
  exit 1
fi

echo "Launching Python HTTP server on port $PORT..."
python3 -m http.server "$PORT" >/tmp/rider-webgl-server.log 2>&1 &
SERVER_PID=$!

echo "Server PID: $SERVER_PID"
echo "Waiting for server to become available..."

for i in {1..30}; do
  if curl -s "$URL" >/dev/null 2>&1; then
    echo "Server is up: $URL"
    break
  fi

  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    echo "ERROR: server process exited early"
    echo "---- server log ----"
    cat /tmp/rider-webgl-server.log
    exit 1
  fi

  sleep 0.5
done

if ! curl -s "$URL" >/dev/null 2>&1; then
  echo "ERROR: server did not start in time"
  echo "---- server log ----"
  cat /tmp/rider-webgl-server.log
  kill "$SERVER_PID" >/dev/null 2>&1 || true
  exit 1
fi

echo "Opening browser..."
open -a "Google Chrome" "$URL"

echo "Press Ctrl+C to stop the server"

cleanup() {
  echo
  echo "Stopping server..."
  kill "$SERVER_PID" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM
wait "$SERVER_PID"