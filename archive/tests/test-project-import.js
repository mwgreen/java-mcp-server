#!/usr/bin/env node

const { spawn } = require('child_process');

async function testProjectImport() {
  console.log('Testing Gradle Project Import...\n');

  const bridge = spawn('./jdtls-gradle.js', [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DEBUG: 'true' }
  });

  let output = '';

  bridge.stdout.on('data', (data) => {
    output += data.toString();
  });

  bridge.stderr.on('data', (data) => {
    console.log('[DEBUG]', data.toString().trim());
  });

  // Wait for startup
  await new Promise(r => setTimeout(r, 2000));

  // Initialize MCP
  console.log('\n1. Initializing MCP...');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' }
  }) + '\n');

  await new Promise(r => setTimeout(r, 2000));

  // Initialize project
  console.log('\n2. Initializing project...');
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

  console.log('   Waiting 25 seconds for Gradle import...');
  await new Promise(r => setTimeout(r, 25000));

  // Try to list classes
  console.log('\n3. Listing indexed classes...');
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

  // Try to find a specific project class
  console.log('\n4. Searching for project classes...');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'get_symbols',
      arguments: {
        query: 'ApprovalService'
      }
    }
  }) + '\n');

  await new Promise(r => setTimeout(r, 3000));

  // Search for any Frazier classes
  console.log('\n5. Searching for Frazier classes...');
  bridge.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'get_symbols',
      arguments: {
        query: 'com.frazierlifesciences'
      }
    }
  }) + '\n');

  await new Promise(r => setTimeout(r, 3000));

  bridge.stdin.end();
  await new Promise(r => setTimeout(r, 2000));

  // Parse results
  console.log('\n=== RESULTS ===\n');
  const lines = output.split('\n').filter(l => l.trim());

  let projectClasses = [];
  let jdkClasses = [];

  for (const line of lines) {
    try {
      const json = JSON.parse(line);

      if (json.id === 2) {
        console.log('Project initialization:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('- Status:', data.status);
          console.log('- Project type:', data.projectType);
          console.log('- Ready:', data.ready);
          console.log('- Indexing status:', data.indexingStatus);
          if (data.sampleSymbols?.length > 0) {
            console.log('- Sample symbols:', data.sampleSymbols.slice(0, 5));
          }
        }
      }

      if (json.id === 3) {
        console.log('\nListed classes:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('- Total count:', data.count);

          if (data.classes) {
            data.classes.forEach(cls => {
              if (cls.startsWith('com.frazierlifesciences')) {
                projectClasses.push(cls);
              } else if (cls.startsWith('java.') || cls.startsWith('javax.')) {
                jdkClasses.push(cls);
              }
            });
          }
        }
      }

      if (json.id === 4) {
        console.log('\nApprovalService search:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('- Found:', data.count, 'matches');
          if (data.symbols?.length > 0) {
            data.symbols.slice(0, 3).forEach(s => {
              console.log(`  - ${s.name} (${s.containerName})`);
            });
          }
        }
      }

      if (json.id === 5) {
        console.log('\nFrazier package search:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('- Found:', data.count, 'matches');
          if (data.symbols?.length > 0) {
            data.symbols.slice(0, 5).forEach(s => {
              console.log(`  - ${s.name} in ${s.containerName || 'unknown'}`);
            });
          }
        }
      }

    } catch (e) {
      // Ignore parse errors
    }
  }

  console.log('\n=== ANALYSIS ===');
  console.log('Project classes found:', projectClasses.length);
  console.log('JDK classes found:', jdkClasses.length);

  if (projectClasses.length > 0) {
    console.log('\n✅ SUCCESS: Project classes are being indexed!');
    console.log('Sample project classes:');
    projectClasses.slice(0, 5).forEach(c => console.log('  -', c));
  } else {
    console.log('\n❌ PROBLEM: No project classes found');
    console.log('Only JDK classes are being indexed');
  }

  process.exit(0);
}

testProjectImport().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});