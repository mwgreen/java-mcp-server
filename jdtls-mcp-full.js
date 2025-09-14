#!/usr/bin/env node

/**
 * Complete MCP Server with full Eclipse JDT.LS integration
 * This implements actual LSP communication for real Java analysis
 */

const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Configuration
const JDTLS_HOME = path.join(__dirname, 'eclipse-jdtls');
const WORKSPACE = path.join('/tmp', 'jdtls-workspace-' + crypto.randomBytes(4).toString('hex'));

// State
let jdtlsProcess = null;
let jdtlsReady = false;
let currentProject = null;
let lspRequestId = 1;
let lspResponseHandlers = new Map();
let documentCache = new Map(); // Cache file contents
let projectFiles = new Map(); // Track project files

// LSP Message helpers
function sendLSPRequest(method, params) {
  return new Promise((resolve, reject) => {
    const id = lspRequestId++;
    const message = {
      jsonrpc: '2.0',
      id: id,
      method: method,
      params: params
    };

    lspResponseHandlers.set(id, { resolve, reject });
    sendLSPMessage(message);

    // Timeout after 10 seconds
    setTimeout(() => {
      if (lspResponseHandlers.has(id)) {
        lspResponseHandlers.delete(id);
        reject(new Error(`LSP request timeout: ${method}`));
      }
    }, 10000);
  });
}

function sendLSPMessage(message) {
  if (!jdtlsProcess || !jdtlsProcess.stdin.writable) {
    console.error('[LSP] Cannot send message - JDT.LS not running');
    return;
  }

  const content = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
  jdtlsProcess.stdin.write(header + content);
}

// Find launcher JAR
function findLauncherJar() {
  const pluginsDir = path.join(JDTLS_HOME, 'plugins');
  if (!fs.existsSync(pluginsDir)) {
    throw new Error('Eclipse JDT.LS not found. Run setup-jdtls.sh first.');
  }
  const files = fs.readdirSync(pluginsDir);
  const launcher = files.find(f => f.startsWith('org.eclipse.equinox.launcher_'));
  if (!launcher) {
    throw new Error('Eclipse launcher JAR not found');
  }
  return path.join(pluginsDir, launcher);
}

// Get platform config
function getConfigDir() {
  const platform = process.platform;
  if (platform === 'darwin') return path.join(JDTLS_HOME, 'config_mac');
  if (platform === 'linux') return path.join(JDTLS_HOME, 'config_linux');
  return path.join(JDTLS_HOME, 'config_win');
}

// Start JDT.LS
function startJDTLS(projectPath) {
  return new Promise((resolve, reject) => {
    if (jdtlsProcess) {
      resolve();
      return;
    }

    console.error('[JDT.LS] Starting Eclipse Language Server...');

    try {
      const launcher = findLauncherJar();
      const config = getConfigDir();

      // Create workspace directory
      if (!fs.existsSync(WORKSPACE)) {
        fs.mkdirSync(WORKSPACE, { recursive: true });
      }

      const args = [
        '-Declipse.application=org.eclipse.jdt.ls.core.id1',
        '-Dosgi.bundles.defaultStartLevel=4',
        '-Declipse.product=org.eclipse.jdt.ls.core.product',
        '-Dlog.level=ERROR',
        '-Xmx2G',
        '-jar', launcher,
        '-configuration', config,
        '-data', WORKSPACE
      ];

      jdtlsProcess = spawn('java', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: projectPath
      });

      setupLSPCommunication();

      jdtlsProcess.on('error', (err) => {
        console.error('[JDT.LS] Process error:', err);
        reject(err);
      });

      jdtlsProcess.on('exit', (code) => {
        console.error('[JDT.LS] Process exited with code:', code);
        jdtlsProcess = null;
        jdtlsReady = false;
      });

      // Initialize LSP after a short delay
      setTimeout(() => {
        initializeLSP(projectPath).then(resolve).catch(reject);
      }, 1000);

    } catch (error) {
      reject(error);
    }
  });
}

