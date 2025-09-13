const { spawn } = require('child_process');

const bridge = spawn('/Users/mwgreen/git-repos/java-mcp-server/eclipse-jdt-mcp', [], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let responseCount = 0;

bridge.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(l => l.trim());
  lines.forEach(line => {
    try {
      const response = JSON.parse(line);
      responseCount++;
      console.log(`Response ${responseCount}:`, JSON.stringify(response).substring(0, 200));
      if (response.result) {
        if (response.result.callers || response.result.callees) {
          console.log('Call hierarchy found!');
          console.log('Callers:', response.result.callers ? response.result.callers.length : 0);
          console.log('Callees:', response.result.callees ? response.result.callees.length : 0);
        }
      }
      if (response.error) {
        console.log('ERROR:', response.error);
      }
    } catch (e) {}
  });
});

bridge.stderr.on('data', (data) => {
  console.error('Debug:', data.toString());
});

async function test() {
  console.log('1. Initializing...');
  bridge.stdin.write('{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}\n');
  await new Promise(r => setTimeout(r, 1000));
  
  console.log('2. Initializing project...');
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/frazier-life-sciences"}},"id":2}\n');
  await new Promise(r => setTimeout(r, 3000));
  
  console.log('3. Getting call hierarchy...');
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_call_hierarchy","arguments":{"class_name":"com.frazierlifesciences.entity.User","method_name":"getEmail","include_callers":true,"include_callees":true}},"id":3}\n');
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('4. Getting class info...');
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_class_info","arguments":{"class_name":"com.frazierlifesciences.entity.User"}},"id":4}\n');
  await new Promise(r => setTimeout(r, 2000));
  
  bridge.stdin.end();
}

test();
