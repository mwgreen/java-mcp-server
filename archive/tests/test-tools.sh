#!/bin/bash
(
  echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}'
  sleep 2  # Wait for Java to start
  echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}'
  sleep 2  # Wait for response
) | ./eclipse-jdt-mcp 2>&1
