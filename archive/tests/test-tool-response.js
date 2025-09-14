const { spawn } = require('child_process');

const bridge = spawn('/Users/mwgreen/git-repos/java-mcp-server/eclipse-jdt-mcp', [], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let startTime;

bridge.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(l => l.trim());
  lines.forEach(line => {
    try {
      const response = JSON.parse(line);
      if (response.id === 3) {
        const elapsed = Date.now() - startTime;
        console.log(`Response received in ${elapsed}ms`);
        console.log('Response structure:');
        console.log('- Has result?', !!response.result);
        console.log('- Has error?', !!response.error);
        console.log('- Result keys:', response.result ? Object.keys(response.result) : 'N/A');
        console.log('- Response size:', JSON.stringify(response).length, 'bytes');
      }
    } catch (e) {}
  });
});

async function test() {
  // Initialize
  bridge.stdin.write('{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}\n');
  await new Promise(r => setTimeout(r, 1000));
  
  // Initialize project
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/frazier-life-sciences"}},"id":2}\n');
  await new Promise(r => setTimeout(r, 5000));
  
  // Call hierarchy - measure response time
  console.log('Sending get_call_hierarchy request...');
  startTime = Date.now();
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_call_hierarchy","arguments":{"class_name":"com.frazierlifesciences.entity.User","method_name":"getEmail","include_callers":true,"include_callees":true}},"id":3}\n');
  
  await new Promise(r => setTimeout(r, 10000)); // Wait longer
  bridge.stdin.end();
}

test();
