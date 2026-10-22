#!/bin/sh
# hyperdht --bootstrap requires a routable IP, not 0.0.0.0. Detect at runtime.
HOST=$(hostname -i | awk '{print $1}')
echo "[bootstrap] Starting DHT on $HOST:49737"
exec node /app/node_modules/.bin/hyperdht --bootstrap --host "$HOST" --port 49737
