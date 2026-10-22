#!/bin/sh
# hyperdht --bootstrap requires a routable IP, not 0.0.0.0. Detect at runtime.
HOST=$(hostname -i | awk '{print $1}')
echo "[bootstrap] Starting DHT on $HOST:49737"
node /app/node_modules/.bin/hyperdht --bootstrap --host "$HOST" --port 49737 &
BOOT_PID=$!
# Give hyperdht a moment to bind, then signal readiness for the health check
sleep 1
touch /tmp/bootstrap-ready
# Block until hyperdht exits (runs indefinitely in normal operation)
wait $BOOT_PID
