#!/usr/bin/env node

const { spawn } = require('child_process');

async function test() {
  console.log('Testing initialization response...\n');

  const bridge = spawn('./jdtls-gradle.js', [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DEBUG: 'true' }
  });

  let output = '';
  bridge.stdout.on('data', (data) => {
    const text = data.toString();
    output += text;
    console.log('[STDOUT]', text.trim());
  });

  bridge.stderr.on('data', (data) => {
    // Don't print debug output
  });

  // Initialize
  console.log('\nSending initialize...');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' }
  }) + '\n');

  await new Promise(r => setTimeout(r, 3000));

  // Initialize project
  console.log('\nSending initialize_project...');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'initialize_project',
      arguments: {
        project_path: '/Users/mwgreen/git-repos/java-mcp-server'  // Use this project
      }
    }
  }) + '\n');

  await new Promise(r => setTimeout(r, 10000));

  bridge.kill();
  console.log('\nTest complete');
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});