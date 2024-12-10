#!/usr/bin/env bash
set -e
CC="clang19"
$CC \
	-O2 \
	-std=c11 \
	--target=wasm32 \
	-mbulk-memory \
	-msimd128 \
	-nostdlib \
	-Wl,--no-entry \
	-Wl,--import-memory \
	-Wl,--export-dynamic \
	-Wl,--unresolved-symbols=import-dynamic \
	-o what.wasm what.c
