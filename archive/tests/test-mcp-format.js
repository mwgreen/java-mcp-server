#!/usr/bin/env node

const { spawn } = require('child_process');

async function testMCPFormat() {
  const bridge = spawn('./eclipse-jdt-mcp', [], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let output = '';
  bridge.stdout.on('data', (data) => {
    output += data.toString();
  });

  // Send requests
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

  // Wait for completion
  await new Promise(r => setTimeout(r, 2000));

  // Parse responses
  const lines = output.split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const json = JSON.parse(line);

      if (json.id === 2) {
        console.log('\n=== Initialize Project Response ===');
        console.log('Has result?', !!json.result);
        console.log('Has content?', !!json.result?.content);
        console.log('Has isError?', json.result?.hasOwnProperty('isError'));
        console.log('isError value:', json.result?.isError);

        if (json.result?.content?.[0]?.text) {
          const contentData = JSON.parse(json.result.content[0].text);
          console.log('Content preview:', {
            mode: contentData.mode,
            initialized: contentData.initialized,
            message: contentData.message
          });
        }
      }

      if (json.id === 3) {
        console.log('\n=== List Classes Response ===');
        console.log('Has result?', !!json.result);
        console.log('Has content?', !!json.result?.content);
        console.log('Has isError?', json.result?.hasOwnProperty('isError'));
        console.log('isError value:', json.result?.isError);

        if (json.result?.content?.[0]?.text) {
          const contentData = JSON.parse(json.result.content[0].text);
          console.log('Number of classes found:', contentData.totalCount);
          console.log('First 5 classes:', contentData.classes?.slice(0, 5));
        }
      }

    } catch (e) {}
  }

  process.exit(0);
}

testMCPFormat();