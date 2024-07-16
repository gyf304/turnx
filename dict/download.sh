#!/usr/bin/env bash

set -e
fn=$(printf "%s" "$1" | sha256sum | head -c 8).http
if [ -f "$fn" ]; then
	exit 0
fi
curl --http1.1 -D - "$1" > "$fn"
