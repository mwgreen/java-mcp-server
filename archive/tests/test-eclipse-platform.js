#!/usr/bin/env node

const { spawn } = require('child_process');

async function testEclipsePlatform() {
  console.log('Testing Full Eclipse Platform Integration...\n');

  const bridge = spawn('./eclipse-jdt-mcp', [], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let output = '';
  let errors = [];

  bridge.stdout.on('data', (data) => {
    output += data.toString();
  });

  bridge.stderr.on('data', (data) => {
    const msg = data.toString();
    errors.push(msg);
    // Log important messages
    if (msg.includes('Eclipse platform') || msg.includes('OSGi') || msg.includes('workspace')) {
      console.log('[Eclipse]', msg.trim());
    }
  });

  // Send initialization requests
  const requests = [
    '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}',
    '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/frazier-life-sciences/backend"}},"id":2}'
  ];

  for (const req of requests) {
    bridge.stdin.write(req + '\n');
    await new Promise(r => setTimeout(r, 5000)); // Give more time for Eclipse to start
  }

  // Test advanced features
  const advancedTests = [
    {
      id: 3,
      name: 'get_type_hierarchy',
      arguments: { type_name: 'com.frazierlifesciences.service.ApprovalService' }
    },
    {
      id: 4,
      name: 'find_references',
      arguments: {
        class_name: 'com.frazierlifesciences.service.ApprovalService',
        member_name: 'getPendingApprovals',
        parameter_types: ['Long'],
        element_type: 'method'
      }
    }
  ];

  for (const test of advancedTests) {
    const req = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: test.name, arguments: test.arguments },
      id: test.id
    });
    bridge.stdin.write(req + '\n');
    await new Promise(r => setTimeout(r, 3000));
  }

  bridge.stdin.end();
  await new Promise(r => setTimeout(r, 2000));

  // Parse responses
  console.log('\n=== Results ===\n');
  const lines = output.split('\n').filter(l => l.trim());
  let eclipseMode = false;

  for (const line of lines) {
    try {
      const json = JSON.parse(line);

      if (json.id === 2) {
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('Initialization Mode:', data.mode);

          if (data.mode === 'eclipse_workspace') {
            console.log('✅ FULL ECLIPSE WORKSPACE ACTIVE!');
            eclipseMode = true;
          } else if (data.mode === 'basic_file_analysis') {
            console.log('⚠️ Still in basic mode');
            console.log('Note:', data.note);
          }

          console.log('Statistics:', {
            types: data.totalTypes,
            packages: data.totalPackages,
            compilationUnits: data.totalCompilationUnits
          });
        }
      }

      if (json.id === 3) {
        console.log('\n--- Type Hierarchy Test ---');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          if (data.error) {
            console.log('Status:', data.error);
          } else if (data.supertypes || data.subtypes) {
            console.log('✅ Type hierarchy working!');
            console.log('Supertypes:', data.supertypes?.length || 0);
            console.log('Subtypes:', data.subtypes?.length || 0);
          }
        }
      }

      if (json.id === 4) {
        console.log('\n--- Find References Test ---');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          if (data.error) {
            console.log('Status:', data.error);
          } else if (data.references) {
            console.log('✅ Reference finding working!');
            console.log('Total references:', data.totalCount);
          }
        }
      }

    } catch (e) {}
  }

  // Check for Eclipse/OSGi errors
  const eclipseErrors = errors.filter(e =>
    e.includes('OSGi') ||
    e.includes('bundle') ||
    e.includes('Eclipse')
  );

  if (eclipseErrors.length > 0) {
    console.log('\n--- Eclipse Platform Messages ---');
    eclipseErrors.slice(0, 5).forEach(e => console.log(e.trim()));
  }

  console.log('\n=== Test Complete ===');
  console.log('Mode achieved:', eclipseMode ? 'FULL ECLIPSE' : 'BASIC');

  process.exit(0);
}

testEclipsePlatform().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});