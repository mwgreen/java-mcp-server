#!/usr/bin/env node

const { spawn } = require('child_process');

async function testWithDebug() {
  console.log('Testing with full debug output...\n');

  const bridge = spawn('./jdtls-gradle.js', [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DEBUG: 'true' }  // Enable debug
  });

  let output = '';

  bridge.stdout.on('data', (data) => {
    const text = data.toString();
    output += text;
    // Show all output immediately
    console.log('[STDOUT]', text.trim());
  });

  bridge.stderr.on('data', (data) => {
    console.log('[STDERR]', data.toString().trim());
  });

  // Simple test
  const tests = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' }
    },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'initialize_project',
        arguments: {
          project_path: '/Users/mwgreen/git-repos/frazier-life-sciences/backend'
        }
      }
    }
  ];

  await new Promise(r => setTimeout(r, 2000)); // Wait for startup

  for (const test of tests) {
    console.log(`\n>>> Sending: ${JSON.stringify(test)}\n`);
    bridge.stdin.write(JSON.stringify(test) + '\n');

    const delay = test.id === 2 ? 25000 : 3000;
    await new Promise(r => setTimeout(r, delay));
  }

  console.log('\n>>> Sending list_classes request\n');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'list_classes',
      arguments: {}
    }
  }) + '\n');

  await new Promise(r => setTimeout(r, 5000));

  bridge.stdin.end();
  await new Promise(r => setTimeout(r, 2000));

  process.exit(0);
}

testWithDebug().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});