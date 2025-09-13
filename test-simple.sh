#!/bin/bash
echo "Testing direct Java calls..."

# Test 1: Initialize and get project info
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}' | java -jar target/java-mcp-server-1.0.0.jar 2>&1 | grep -E "(result|error)" | head -5

echo ""
echo "Java server seems to work. Now testing through bridge..."

# Test 2: Through bridge
(
  echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}'
  sleep 2
  echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/java-mcp-server"}},"id":2}'
  sleep 3
) | ./eclipse-jdt-mcp 2>&1 | grep -E "(result|error|Exception|Failed)" 
