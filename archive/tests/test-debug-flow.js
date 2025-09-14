#!/usr/bin/env node

const { spawn } = require('child_process');

async function test() {
  console.log('Testing message flow...\n');

  const bridge = spawn('./jdtls-gradle.js', [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DEBUG: 'true' }
  });

  let outputCount = 0;

  bridge.stdout.on('data', (data) => {
    const text = data.toString();
    console.log(`[STDOUT ${++outputCount}]`, text.substring(0, 200));
  });

  bridge.stderr.on('data', (data) => {
    const text = data.toString();
    if (text.includes('initializeProject') ||
        text.includes('Returning') ||
        text.includes('sendMCPToolResult')) {
      console.log('[DEBUG]', text.trim());
    }
  });

  // Initialize
  console.log('\n1. Sending initialize...');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' }
  }) + '\n');

  await new Promise(r => setTimeout(r, 3000));

  // Initialize a simple project
  console.log('\n2. Sending initialize_project for current directory...');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'initialize_project',
      arguments: {
        project_path: '/Users/mwgreen/git-repos/java-mcp-server'
      }
    }
  }) + '\n');

  // Wait longer for initialization
  console.log('\n3. Waiting for initialization...');
  await new Promise(r => setTimeout(r, 45000));

  // Try to list classes
  console.log('\n4. Sending list_classes...');
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

  bridge.kill();
  console.log('\nDone');
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});