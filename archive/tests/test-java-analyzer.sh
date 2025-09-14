#!/bin/bash

echo "Testing Java Analyzer MCP..."
echo ""

# Start timing
START=$(date +%s%3N)

# Create test requests
cat > test-requests.json << 'REQUESTS'
{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/frazier-life-sciences"}},"id":2}
{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_call_hierarchy","arguments":{"class_name":"com.frazierlifesciences.entity.StockPosition","method_name":"setFund","parameter_types":["com.frazierlifesciences.entity.Fund"],"include_callers":true,"include_callees":true}},"id":3}
{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_type_hierarchy","arguments":{"type_name":"com.frazierlifesciences.entity.StockPosition"}},"id":4}
REQUESTS

# Send requests to the MCP server
cat test-requests.json | ./eclipse-jdt-mcp 2>test-debug.log | tee test-output.json

END=$(date +%s%3N)
ELAPSED=$((END - START))

echo ""
echo "Total time: ${ELAPSED}ms"
echo ""
echo "Debug log:"
cat test-debug.log