// Setup LSP communication
function setupLSPCommunication() {
  let buffer = '';

  jdtlsProcess.stdout.on('data', (data) => {
    buffer += data.toString();

    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = buffer.slice(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length: (\d+)/);
      if (!contentLengthMatch) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1]);
      const contentStart = headerEnd + 4;

      if (buffer.length < contentStart + contentLength) break;

      const content = buffer.slice(contentStart, contentStart + contentLength);
      buffer = buffer.slice(contentStart + contentLength);

      try {
        const message = JSON.parse(content);
        handleLSPMessage(message);
      } catch (e) {
        console.error('[LSP] Failed to parse message:', e);
      }
    }
  });

  jdtlsProcess.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('ERROR')) {
      console.error('[JDT.LS Error]', msg.trim());
    }
  });
}

// Handle LSP messages
function handleLSPMessage(message) {
  // Handle responses to our requests
  if (message.id && lspResponseHandlers.has(message.id)) {
    const handler = lspResponseHandlers.get(message.id);
    lspResponseHandlers.delete(message.id);

    if (message.error) {
      handler.reject(new Error(message.error.message));
    } else {
      handler.resolve(message.result);
    }
    return;
  }

  // Handle server-initiated requests
  if (message.method) {
    handleLSPRequest(message);
  }
}

// Handle LSP server requests
function handleLSPRequest(message) {
  switch (message.method) {
    case 'window/logMessage':
      if (message.params.type === 1) { // Error
        console.error('[JDT.LS]', message.params.message);
      }
      break;

    case 'workspace/configuration':
      // Respond with Java settings
      sendLSPMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: [{}]
      });
      break;

    case 'client/registerCapability':
      // Accept capability registration
      sendLSPMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: null
      });
      break;
  }
}

// Initialize LSP
async function initializeLSP(projectPath) {
  console.error('[JDT.LS] Initializing for project:', projectPath);

  const initResult = await sendLSPRequest('initialize', {
    processId: process.pid,
    rootUri: `file://${projectPath}`,
    rootPath: projectPath,
    capabilities: {
      workspace: {
        applyEdit: true,
        workspaceEdit: { documentChanges: true },
        configuration: true,
        symbol: {
          dynamicRegistration: true,
          symbolKind: { valueSet: Array.from({length: 26}, (_, i) => i + 1) }
        }
      },
      textDocument: {
        synchronization: { dynamicRegistration: true },
        completion: { completionItem: { snippetSupport: true } },
        hover: { dynamicRegistration: true },
        definition: { dynamicRegistration: true },
        references: { dynamicRegistration: true },
        documentSymbol: { dynamicRegistration: true },
        typeDefinition: { dynamicRegistration: true },
        implementation: { dynamicRegistration: true },
        codeAction: { dynamicRegistration: true },
        rename: { dynamicRegistration: true }
      }
    },
    initializationOptions: {
      workspaceFolders: [`file://${projectPath}`],
      settings: {
        java: {
          home: process.env.JAVA_HOME || null
        }
      },
      extendedClientCapabilities: {
        classFileContentsSupport: true
      }
    },
    workspaceFolders: [{
      uri: `file://${projectPath}`,
      name: path.basename(projectPath)
    }]
  });

  // Send initialized notification
  sendLSPMessage({
    jsonrpc: '2.0',
    method: 'initialized',
    params: {}
  });

  jdtlsReady = true;
  console.error('[JDT.LS] Initialization complete');

  // Index project files
  await indexProjectFiles(projectPath);

  return initResult;
}

// Index project files
async function indexProjectFiles(projectPath) {
  console.error('[JDT.LS] Indexing project files...');

  const findJavaFiles = (dir, files = []) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        findJavaFiles(fullPath, files);
      } else if (entry.isFile() && entry.name.endsWith('.java')) {
        files.push(fullPath);
      }
    }

    return files;
  };

  const javaFiles = findJavaFiles(projectPath);
  console.error(`[JDT.LS] Found ${javaFiles.length} Java files`);

  // Open key files to trigger indexing
  for (const file of javaFiles.slice(0, 10)) { // Open first 10 files
    const uri = `file://${file}`;
    const content = fs.readFileSync(file, 'utf8');

    documentCache.set(uri, content);
    projectFiles.set(path.basename(file, '.java'), uri);

    // Notify JDT.LS about the file
    sendLSPMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: uri,
          languageId: 'java',
          version: 1,
          text: content
        }
      }
    });
  }

  // Wait for indexing
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.error('[JDT.LS] Indexing complete');
}

