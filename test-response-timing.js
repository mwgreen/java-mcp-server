const { spawn } = require('child_process');

const bridge = spawn('./eclipse-jdt-mcp', [], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let timings = {};

bridge.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(l => l.trim());
  lines.forEach(line => {
    try {
      const response = JSON.parse(line);
      if (response.id && timings[response.id]) {
        const elapsed = Date.now() - timings[response.id];
        console.log(`Response ${response.id}: ${elapsed}ms`);
      }
    } catch (e) {}
  });
});

async function test() {
  // Initialize
  timings[1] = Date.now();
  bridge.stdin.write('{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}\n');
  await new Promise(r => setTimeout(r, 1500));
  
  // Initialize project
  timings[2] = Date.now();
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/frazier-life-sciences"}},"id":2}\n');
  await new Promise(r => setTimeout(r, 6000));
  
  // List classes (fast operation)
  timings[3] = Date.now();
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_classes","arguments":{}},"id":3}\n');
  await new Promise(r => setTimeout(r, 2000));
  
  // Get call hierarchy (potentially slow)
  timings[4] = Date.now();
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_call_hierarchy","arguments":{"class_name":"com.frazierlifesciences.entity.User","method_name":"getEmail","include_callers":true,"include_callees":false}},"id":4}\n');
  await new Promise(r => setTimeout(r, 5000));
  
  bridge.stdin.end();
}

test();
