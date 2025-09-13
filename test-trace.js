const { spawn } = require('child_process');
const fs = require('fs');

const bridge = spawn('/Users/mwgreen/git-repos/java-mcp-server/eclipse-jdt-mcp', [], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let log = [];

// Log everything
bridge.stdout.on('data', (data) => {
  const timestamp = new Date().toISOString();
  const msg = data.toString();
  log.push(`[${timestamp}] STDOUT: ${msg}`);
  console.log('STDOUT:', msg);
});

bridge.stderr.on('data', (data) => {
  const timestamp = new Date().toISOString();
  const msg = data.toString();
  log.push(`[${timestamp}] STDERR: ${msg}`);
  console.error('STDERR:', msg);
});

bridge.on('close', (code) => {
  console.log('Bridge closed with code:', code);
  fs.writeFileSync('mcp-trace.log', log.join('\n'));
});

// Simulate what Claude Code sends
async function simulate() {
  // 1. Initialize
  const init = {
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "claude-code",
        "version": "1.0.0"
      }
    },
    "id": 1
  };
  console.log('Sending:', JSON.stringify(init));
  bridge.stdin.write(JSON.stringify(init) + '\n');
  await new Promise(r => setTimeout(r, 1000));
  
  // 2. Initialized notification
  const initialized = {
    "jsonrpc": "2.0",
    "method": "notifications/initialized"
  };
  console.log('Sending:', JSON.stringify(initialized));
  bridge.stdin.write(JSON.stringify(initialized) + '\n');
  await new Promise(r => setTimeout(r, 1000));
  
  // 3. List tools
  const listTools = {
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 2
  };
  console.log('Sending:', JSON.stringify(listTools));
  bridge.stdin.write(JSON.stringify(listTools) + '\n');
  await new Promise(r => setTimeout(r, 2000));
  
  // 4. Call a tool
  const callTool = {
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "initialize_project",
      "arguments": {
        "project_path": "/Users/mwgreen/git-repos/java-mcp-server"
      }
    },
    "id": 3
  };
  console.log('Sending:', JSON.stringify(callTool));
  bridge.stdin.write(JSON.stringify(callTool) + '\n');
  await new Promise(r => setTimeout(r, 3000));
  
  bridge.stdin.end();
}

simulate();
