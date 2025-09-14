const { spawn } = require('child_process');

function testServer(name, command, args) {
  console.log(`\n=== Testing ${name} ===`);
  
  const proc = spawn(command, args || [], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  let buffer = '';
  proc.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    
    lines.forEach(line => {
      if (line.trim()) {
        try {
          const msg = JSON.parse(line);
          console.log(`${name} response:`, JSON.stringify(msg).substring(0, 100) + '...');
        } catch (e) {}
      }
    });
  });
  
  proc.stderr.on('data', (data) => {
    // Ignore stderr
  });
  
  // Send initialization
  const init = {
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0.0"}
    },
    "id": 1
  };
  proc.stdin.write(JSON.stringify(init) + '\n');
  
  // Send initialized notification after 500ms
  setTimeout(() => {
    const initialized = {
      "jsonrpc": "2.0",
      "method": "notifications/initialized"
    };
    proc.stdin.write(JSON.stringify(initialized) + '\n');
  }, 500);
  
  // Send tools/list after 1s
  setTimeout(() => {
    const listTools = {
      "jsonrpc": "2.0",
      "method": "tools/list",
      "id": 2
    };
    proc.stdin.write(JSON.stringify(listTools) + '\n');
  }, 1000);
  
  // Kill after 2s
  setTimeout(() => {
    proc.kill();
  }, 2000);
}

// Test both
testServer('Playwright', 'npx', ['@playwright/mcp@latest']);
setTimeout(() => {
  testServer('Eclipse JDT', './eclipse-jdt-mcp');
}, 3000);
