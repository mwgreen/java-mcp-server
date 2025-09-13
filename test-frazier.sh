#!/bin/bash
echo "Testing with frazier-life-sciences project..."
START=$SECONDS

(
  echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}'
  sleep 1
  echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/frazier-life-sciences"}},"id":2}'
  sleep 3
  echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_call_hierarchy","arguments":{"class_name":"com.frazierlifesciences.entity.StockPosition","method_name":"setFund","parameter_types":["com.frazierlifesciences.entity.Fund"],"include_callers":true,"include_callees":true}},"id":3}'
  sleep 5
) | ./eclipse-jdt-mcp 2>&1 &

PID=$!
sleep 15
if ps -p $PID > /dev/null; then
    echo "Process still running after 15 seconds, killing..."
    kill $PID
else
    wait $PID
fi

ELAPSED=$((SECONDS - START))
echo "Total time: ${ELAPSED} seconds"
