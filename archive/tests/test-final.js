#!/usr/bin/env node

const { spawn } = require('child_process');

async function test() {
  console.log('Testing JDT.LS Gradle Integration...\n');

  const bridge = spawn('./jdtls-gradle.js', [], {
    stdio: ['pipe', 'pipe', 'inherit']  // Show stderr directly
  });

  let output = '';
  bridge.stdout.on('data', (data) => {
    output += data.toString();
  });

  // Initialize
  console.log('1. Initialize MCP...');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' }
  }) + '\n');

  await new Promise(r => setTimeout(r, 2000));

  // Initialize project
  console.log('2. Initialize project (this may take 30 seconds)...');
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

  // Wait for initialization with progress indicator
  for (let i = 0; i < 30; i++) {
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('\n');

  // List classes
  console.log('3. List classes...');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'list_classes',
      arguments: {}
    }
  }) + '\n');

  await new Promise(r => setTimeout(r, 5000));

  bridge.kill();

  // Parse output
  console.log('\n=== RESULTS ===\n');
  const lines = output.split('\n').filter(l => l.trim());

  for (const line of lines) {
    try {
      const json = JSON.parse(line);

      if (json.id === 2) {
        console.log('Project initialization:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log(JSON.stringify(data, null, 2));
        }
      }

      if (json.id === 3) {
        console.log('\nClass indexing:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('- Total classes:', data.count);
          console.log('- Project classes:', data.projectClassCount);
          console.log('- JDK classes:', data.jdkClassCount);
          console.log('- Message:', data.message);

          if (data.projectClassCount > 0) {
            console.log('\n✅ SUCCESS: Project classes are indexed!');
          } else {
            console.log('\n⚠️  WARNING: No project classes found');
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