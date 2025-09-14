#!/usr/bin/env node

const { spawn } = require('child_process');

async function testFullEclipse() {
  console.log('Testing Full Eclipse JDT Features...\n');

  const bridge = spawn('./eclipse-jdt-mcp', [], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let output = '';
  bridge.stdout.on('data', (data) => {
    output += data.toString();
  });

  bridge.stderr.on('data', (data) => {
    const msg = data.toString();
    if (!msg.includes('[Java]') && !msg.includes('Session')) {
      console.error('[stderr]', msg.trim());
    }
  });

  // Send requests
  const requests = [
    {
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' }
    },
    {
      id: 2,
      method: 'tools/call',
      params: {
        name: 'initialize_project',
        arguments: { project_path: '/Users/mwgreen/git-repos/frazier-life-sciences/backend' }
      }
    },
    {
      id: 3,
      method: 'tools/call',
      params: {
        name: 'get_type_hierarchy',
        arguments: { type_name: 'com.frazierlifesciences.service.ApprovalService' }
      }
    },
    {
      id: 4,
      method: 'tools/call',
      params: {
        name: 'find_references',
        arguments: {
          class_name: 'com.frazierlifesciences.service.ApprovalService',
          member_name: 'getPendingApprovals',
          parameter_types: ['Long'],
          element_type: 'method'
        }
      }
    }
  ];

  for (const req of requests) {
    console.log(`>>> Sending: ${req.method} (id: ${req.id})`);
    bridge.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      ...req
    }) + '\n');
    await new Promise(r => setTimeout(r, 3000));
  }

  bridge.stdin.end();

  // Wait for completion
  await new Promise(r => setTimeout(r, 2000));

  // Parse responses
  const lines = output.split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const json = JSON.parse(line);

      if (json.id === 2) {
        console.log('\n=== Initialize Project ===');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('Mode:', data.mode);
          console.log('Message:', data.message);
          if (data.mode === 'eclipse_workspace') {
            console.log('✓ Full Eclipse workspace initialized!');
          } else {
            console.log('⚠ Running in basic mode (Eclipse workspace not available)');
          }
        }
      }

      if (json.id === 3) {
        console.log('\n=== Type Hierarchy ===');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          if (data.error) {
            console.log('Error:', data.error);
          } else {
            console.log('Type:', data.type);
            console.log('Supertypes:', data.supertypes?.length || 0);
            console.log('Subtypes:', data.subtypes?.length || 0);
            console.log('Interfaces:', data.interfaces?.length || 0);
            if (data.supertypes?.length > 0) {
              console.log('✓ Type hierarchy working!');
            }
          }
        }
      }

      if (json.id === 4) {
        console.log('\n=== Find References ===');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          if (data.error) {
            console.log('Error:', data.error);
          } else if (data.references) {
            console.log('Total references found:', data.totalCount);
            if (data.totalCount > 0) {
              console.log('✓ Reference finding working!');
              data.references.slice(0, 3).forEach(ref => {
                console.log(`  - ${ref.className}:${ref.line}`);
              });
            }
          }
        }
      }

    } catch (e) {}
  }

  console.log('\n=== Test Complete ===');
  process.exit(0);
}

testFullEclipse().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});