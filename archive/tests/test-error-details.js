const { spawn } = require('child_process');

const bridge = spawn('./eclipse-jdt-mcp', [], {
  stdio: ['pipe', 'pipe', 'pipe']
});

bridge.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(l => l.trim());
  lines.forEach(line => {
    try {
      const response = JSON.parse(line);
      if (response.id === 3 && response.error) {
        console.log('Error response:', JSON.stringify(response.error, null, 2));
      }
    } catch (e) {}
  });
});

// Send request before project initialized
bridge.stdin.write('{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}\n');
setTimeout(() => {
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_classes","arguments":{}},"id":3}\n');
}, 50);

setTimeout(() => bridge.stdin.end(), 2000);
