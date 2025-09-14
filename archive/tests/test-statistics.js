#!/usr/bin/env node

const { spawn } = require('child_process');

async function testStats() {
  const bridge = spawn('./eclipse-jdt-mcp', [], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let output = '';
  bridge.stdout.on('data', (data) => {
    output += data.toString();
  });

  // Send initialization requests
  const requests = [
    '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}',
    '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/frazier-life-sciences/backend"}},"id":2}',
    '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_classes","arguments":{}},"id":3}'
  ];

  for (const req of requests) {
    bridge.stdin.write(req + '\n');
    await new Promise(r => setTimeout(r, 3000));
  }

  bridge.stdin.end();
  await new Promise(r => setTimeout(r, 1000));

  // Parse responses
  const lines = output.split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const json = JSON.parse(line);

      if (json.id === 2) {
        console.log('\n=== Project Initialization ===');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('Mode:', data.mode);
          console.log('Total Types:', data.totalTypes);
          console.log('Total Packages:', data.totalPackages);
          console.log('Total Compilation Units:', data.totalCompilationUnits);
          console.log('Project:', data.projectName, 'at', data.location);

          if (data.totalTypes > 0) {
            console.log('✅ Project statistics working!');
          } else {
            console.log('⚠️ No types found');
          }
        }
      }

      if (json.id === 3) {
        console.log('\n=== Classes Found ===');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('Total classes:', data.totalCount);
          if (data.classes?.length > 0) {
            console.log('Sample classes:');
            data.classes.slice(0, 5).forEach(c => console.log('  -', c));
          }
        }
      }

    } catch (e) {}
  }

  process.exit(0);
}

testStats();