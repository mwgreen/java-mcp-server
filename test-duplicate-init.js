const { spawn } = require('child_process');

const bridge = spawn('./eclipse-jdt-mcp', [], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let responseCount = {};

bridge.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(l => l.trim());
  lines.forEach(line => {
    try {
      const response = JSON.parse(line);
      if (response.id) {
        responseCount[response.id] = (responseCount[response.id] || 0) + 1;
        console.log(`Response for ID ${response.id}: count=${responseCount[response.id]}`);
      }
    } catch (e) {}
  });
});

async function test() {
  // First initialize
  bridge.stdin.write('{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}\n');
  await new Promise(r => setTimeout(r, 2000));
  
  // Second initialize (simulating reconnect)
  bridge.stdin.write('{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":2}\n');
  await new Promise(r => setTimeout(r, 1000));
  
  // Third initialize
  bridge.stdin.write('{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":3}\n');
  await new Promise(r => setTimeout(r, 1000));
  
  bridge.stdin.end();
  
  // Check for duplicates
  console.log('\n=== Duplicate Check ===');
  for (const [id, count] of Object.entries(responseCount)) {
    if (count > 1) {
      console.log(`ERROR: ID ${id} received ${count} responses (duplicate!)`);
    } else {
      console.log(`OK: ID ${id} received exactly 1 response`);
    }
  }
}

test();
