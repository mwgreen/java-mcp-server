#!/bin/bash
echo "Testing MCP servers..."
claude mcp list | grep -A 5 java-analyzer

echo ""
echo "Testing tools list directly..."
(
  echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}'
  sleep 1
  echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}'
  sleep 1
) | ./eclipse-jdt-mcp 2>/dev/null | jq -r '.result.tools | if . then "Tools found: \(length) tools" else empty end'
