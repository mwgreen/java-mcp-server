const { spawn } = require('child_process');

const bridge = spawn('./eclipse-jdt-mcp', [], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let responses = [];
let buffer = '';

bridge.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();
  
  lines.forEach(line => {
    if (line.trim()) {
      // Check if line is valid JSON
      try {
        JSON.parse(line);
        console.log('✓ Valid JSON response');
      } catch (e) {
        console.log('✗ INVALID OUTPUT (stdout pollution):', line);
      }
      responses.push(line);
    }
  });
});

bridge.stderr.on('data', (data) => {
  // This is OK - stderr is for logging
});

async function test() {
  // Initialize
  bridge.stdin.write('{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}\n');
  await new Promise(r => setTimeout(r, 1000));
  
  // Initialized notification
  bridge.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  await new Promise(r => setTimeout(r, 500));
  
  // Initialize project (this triggers workspace setup)
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/frazier-life-sciences"}},"id":2}\n');
  await new Promise(r => setTimeout(r, 5000));
  
  // Call hierarchy 
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_call_hierarchy","arguments":{"class_name":"com.frazierlifesciences.entity.User","method_name":"getEmail","include_callers":true,"include_callees":false}},"id":3}\n');
  await new Promise(r => setTimeout(r, 3000));
  
  bridge.stdin.end();
  
  // Final check
  console.log('\n=== Summary ===');
  console.log('Total responses:', responses.length);
  responses.forEach((r, i) => {
    try {
      const obj = JSON.parse(r);
      console.log(`Response ${i+1}: ${obj.method || 'result'} (id: ${obj.id})`);
    } catch (e) {
      console.log(`Response ${i+1}: INVALID JSON`);
    }
  });
}

test();
