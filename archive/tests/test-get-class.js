const { spawn } = require('child_process');

const bridge = spawn('./eclipse-jdt-mcp', [], {
  stdio: ['pipe', 'pipe', 'pipe']
});

bridge.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(l => l.trim());
  lines.forEach(line => {
    try {
      const response = JSON.parse(line);
      if (response.id === 3) {
        console.log('get_class_info result:', JSON.stringify(response.result || response.error, null, 2));
      }
    } catch (e) {}
  });
});

bridge.stderr.on('data', (data) => {
  // Ignore stderr
});

async function test() {
  bridge.stdin.write('{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}\n');
  await new Promise(r => setTimeout(r, 1000));
  
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/java-mcp-server"}},"id":2}\n');
  await new Promise(r => setTimeout(r, 2000));
  
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_class_info","arguments":{"class_name":"com.example.BasicModeAnalyzer"}},"id":3}\n');
  await new Promise(r => setTimeout(r, 1000));
  
  bridge.stdin.end();
}

test();
