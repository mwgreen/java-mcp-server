const { spawn } = require('child_process');
const path = require('path');

console.log('Testing Java Analyzer MCP...\n');

const bridge = spawn('./eclipse-jdt-mcp', [], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let responseCount = 0;
const startTime = Date.now();

// Handle responses
bridge.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(l => l.trim());
  lines.forEach(line => {
    try {
      const response = JSON.parse(line);
      responseCount++;
      console.log(`Response ${responseCount} (${Date.now() - startTime}ms):`, 
        response.error ? `ERROR: ${response.error.message}` : 
        response.result ? Object.keys(response.result).join(', ') : 'notification');
      
      if (response.id === 3) {
        console.log('Call hierarchy response received');
        if (response.result) {
          console.log('Callers:', response.result.callers?.length || 0);
          console.log('Callees:', response.result.callees?.length || 0);
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  });
});

// Handle errors
bridge.stderr.on('data', (data) => {
  console.error('Debug:', data.toString().trim());
});

// Send requests
async function sendRequests() {
  // Initialize
  console.log('1. Sending initialize...');
  bridge.stdin.write('{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}\n');
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Initialize project
  console.log('2. Sending initialize_project...');
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/frazier-life-sciences"}},"id":2}\n');
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Get call hierarchy
  console.log('3. Sending get_call_hierarchy...');
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_call_hierarchy","arguments":{"class_name":"com.frazierlifesciences.entity.StockPosition","method_name":"setFund","parameter_types":["com.frazierlifesciences.entity.Fund"],"include_callers":true,"include_callees":true}},"id":3}\n');
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Get type hierarchy
  console.log('4. Sending get_type_hierarchy...');
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_type_hierarchy","arguments":{"type_name":"com.frazierlifesciences.entity.StockPosition"}},"id":4}\n');
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log(`\nTotal time: ${Date.now() - startTime}ms`);
  bridge.stdin.end();
}

sendRequests();
