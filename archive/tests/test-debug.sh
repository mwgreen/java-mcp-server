#!/bin/bash
echo "=== Debugging BasicModeAnalyzer ==="

# Add debug output to see what's happening
(
  echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}'
  sleep 1
  echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/frazier-life-sciences"}},"id":2}'
  sleep 2
  echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_classes","arguments":{}},"id":3}'
  sleep 1
) | java -Dorg.slf4j.simpleLogger.defaultLogLevel=info -jar target/java-mcp-server-1.0.0.jar 2>&1 | grep -E "(Scanned|INFO)" | head -10
