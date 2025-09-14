#!/usr/bin/env node

const { spawn } = require('child_process');

async function testDebug() {
  const bridge = spawn('./eclipse-jdt-mcp', [], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  bridge.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      try {
        const json = JSON.parse(line);
        console.log(`Response ${json.id}:`, JSON.stringify(json, null, 2));
      } catch (e) {}
    });
  });

  const requests = [
    '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}',
    '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/frazier-life-sciences/backend"}},"id":2}',
    '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_type_hierarchy","arguments":{"type_name":"com.frazierlifesciences.service.ApprovalService"}},"id":3}'
  ];

  for (const req of requests) {
    bridge.stdin.write(req + '\n');
    await new Promise(r => setTimeout(r, 2000));
  }

  await new Promise(r => setTimeout(r, 2000));
  bridge.stdin.end();

  setTimeout(() => process.exit(0), 1000);
}

testDebug();