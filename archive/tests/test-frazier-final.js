#!/usr/bin/env node

const { spawn } = require('child_process');

async function test() {
  console.log('Testing Eclipse JDT.LS with Frazier Project');
  console.log('=============================================\n');

  const bridge = spawn('./jdtls-gradle.js', [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DEBUG: 'false' }
  });

  let output = '';

  bridge.stdout.on('data', (data) => {
    output += data.toString();
  });

  bridge.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('ready')) {
      console.log('[Server]', msg.trim());
    }
  });

  // 1. Initialize MCP
  console.log('1. Initializing MCP protocol...');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' }
  }) + '\n');

  await new Promise(r => setTimeout(r, 2000));

  // 2. Initialize project (will start in background)
  console.log('2. Starting JDT.LS for Frazier project...');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'initialize_project',
      arguments: {
        project_path: '/Users/mwgreen/git-repos/frazier-life-sciences/backend'
      }
    }
  }) + '\n');

  await new Promise(r => setTimeout(r, 2000));

  // 3. Wait for initialization
  console.log('3. Waiting 40 seconds for JDT.LS to initialize...');
  for (let i = 0; i < 40; i++) {
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(' Done!\n');

  // 4. Check status
  console.log('4. Checking status...');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'initialize_project',
      arguments: {
        project_path: '/Users/mwgreen/git-repos/frazier-life-sciences/backend'
      }
    }
  }) + '\n');

  await new Promise(r => setTimeout(r, 3000));

  // 5. List classes
  console.log('5. Listing classes...');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'list_classes',
      arguments: {}
    }
  }) + '\n');

  await new Promise(r => setTimeout(r, 5000));

  bridge.kill();

  // Parse results
  console.log('\n=== RESULTS ===\n');
  const lines = output.split('\n').filter(l => l.trim());

  for (const line of lines) {
    try {
      const json = JSON.parse(line);

      if (json.id === 2) {
        console.log('Initial response:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('- Status:', data.status);
          console.log('- Message:', data.message);
        }
      }

      if (json.id === 3) {
        console.log('\nAfter wait:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('- Status:', data.status);
          console.log('- Ready:', data.ready);
        }
      }

      if (json.id === 4) {
        console.log('\nClasses:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          if (data.error) {
            console.log('- Error:', data.error);
          } else {
            console.log('- Total:', data.count);
            console.log('- Project:', data.projectClassCount);
            console.log('- JDK:', data.jdkClassCount);
            if (data.projectClassCount > 0) {
              console.log('\n✅ SUCCESS!');
            }
          }
        }
      }
    } catch (e) {}
  }
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
