const { spawn } = require('child_process');
const readline = require('readline');

const bridge = spawn('./eclipse-jdt-mcp', [], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Handle responses
bridge.stdout.on('data', (data) => {
  console.log('Response:', data.toString());
});

// Handle errors
bridge.stderr.on('data', (data) => {
  console.error('Error:', data.toString());
});

// Send initialize
bridge.stdin.write('{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}\n');

// Wait then send tools/list
setTimeout(() => {
  console.log('Sending tools/list...');
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}\n');
  
  // Wait for response then exit
  setTimeout(() => {
    console.log('Closing...');
    bridge.stdin.end();
  }, 3000);
}, 3000);
