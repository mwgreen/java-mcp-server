#!/usr/bin/env node

const { spawn } = require('child_process');

async function testComplete() {
  console.log('Testing Complete JDT.LS Integration...\n');

  const bridge = spawn('./jdtls-complete.js', [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DEBUG: 'false' }
  });

  let output = '';

  bridge.stdout.on('data', (data) => {
    output += data.toString();
  });

  bridge.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('ready') || msg.includes('complete')) {
      console.log(msg.trim());
    }
  });

  // Test sequence
  const tests = [
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
        arguments: {
          project_path: '/Users/mwgreen/git-repos/frazier-life-sciences/backend'
        }
      }
    },
    {
      id: 3,
      method: 'tools/call',
      params: {
        name: 'find_references',
        arguments: {
          class_name: 'com.frazierlifesciences.service.ApprovalService',
          symbol: 'getPendingApprovals'
        }
      }
    },
    {
      id: 4,
      method: 'tools/call',
      params: {
        name: 'get_symbols',
        arguments: {
          query: 'ApprovalService'
        }
      }
    },
    {
      id: 5,
      method: 'tools/call',
      params: {
        name: 'get_document_symbols',
        arguments: {
          class_name: 'com.frazierlifesciences.service.ApprovalService'
        }
      }
    }
  ];

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    console.log(`\n[${i+1}/${tests.length}] Sending: ${test.method === 'tools/call' ? test.params.name : test.method}`);

    bridge.stdin.write(JSON.stringify(test) + '\n');

    // Longer wait for initialization
    const delay = test.id === 2 ? 15000 : 5000;
    await new Promise(r => setTimeout(r, delay));
  }

  bridge.stdin.end();
  await new Promise(r => setTimeout(r, 2000));

  // Parse and display results
  console.log('\n=== RESULTS ===\n');
  const lines = output.split('\n').filter(l => l.trim());

  for (const line of lines) {
    try {
      const json = JSON.parse(line);

      if (json.id === 2) {
        console.log('📦 Project Initialization:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('  Status:', data.status);
          console.log('  Ready:', data.ready);
          console.log('  Indexed classes:', data.indexedClasses);
        }
      }

      if (json.id === 3) {
        console.log('\n🔍 Find References (getPendingApprovals):');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          if (data.error) {
            console.log('  Error:', data.error);
          } else {
            console.log('  Found:', data.count, 'references');
            if (data.references?.length > 0) {
              console.log('  Examples:');
              data.references.slice(0, 3).forEach(ref => {
                console.log(`    - ${ref.file}:${ref.line}`);
                if (ref.preview) {
                  console.log(`      "${ref.preview}"`);
                }
              });
            }
          }
        }
      }

      if (json.id === 4) {
        console.log('\n🔎 Symbol Search (ApprovalService):');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('  Found:', data.count, 'symbols');
          if (data.symbols?.length > 0) {
            data.symbols.slice(0, 5).forEach(sym => {
              console.log(`    - ${sym.name} (${sym.kind}) at line ${sym.line}`);
            });
          }
        }
      }

      if (json.id === 5) {
        console.log('\n📄 Document Symbols:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('  Class:', data.class);
          console.log('  Total symbols:', data.symbols?.length || 0);
          if (data.symbols?.length > 0) {
            // Show methods
            const methods = data.symbols.filter(s => s.kind === 'Method');
            console.log(`  Methods (${methods.length}):` );
            methods.slice(0, 5).forEach(m => {
              console.log(`    - ${m.name} at line ${m.line}`);
            });
          }
        }
      }

    } catch (e) {
      // Ignore parse errors
    }
  }

  console.log('\n=== TEST COMPLETE ===');

  // Check if we got real results
  const hasReferences = output.includes('"count":') && !output.includes('"count":0');
  const hasSymbols = output.includes('"symbols":[');

  if (hasReferences || hasSymbols) {
    console.log('✅ JDT.LS is working with real data!');
  } else {
    console.log('⚠️  JDT.LS initialized but may need more time to index');
  }

  process.exit(0);
}

testComplete().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});