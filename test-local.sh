#!/bin/bash
echo "Testing with java-mcp-server project..."
(
  echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}'
  sleep 1
  echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/java-mcp-server"}},"id":2}'
  sleep 2
  echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_call_hierarchy","arguments":{"class_name":"com.example.JavaMCPServer","method_name":"handleRequest","include_callers":true,"include_callees":true}},"id":3}'
  sleep 3
) | ./eclipse-jdt-mcp 2>&1 | grep -E "(result|error)" | tail -2
