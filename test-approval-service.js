#!/usr/bin/env node

const { spawn } = require('child_process');
const readline = require('readline');

const bridge = spawn('./eclipse-jdt-mcp', [], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let responseBuffer = '';

// Create interface for reading responses
const rl = readline.createInterface({
  input: bridge.stdout,
  crlfDelay: Infinity
});

// Track responses
const responses = new Map();

rl.on('line', (line) => {
  if (line.trim()) {
    try {
      const response = JSON.parse(line);
      if (response.id) {
        responses.set(response.id, response);
        console.log(`\n=== Response for request ${response.id} ===`);
        console.log(JSON.stringify(response, null, 2));
      }
    } catch (e) {
      console.error('Failed to parse:', line);
    }
  }
});

bridge.stderr.on('data', (data) => {
  // Log errors but don't fail
  const lines = data.toString().split('\n');
  lines.forEach(line => {
    if (line.trim() && !line.includes('[Java]')) {
      console.error(`[stderr] ${line}`);
    }
  });
});

async function sendRequest(id, method, params) {
  const request = {
    jsonrpc: "2.0",
    method: method,
    params: params,
    id: id
  };

  console.log(`\n>>> Sending request ${id}: ${method}`);
  bridge.stdin.write(JSON.stringify(request) + '\n');

  // Wait for response
  await new Promise(resolve => setTimeout(resolve, 2000));
}

async function test() {
  console.log('Starting MCP server test for ApprovalService...\n');

  // 1. Initialize
  await sendRequest(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {}
  });

  // 2. List tools to verify they're available
  await sendRequest(2, "tools/list", {});

  // 3. Initialize the project
  console.log('\n>>> Initializing project: /Users/mwgreen/git-repos/frazier-life-sciences/backend');
  await sendRequest(3, "tools/call", {
    name: "initialize_project",
    arguments: {
      project_path: "/Users/mwgreen/git-repos/frazier-life-sciences/backend"
    }
  });

  // Wait longer for project initialization
  await new Promise(resolve => setTimeout(resolve, 5000));

  // 4. List all classes to verify project loaded
  console.log('\n>>> Listing all classes in the project');
  await sendRequest(4, "tools/call", {
    name: "list_classes",
    arguments: {}
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  // 5. Get class info for ApprovalService
  console.log('\n>>> Getting info for ApprovalService');
  await sendRequest(5, "tools/call", {
    name: "get_class_info",
    arguments: {
      class_name: "com.frazierlifesciences.service.ApprovalService"
    }
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  // 6. Get method info for getPendingApprovals
  console.log('\n>>> Getting method info for getPendingApprovals');
  await sendRequest(6, "tools/call", {
    name: "get_method_info",
    arguments: {
      class_name: "com.frazierlifesciences.service.ApprovalService",
      method_name: "getPendingApprovals",
      parameter_types: ["java.lang.Long"]
    }
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  // 7. Get call hierarchy for getPendingApprovals
  console.log('\n>>> Getting call hierarchy for getPendingApprovals');
  await sendRequest(7, "tools/call", {
    name: "get_call_hierarchy",
    arguments: {
      class_name: "com.frazierlifesciences.service.ApprovalService",
      method_name: "getPendingApprovals",
      parameter_types: ["java.lang.Long"],
      include_callers: true,
      include_callees: true
    }
  });

  await new Promise(resolve => setTimeout(resolve, 3000));

  // 8. Find references to the method
  console.log('\n>>> Finding references to getPendingApprovals');
  await sendRequest(8, "tools/call", {
    name: "find_references",
    arguments: {
      class_name: "com.frazierlifesciences.service.ApprovalService",
      member_name: "getPendingApprovals",
      parameter_types: ["java.lang.Long"],
      element_type: "method"
    }
  });

  await new Promise(resolve => setTimeout(resolve, 3000));

  // 9. Get type hierarchy for ApprovalService
  console.log('\n>>> Getting type hierarchy for ApprovalService');
  await sendRequest(9, "tools/call", {
    name: "get_type_hierarchy",
    arguments: {
      type_name: "com.frazierlifesciences.service.ApprovalService"
    }
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n\n=== Test Complete ===');
  console.log('Closing connection...');

  bridge.stdin.end();

  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

// Handle errors
bridge.on('error', (err) => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});

bridge.on('exit', (code, signal) => {
  console.log(`MCP server exited with code ${code}, signal ${signal}`);
  process.exit(code || 0);
});

// Start the test
test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});