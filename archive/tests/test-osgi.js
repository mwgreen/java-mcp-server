const { spawn } = require('child_process');

const bridge = spawn('./eclipse-jdt-mcp', [], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Handle responses
bridge.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(l => l.trim());
  lines.forEach(line => {
    try {
      const response = JSON.parse(line);
      if (response.result) {
        console.log('Response:', JSON.stringify(response.result).substring(0, 200));
      }
    } catch (e) {}
  });
});

// Handle errors  
bridge.stderr.on('data', (data) => {
  const msg = data.toString();
  if (msg.includes('workspace') || msg.includes('OSGi') || msg.includes('mode')) {
    console.error('Debug:', msg.trim());
  }
});

// Send requests
async function test() {
  bridge.stdin.write('{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}\n');
  await new Promise(r => setTimeout(r, 1000));
  
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/java-mcp-server"}},"id":2}\n');
  await new Promise(r => setTimeout(r, 3000));
  
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_call_hierarchy","arguments":{"class_name":"com.example.JavaMCPServer","method_name":"handleRequest"}},"id":3}\n');
  await new Promise(r => setTimeout(r, 2000));
  
  bridge.stdin.end();
}

test();
