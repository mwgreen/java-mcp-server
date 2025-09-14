#!/bin/bash
echo "=== Testing like Claude Code would ==="

# Test the exact sequence Claude Code uses
(
  echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}},"id":1}'
  sleep 1
  echo '{"jsonrpc":"2.0","method":"initialized","params":{}}'
  sleep 1
  echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}'
  sleep 1
  echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/frazier-life-sciences"}},"id":3}'
  sleep 2
  echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_call_hierarchy","arguments":{"class_name":"com.frazierlifesciences.entity.StockPosition","method_name":"setFund","parameter_types":["com.frazierlifesciences.entity.Fund"],"include_callers":true,"include_callees":true}},"id":4}'
  sleep 2
) | ./eclipse-jdt-mcp 2>&1 | grep -E "(result|error)" | jq -r 'if .id == 4 then if .error then "ERROR: \(.error.message)" else if .result.callers then "SUCCESS: Found \(.result.callers | length) callers and \(.result.callees | length) callees" else .result end end else empty end' 2>/dev/null || true
