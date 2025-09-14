#!/usr/bin/env node

const { spawn } = require('child_process');

async function testGradleIndexing() {
  console.log('Testing Gradle Project Indexing...\n');

  const bridge = spawn('./jdtls-gradle.js', [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DEBUG: 'false' }
  });

  let output = '';
  let ready = false;

  bridge.stdout.on('data', (data) => {
    output += data.toString();
  });

  bridge.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('ready')) {
      ready = true;
      console.log('✓ JDT.LS started');
    }
  });

  // Wait for ready
  while (!ready) {
    await new Promise(r => setTimeout(r, 100));
  }

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
        name: 'list_classes',
        arguments: {}
      }
    }
  ];

  for (const test of tests) {
    console.log(`\nSending: ${test.method === 'tools/call' ? test.params.name : test.method}`);
    bridge.stdin.write(JSON.stringify(test) + '\n');

    // Longer wait for project initialization
    const delay = test.id === 2 ? 20000 : 3000;
    await new Promise(r => setTimeout(r, delay));
  }

  bridge.stdin.end();
  await new Promise(r => setTimeout(r, 2000));

  // Parse results
  console.log('\n=== INDEXING RESULTS ===\n');
  const lines = output.split('\n').filter(l => l.trim());

  let projectClasses = 0;
  let jdkClasses = 0;
  let totalClasses = 0;

  for (const line of lines) {
    try {
      const json = JSON.parse(line);

      if (json.id === 2) {
        console.log('📦 Project Initialization:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          console.log('  Status:', data.status);
          console.log('  Project type:', data.projectType);
          console.log('  Build file:', data.buildFile);
          console.log('  Indexed classes:', data.indexedClasses);
        }
      }

      if (json.id === 3) {
        console.log('\n📊 Class Analysis:');
        if (json.result?.content?.[0]?.text) {
          const data = JSON.parse(json.result.content[0].text);
          totalClasses = data.count;

          if (data.classes) {
            // Count project vs JDK classes
            data.classes.forEach(cls => {
              if (cls.startsWith('com.frazierlifesciences') ||
                  cls.startsWith('com.example') ||
                  !cls.startsWith('java.') && !cls.startsWith('javax.') && !cls.startsWith('jdk.')) {
                projectClasses++;
              } else {
                jdkClasses++;
              }
            });

            console.log('  Total classes:', totalClasses);
            console.log('  Project classes:', projectClasses);
            console.log('  JDK/Library classes:', jdkClasses);

            // Show sample project classes
            const projectClassList = data.classes.filter(c =>
              c.startsWith('com.frazierlifesciences'));

            if (projectClassList.length > 0) {
              console.log('\n  Sample project classes:');
              projectClassList.slice(0, 10).forEach(cls => {
                console.log('    -', cls);
              });
            }
          }
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  console.log('\n=== ANALYSIS ===');

  if (projectClasses > 10) {
    console.log('✅ SUCCESS: Found', projectClasses, 'project classes!');
    console.log('   JDT.LS is properly indexing the Gradle project.');
  } else if (totalClasses === 79) {
    console.log('❌ PROBLEM: Still only indexing 79 JDK classes');
    console.log('   Project source files are not being indexed.');
  } else if (projectClasses === 0 && jdkClasses > 0) {
    console.log('⚠️  PARTIAL: Found', jdkClasses, 'JDK classes but no project classes');
    console.log('   Build import may have failed.');
  } else {
    console.log('🔍 Indexed', totalClasses, 'total classes');
    console.log('   Project classes:', projectClasses);
  }

  process.exit(0);
}

testGradleIndexing().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});