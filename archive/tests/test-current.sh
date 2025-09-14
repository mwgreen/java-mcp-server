#!/bin/bash
echo "=== Testing current Java analyzer behavior ==="
echo ""
echo "1. Testing initialize_project..."
(
  echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}'
  sleep 1
  echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/java-mcp-server"}},"id":2}'
  sleep 2
  echo "EXIT"
) | ./eclipse-jdt-mcp 2>&1 | grep -E "(result|error|ERROR)" | jq -r 'if .result then "SUCCESS: " + (.result | tostring | .[0:100]) elif .error then "ERROR: " + .error.message else . end' 2>/dev/null || cat

echo ""
echo "2. Testing get_call_hierarchy..."
(
  echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}'
  sleep 1
  echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/java-mcp-server"}},"id":2}'
  sleep 2
  echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_call_hierarchy","arguments":{"class_name":"com.example.JavaMCPServer","method_name":"handleRequest"}},"id":3}'
  sleep 2
) | ./eclipse-jdt-mcp 2>&1 | tail -5
