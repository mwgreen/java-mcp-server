#!/usr/bin/env node

const { spawn } = require('child_process');

async function testMCP() {
  const bridge = spawn('./eclipse-jdt-mcp', [], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let output = '';
  bridge.stdout.on('data', (data) => {
    output += data.toString();
  });

  // Send requests
  const requests = [
    '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}',
    '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/frazier-life-sciences/backend"}},"id":2}',
    '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_class_info","arguments":{"class_name":"com.frazierlifesciences.service.ApprovalService"}},"id":3}'
  ];

  for (const req of requests) {
    bridge.stdin.write(req + '\n');
    await new Promise(r => setTimeout(r, 3000));
  }

  bridge.stdin.end();

  // Wait for completion
  await new Promise(r => setTimeout(r, 2000));

  // Parse and display the class info response
  const lines = output.split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const json = JSON.parse(line);
      if (json.id === 3) {
        console.log('Class Info Response:');
        console.log(JSON.stringify(json.result, null, 2));

        if (json.result.methods) {
          console.log('\nMethods found:', json.result.methods.length);
          json.result.methods.forEach(m => {
            console.log(`  - ${m.name}(${m.parameters ? m.parameters.join(', ') : ''})`);
          });
        } else {
          console.log('\nNo methods found!');
        }
      }
    } catch (e) {}
  }

  process.exit(0);
}

testMCP();