// Find and open a Java file by class name
async function findAndOpenFile(className) {
  // Convert class name to possible file paths
  const parts = className.split('.');
  const fileName = parts[parts.length - 1] + '.java';

  // Check if we already know this file
  const simpleClassName = parts[parts.length - 1];
  if (projectFiles.has(simpleClassName)) {
    return projectFiles.get(simpleClassName);
  }

  // Search for the file
  const searchPath = currentProject;
  const possiblePath = path.join(searchPath, 'src/main/java', ...parts.slice(0, -1), fileName);

  if (fs.existsSync(possiblePath)) {
    const uri = `file://${possiblePath}`;
    const content = fs.readFileSync(possiblePath, 'utf8');

    documentCache.set(uri, content);
    projectFiles.set(simpleClassName, uri);

    // Open the document in JDT.LS
    sendLSPMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: uri,
          languageId: 'java',
          version: 1,
          text: content
        }
      }
    });

    return uri;
  }

  throw new Error(`Could not find file for class: ${className}`);
}

// Get position of a symbol in a file
function findSymbolPosition(content, symbolName) {
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const index = line.indexOf(symbolName);

    if (index !== -1) {
      // Simple heuristic: look for method or class declaration
      if (line.includes('class ' + symbolName) ||
          line.includes('interface ' + symbolName) ||
          line.includes(' ' + symbolName + '(')) {
        return {
          line: i,
          character: index
        };
      }
    }
  }

  return { line: 0, character: 0 };
}

// === MCP Implementation ===

// Handle stdin input
const rl = readline.createInterface({
  input: process.stdin,
  terminal: false
});

rl.on('line', async (line) => {
  if (!line.trim()) return;

  try {
    const request = JSON.parse(line);
    await handleMCPRequest(request);
  } catch (e) {
    console.error('[MCP] Failed to handle request:', e);
  }
});

// Handle MCP requests
async function handleMCPRequest(request) {
  const { method, params, id } = request;

  try {
    switch (method) {
      case 'initialize':
        handleMCPInitialize(id, params);
        break;

      case 'tools/list':
        handleToolsList(id);
        break;

      case 'tools/call':
        await handleToolCall(id, params);
        break;

      default:
        sendMCPError(id, -32601, `Unknown method: ${method}`);
    }
  } catch (error) {
    sendMCPError(id, -32603, error.message);
  }
}

// MCP Initialize
function handleMCPInitialize(id, params) {
  const response = {
    jsonrpc: '2.0',
    id: id,
    result: {
      protocolVersion: params.protocolVersion || '2024-11-05',
      capabilities: {
        tools: { listChanged: false }
      },
      serverInfo: {
        name: 'Eclipse JDT.LS MCP Bridge',
        version: '3.0.0'
      }
    }
  };

  console.log(JSON.stringify(response));
}

// List tools
function handleToolsList(id) {
  const tools = [
    {
      name: 'initialize_project',
      description: 'Initialize Eclipse JDT.LS for Java project analysis',
      inputSchema: {
        type: 'object',
        properties: {
          project_path: { type: 'string', description: 'Path to Java project' }
        },
        required: ['project_path']
      }
    },
    {
      name: 'find_symbol',
      description: 'Find symbol definition in project',
      inputSchema: {
        type: 'object',
        properties: {
          class_name: { type: 'string', description: 'Fully qualified class name' },
          symbol_name: { type: 'string', description: 'Symbol name to find' }
        },
        required: ['class_name']
      }
    },
    {
      name: 'find_references',
      description: 'Find all references to a class or method',
      inputSchema: {
        type: 'object',
        properties: {
          class_name: { type: 'string', description: 'Fully qualified class name' },
          method_name: { type: 'string', description: 'Method name (optional)' }
        },
        required: ['class_name']
      }
    },
    {
      name: 'get_workspace_symbols',
      description: 'Search for symbols across the workspace',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }
  ];

  console.log(JSON.stringify({
    jsonrpc: '2.0',
    id: id,
    result: { tools }
  }));
}

