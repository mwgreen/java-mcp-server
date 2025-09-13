#!/usr/bin/env node

const { spawn } = require('child_process');

async function testCallHierarchy() {
  const bridge = spawn('./eclipse-jdt-mcp', [], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let output = '';
  bridge.stdout.on('data', (data) => {
    output += data.toString();
  });

  bridge.stderr.on('data', (data) => {
    // Suppress stderr unless it's an error
    const msg = data.toString();
    if (msg.includes('ERROR') || msg.includes('Failed')) {
      console.error(msg);
    }
  });

  // Send requests
  const requests = [
    '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}',
    '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"initialize_project","arguments":{"project_path":"/Users/mwgreen/git-repos/frazier-life-sciences/backend"}},"id":2}',
    // Test with just "Long" as parameter type (as shown in the class info)
    '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_call_hierarchy","arguments":{"class_name":"com.frazierlifesciences.service.ApprovalService","method_name":"getPendingApprovals","parameter_types":["Long"],"include_callers":true,"include_callees":true}},"id":3}',
    // Also test finding references
    '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"find_references","arguments":{"class_name":"com.frazierlifesciences.service.ApprovalService","member_name":"getPendingApprovals","parameter_types":["Long"],"element_type":"method"}},"id":4}',
    // Test type hierarchy
    '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_type_hierarchy","arguments":{"type_name":"com.frazierlifesciences.service.ApprovalService"}},"id":5}'
  ];

  for (const req of requests) {
    bridge.stdin.write(req + '\n');
    await new Promise(r => setTimeout(r, 2000));
  }

  bridge.stdin.end();

  // Wait for completion
  await new Promise(r => setTimeout(r, 2000));

  // Parse responses
  const lines = output.split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const json = JSON.parse(line);

      if (json.id === 3) {
        console.log('\n=== Call Hierarchy for getPendingApprovals ===');
        if (json.result) {
          console.log(JSON.stringify(json.result, null, 2));
        } else if (json.error) {
          console.log('Error:', json.error.message);
        }
      }

      if (json.id === 4) {
        console.log('\n=== References to getPendingApprovals ===');
        if (json.result) {
          if (json.result.references) {
            console.log(`Found ${json.result.totalCount} references:`);
            json.result.references.forEach(ref => {
              console.log(`  - ${ref.className}:${ref.line} in ${ref.methodName || 'unknown'}`);
            });
          } else {
            console.log(JSON.stringify(json.result, null, 2));
          }
        } else if (json.error) {
          console.log('Error:', json.error.message);
        }
      }

      if (json.id === 5) {
        console.log('\n=== Type Hierarchy for ApprovalService ===');
        if (json.result) {
          console.log(JSON.stringify(json.result, null, 2));
        } else if (json.error) {
          console.log('Error:', json.error.message);
        }
      }

    } catch (e) {}
  }

  process.exit(0);
}

testCallHierarchy();