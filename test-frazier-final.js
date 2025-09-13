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
        console.log('Classes found:', response.result.classes ? response.result.classes.length : 0);
        if (response.result.classes && response.result.classes.includes('com.frazierlifesciences.entity.StockPosition')) {
          console.log('✓ StockPosition found!');
        } else {
          console.log('✗ StockPosition NOT found');
          if (response.result.classes) {
            console.log('Sample classes:', response.result.classes.slice(0, 5));
          }
        }
      }
      if (response.id === 4) {
        console.log('Call hierarchy result:', response.error ? `ERROR: ${response.error.message}` : 
          `Found ${response.result.callers ? response.result.callers.length : 0} callers`);
      }
    } catch (e) {}
  });
});

async function test() {
  bridge.stdin.write('{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}\n');
  await new Promise(r => setTimeout(r, 1000));
  
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/frazier-life-sciences"}},"id":2}\n');
  await new Promise(r => setTimeout(r, 3000));
  
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_classes","arguments":{}},"id":3}\n');
  await new Promise(r => setTimeout(r, 2000));
  
  bridge.stdin.write('{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_call_hierarchy","arguments":{"class_name":"com.frazierlifesciences.entity.StockPosition","method_name":"setFund","include_callers":true,"include_callees":true}},"id":4}\n');
  await new Promise(r => setTimeout(r, 2000));
  
  bridge.stdin.end();
}

test();
