#!/usr/bin/env bash

set -e

script_dir=$(dirname "$0")
mkdir -p "$script_dir/src"
pushd "$script_dir/src"
xargs -n 1 -P 1 ../download.sh < ../list.txt

for (( i=0; i<100; i++ )); do
	if [ ! -f sdp$i.txt ]; then
		../fakesdp.sh > sdp$i.txt
	fi
done
popd
