#!/bin/bash
echo "=== FULL TEST OF JAVA ANALYZER ==="
echo ""
echo "1. Testing initialize..."
(
  echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}'
  sleep 1
) | ./eclipse-jdt-mcp 2>/dev/null | jq -r '.result.serverInfo'

echo ""
echo "2. Testing tools/list..."
(
  echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}'
  sleep 1
  echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}'
  sleep 1
) | ./eclipse-jdt-mcp 2>/dev/null | jq -r '.result.tools | if . then length else "NO TOOLS" end'

echo ""
echo "3. Testing initialize_project..."
(
  echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}'
  sleep 1
  echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/java-mcp-server"}},"id":2}'
  sleep 2
) | ./eclipse-jdt-mcp 2>/dev/null | jq -r 'select(.id==2) | .result.mode'

echo ""
echo "4. Testing get_call_hierarchy..."
(
  echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}'
  sleep 1
  echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/java-mcp-server"}},"id":2}'
  sleep 2
  echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_call_hierarchy","arguments":{"class_name":"com.example.JavaMCPServer","method_name":"handleRequest","include_callers":true,"include_callees":true}},"id":3}'
  sleep 2
) | ./eclipse-jdt-mcp 2>/dev/null | jq -r 'select(.id==3) | if .result.callers then "FOUND CALLERS: \(.result.callers | length)" else if .error then "ERROR: \(.error.message)" else "NO RESULT" end end'
