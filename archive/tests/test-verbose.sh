#!/bin/bash
(
  echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}'
  sleep 3  # More time for Java to start
  echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}'
  sleep 3  # More time for response
) | ./eclipse-jdt-mcp
