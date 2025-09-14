#!/bin/bash

echo "Testing Eclipse JDT.LS with Frazier Project"
echo "============================================"
echo

# Kill any existing JDT.LS processes
pkill -f "eclipse.jdt.ls" 2>/dev/null || true

# Run test
node ./test-final.js

echo
echo "Test complete!"
