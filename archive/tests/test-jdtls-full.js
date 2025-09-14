#!/usr/bin/env node

const { spawn } = require('child_process');

async function testJDTLS() {
  console.log('Testing Full JDT.LS Integration...\n');

  const bridge = spawn('./jdtls-mcp-full.js', [], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let output = '';

  bridge.stdout.on('data', (data) => {
    output += data.toString();
  });

  bridge.stderr.on('data', (data) => {
    console.log('[Debug]', data.toString().trim());
  });

  // Test sequence
  const requests = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' }
    },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'initialize_project',
        arguments: { project_path: '/Users/mwgreen/git-repos/frazier-life-sciences/backend' }
      }
    },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'find_references',
        arguments: {
          class_name: 'com.frazierlifesciences.service.ApprovalService',
          method_name: 'getPendingApprovals'
        }
      }
    },
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'get_workspace_symbols',
        arguments: { query: 'ApprovalService' }
      }
    }
  ];

  // Send requests with delays
  for (const req of requests) {
    console.log(`\nSending: ${req.method} (id: ${req.id})`);
    bridge.stdin.write(JSON.stringify(req) + '\n');

    // Longer wait for initialization
    const delay = req.id === 2 ? 10000 : 3000;
    await new Promise(r => setTimeout(r, delay));
  }

  bridge.stdin.end();
  await new Promise(r => setTimeout(r, 2000));

  // Parse results
  console.log('\n=== Results ===\n');
  const lines = output.split('\n').filter(l => l.trim());

  for (const line of lines) {
    try {
      const json = JSON.parse(line);

      if (json.id === 2) {
        console.log('Project Initialization:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('- Status:', data.status);
          console.log('- Mode:', data.mode);
          console.log('- Ready:', data.ready);
        }
      }

      if (json.id === 3) {
        console.log('\nFind References:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          if (data.error) {
            console.log('- Error:', data.error);
          } else {
            console.log('- Symbol:', data.symbol);
            console.log('- References found:', data.count);
            if (data.references?.length > 0) {
              console.log('- Sample:', data.references[0]);
            }
          }
        }
      }

      if (json.id === 4) {
        console.log('\nWorkspace Symbols:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          if (data.error) {
            console.log('- Error:', data.error);
          } else {
            console.log('- Query:', data.query);
            console.log('- Symbols found:', data.count);
            if (data.symbols?.length > 0) {
              data.symbols.slice(0, 3).forEach(s => {
                console.log(`  - ${s.name} (${s.kind})`);
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

testJDTLS().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});