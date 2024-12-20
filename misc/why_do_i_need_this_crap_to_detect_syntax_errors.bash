#!/usr/bin/env bash
cd $(dirname $0)/..
cat webworkermain_graphics.js | node --check --input-type=module
# XXX browsers (Firefox/Chrome) throw unhelpful errors when I have a syntax
# error in certain places. This script may help in finding them. I should
# probably start compiling the frontend at some point anyway, which should
# solve the problem but it's currently way to inconvenient.
