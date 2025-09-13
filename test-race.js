const { spawn } = require('child_process');

const bridge = spawn('./eclipse-jdt-mcp', [], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let responses = [];

bridge.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(l => l.trim());
  lines.forEach(line => {
    try {
      const response = JSON.parse(line);
      responses.push(response);
      const status = response.error ? 'ERROR' : 'OK';
      console.log(`Response: ${response.id || 'notification'} - ${status}`);
    } catch (e) {}
  });
});

async function test() {
  // Send initialize and tools/list almost simultaneously
  bridge.stdin.write('{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}\n');
  
  // Immediately send tools/list (before Java backend is ready)
  setTimeout(() => {
    bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/list","id":2}\n');
  }, 10); // Very short delay
  
  // Send tool call before project initialized
  setTimeout(() => {
    bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_classes","arguments":{}},"id":3}\n');
  }, 50);
  
  await new Promise(r => setTimeout(r, 3000));
  
  bridge.stdin.end();
  
  console.log('\n=== Response Order ===');
  responses.forEach((r, i) => {
    const status = r.error ? 'Error' : 'Success';
    console.log(`${i+1}. ID ${r.id}: ${status}`);
  });
}

test();