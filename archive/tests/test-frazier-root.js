#!/usr/bin/env node

const { spawn } = require('child_process');

async function test() {
  console.log('Testing Eclipse JDT.LS with Frazier Root Project');
  console.log('=================================================\n');

  const bridge = spawn('./jdtls-gradle.js', [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DEBUG: 'true' }
  });

  let output = '';

  bridge.stdout.on('data', (data) => {
    output += data.toString();
  });

  bridge.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('root') || msg.includes('Gradle') || msg.includes('wrapper') ||
        msg.includes('ERROR') || msg.includes('ready')) {
      console.log('[Debug]', msg.trim());
    }
  });

  // 1. Initialize MCP
  console.log('1. Initializing MCP...');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' }
  }) + '\n');

  await new Promise(r => setTimeout(r, 2000));

  // 2. Initialize with backend directory (should find root)
  console.log('\n2. Initializing with backend directory...');
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

  await new Promise(r => setTimeout(r, 3000));

  // 3. Wait for initialization
  console.log('\n3. Waiting 50 seconds for full Gradle import...');
  for (let i = 0; i < 50; i++) {
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
        project_path: '/Users/mwgreen/git-repos/frazier-life-sciences'
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

  // 6. Search for ApprovalService
  console.log('6. Searching for ApprovalService...');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'get_symbols',
      arguments: { query: 'ApprovalService' }
    }
  }) + '\n');

  await new Promise(r => setTimeout(r, 3000));

  bridge.kill();

  // Parse results
  console.log('\n=== RESULTS ===\n');
  const lines = output.split('\n').filter(l => l.trim());

  for (const line of lines) {
    try {
      const json = JSON.parse(line);

      if (json.id === 2) {
        console.log('Initial response (backend path):');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('- Status:', data.status);
          console.log('- Project:', data.project);
        }
      }

      if (json.id === 3) {
        console.log('\nStatus check:');
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
          console.log('- Total:', data.count);
          console.log('- Project:', data.projectClassCount);
          console.log('- JDK:', data.jdkClassCount);

          if (data.projectClassCount > 0) {
            console.log('\n✅ SUCCESS: Found', data.projectClassCount, 'project classes!');
            const frazierClasses = data.classes.filter(c =>
              c.startsWith('com.frazierlifesciences'));
            if (frazierClasses.length > 0) {
              console.log('\nSample Frazier classes:');
              frazierClasses.slice(0, 5).forEach(c => console.log('  -', c));
            }
          }
        }
      }

      if (json.id === 5) {
        console.log('\nApprovalService search:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('- Found:', data.count, 'symbols');
          if (data.symbols?.length > 0) {
            data.symbols.slice(0, 3).forEach(s => {
              console.log(`  - ${s.name} (${s.kind})`);
            });
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