// Handle tool calls
async function handleToolCall(id, params) {
  const { name, arguments: args } = params;

  try {
    let result;

    switch (name) {
      case 'initialize_project':
        result = await initializeProject(args.project_path);
        break;

      case 'find_symbol':
        result = await findSymbol(args.class_name, args.symbol_name);
        break;

      case 'find_references':
        result = await findReferences(args.class_name, args.method_name);
        break;

      case 'get_workspace_symbols':
        result = await getWorkspaceSymbols(args.query);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    sendMCPToolResult(id, result, false);

  } catch (error) {
    console.error('[MCP] Tool error:', error);
    sendMCPToolResult(id, { error: error.message }, true);
  }
}

// Initialize project
async function initializeProject(projectPath) {
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }

  currentProject = path.resolve(projectPath);

  // Start and initialize JDT.LS
  await startJDTLS(currentProject);

  // Wait a bit for full initialization
  await new Promise(resolve => setTimeout(resolve, 3000));

  return {
    status: 'initialized',
    mode: 'eclipse_jdtls',
    project: currentProject,
    workspace: WORKSPACE,
    ready: jdtlsReady,
    message: 'Eclipse JDT.LS initialized successfully'
  };
}

// Find symbol definition
async function findSymbol(className, symbolName) {
  if (!jdtlsReady) {
    throw new Error('JDT.LS not initialized');
  }

  const uri = await findAndOpenFile(className);
  const content = documentCache.get(uri);

  if (!content) {
    throw new Error(`Could not read file for ${className}`);
  }

  const position = findSymbolPosition(content, symbolName || className.split('.').pop());

  // Request definition
  const result = await sendLSPRequest('textDocument/definition', {
    textDocument: { uri },
    position: position
  });

  return {
    symbol: symbolName || className,
    definition: result,
    uri: uri
  };
}

// Find references
async function findReferences(className, methodName) {
  if (!jdtlsReady) {
    throw new Error('JDT.LS not initialized');
  }

  const uri = await findAndOpenFile(className);
  const content = documentCache.get(uri);

  if (!content) {
    throw new Error(`Could not read file for ${className}`);
  }

  const symbolName = methodName || className.split('.').pop();
  const position = findSymbolPosition(content, symbolName);

  // Request references
  const result = await sendLSPRequest('textDocument/references', {
    textDocument: { uri },
    position: position,
    context: { includeDeclaration: false }
  });

  // Format results
  const references = result ? result.map(ref => ({
    uri: ref.uri,
    file: ref.uri.replace('file://', ''),
    line: ref.range.start.line + 1,
    column: ref.range.start.character
  })) : [];

  return {
    symbol: `${className}${methodName ? '.' + methodName : ''}`,
    references: references,
    count: references.length
  };
}

// Get workspace symbols
async function getWorkspaceSymbols(query) {
  if (!jdtlsReady) {
    throw new Error('JDT.LS not initialized');
  }

  const result = await sendLSPRequest('workspace/symbol', {
    query: query
  });

  const symbols = result ? result.map(sym => ({
    name: sym.name,
    kind: getSymbolKind(sym.kind),
    location: sym.location.uri.replace('file://', ''),
    containerName: sym.containerName
  })) : [];

  return {
    query: query,
    symbols: symbols,
    count: symbols.length
  };
}

// Get symbol kind name
function getSymbolKind(kind) {
  const kinds = [
    'File', 'Module', 'Namespace', 'Package', 'Class', 'Method',
    'Property', 'Field', 'Constructor', 'Enum', 'Interface',
    'Function', 'Variable', 'Constant', 'String', 'Number',
    'Boolean', 'Array', 'Object', 'Key', 'Null', 'EnumMember',
    'Struct', 'Event', 'Operator', 'TypeParameter'
  ];
  return kinds[kind - 1] || 'Unknown';
}

// Send MCP tool result
function sendMCPToolResult(id, data, isError) {
  const response = {
    jsonrpc: '2.0',
    id: id,
    result: {
      content: [{
        type: 'text',
        text: JSON.stringify(data, null, 2)
      }],
      isError: isError
    }
  };

  console.log(JSON.stringify(response));
}

// Send MCP error
function sendMCPError(id, code, message) {
  console.log(JSON.stringify({
    jsonrpc: '2.0',
    id: id,
    error: { code, message }
  }));
}

// Cleanup
process.on('SIGTERM', () => {
  if (jdtlsProcess) jdtlsProcess.kill();
  process.exit(0);
});

process.on('SIGINT', () => {
  if (jdtlsProcess) jdtlsProcess.kill();
  process.exit(0);
});

// Keep alive
process.stdin.resume();

console.error('[MCP] Eclipse JDT.LS Bridge ready');