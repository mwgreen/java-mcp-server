#!/usr/bin/env node

const { spawn } = require('child_process');

console.log('Starting JDT.LS process...');

const bridge = spawn('./jdtls-gradle.js', [], {
  stdio: ['pipe', 'pipe', 'inherit'],  // Show stderr directly
  env: { ...process.env, DEBUG: 'true' }
});

// Just send initialize and see what happens
setTimeout(() => {
  console.log('Sending initialize...');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' }
  }) + '\n');
}, 1000);

// Show stdout
bridge.stdout.on('data', (data) => {
  console.log('Response:', data.toString());
});

// Exit after 5 seconds
setTimeout(() => {
  console.log('Ending test');
  bridge.kill();
  process.exit(0);
}, 5000);