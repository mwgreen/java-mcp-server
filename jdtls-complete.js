#!/usr/bin/env node

/**
 * Complete Eclipse JDT.LS integration for MCP
 * Full LSP implementation with proper message handling
 */

const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { URL } = require('url');

// === Configuration ===
const JDTLS_HOME = path.join(__dirname, 'eclipse-jdtls');
const WORKSPACE = path.join('/tmp', 'jdtls-workspace-' + crypto.randomBytes(4).toString('hex'));
const DEBUG = process.env.DEBUG === 'true';

// === State Management ===
class JDTLSServer {
  constructor() {
    this.process = null;
    this.ready = false;
    this.initializing = false;
    this.currentProject = null;
    this.requestId = 1;
    this.responseHandlers = new Map();
    this.documentCache = new Map();
    this.classToUri = new Map();
    this.buffer = '';
    this.initPromise = null;
  }

  log(level, ...args) {
    if (level === 'error' || DEBUG) {
      console.error(`[JDT.LS ${level.toUpperCase()}]`, ...args);
    }
  }

  // Find launcher JAR
  findLauncherJar() {
    const pluginsDir = path.join(JDTLS_HOME, 'plugins');
    if (!fs.existsSync(pluginsDir)) {
      throw new Error('Eclipse JDT.LS not found. Run setup-jdtls.sh first.');
    }
    const files = fs.readdirSync(pluginsDir);
    const launcher = files.find(f => f.startsWith('org.eclipse.equinox.launcher_') && f.endsWith('.jar'));
    if (!launcher) {
      throw new Error('Eclipse launcher JAR not found');
    }
    return path.join(pluginsDir, launcher);
  }

  // Get platform config directory
  getConfigDir() {
    const platform = process.platform;
    const configMap = {
      'darwin': 'config_mac',
      'linux': 'config_linux',
      'win32': 'config_win'
    };
    return path.join(JDTLS_HOME, configMap[platform] || 'config_linux');
  }

  // Start JDT.LS process
  async start(projectPath) {
    if (this.process) {
      this.log('info', 'JDT.LS already running');
      return;
    }

    if (this.initializing) {
      this.log('info', 'JDT.LS already initializing, waiting...');
      return this.initPromise;
    }

    this.initializing = true;
    this.initPromise = this._doStart(projectPath);
    return this.initPromise;
  }

  async _doStart(projectPath) {
    try {
      this.log('info', 'Starting Eclipse JDT Language Server...');

      const launcher = this.findLauncherJar();
      const config = this.getConfigDir();

      // Ensure workspace exists
      if (!fs.existsSync(WORKSPACE)) {
        fs.mkdirSync(WORKSPACE, { recursive: true });
      }

      // JVM arguments for JDT.LS
      const args = [
        '-Declipse.application=org.eclipse.jdt.ls.core.id1',
        '-Dosgi.bundles.defaultStartLevel=4',
        '-Declipse.product=org.eclipse.jdt.ls.core.product',
        '-Dlog.level=' + (DEBUG ? 'ALL' : 'ERROR'),
        '-Dfile.encoding=UTF-8',
        '-Xmx2G',
        '-Xms512M',
        '--add-modules=ALL-SYSTEM',
        '--add-opens', 'java.base/java.util=ALL-UNNAMED',
        '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
        '-jar', launcher,
        '-configuration', config,
        '-data', WORKSPACE
      ];

      this.process = spawn('java', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: projectPath
      });

      this.setupCommunication();

      this.process.on('error', (err) => {
        this.log('error', 'Process error:', err.message);
        this.ready = false;
        this.process = null;
      });

      this.process.on('exit', (code) => {
        this.log('info', 'Process exited with code:', code);
        this.ready = false;
        this.process = null;
      });

      // Wait a moment for process to start
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Initialize LSP
      await this.initialize(projectPath);

      this.ready = true;
      this.initializing = false;
      this.log('info', 'JDT.LS ready');

    } catch (error) {
      this.initializing = false;
      throw error;
    }
  }

  // Setup LSP communication
  setupCommunication() {
    // Handle stdout (LSP messages)
    this.process.stdout.on('data', (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    // Handle stderr (logging)
    this.process.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('ERROR') || DEBUG) {
        this.log('stderr', msg.trim());
      }
    });
  }

  // Process LSP message buffer
  processBuffer() {
    while (true) {
      // Look for Content-Length header
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      // Parse header
      const header = this.buffer.slice(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length: (\d+)/i);

      if (!contentLengthMatch) {
        // Invalid header, skip it
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1]);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      // Check if we have the full message
      if (this.buffer.length < messageEnd) break;

      // Extract message
      const messageStr = this.buffer.slice(messageStart, messageEnd);
      this.buffer = this.buffer.slice(messageEnd);

      // Parse and handle message
      try {
        const message = JSON.parse(messageStr);
        this.handleMessage(message);
      } catch (e) {
        this.log('error', 'Failed to parse LSP message:', e.message);
        this.log('debug', 'Message was:', messageStr.substring(0, 200));
      }
    }
  }

  // Handle LSP message
  handleMessage(message) {
    // Response to our request
    if (message.id !== undefined && this.responseHandlers.has(message.id)) {
      const handler = this.responseHandlers.get(message.id);
      this.responseHandlers.delete(message.id);

      if (message.error) {
        handler.reject(new Error(message.error.message || 'LSP error'));
      } else {
        handler.resolve(message.result);
      }
      return;
    }

    // Server-initiated request or notification
    if (message.method) {
      this.handleServerMessage(message);
    }
  }

  // Handle server-initiated messages
  handleServerMessage(message) {
    switch (message.method) {
      case 'window/showMessage':
      case 'window/logMessage':
        if (message.params.type === 1) { // Error
          this.log('server', message.params.message);
        }
        break;

      case 'workspace/configuration':
        // Respond with empty config
        this.sendMessage({
          jsonrpc: '2.0',
          id: message.id,
          result: [{}]
        });
        break;

      case 'client/registerCapability':
        // Accept capability registration
        if (message.id) {
          this.sendMessage({
            jsonrpc: '2.0',
            id: message.id,
            result: null
          });
        }
        break;

      case 'window/showMessageRequest':
        // Auto-respond to message requests
        if (message.id) {
          this.sendMessage({
            jsonrpc: '2.0',
            id: message.id,
            result: null
          });
        }
        break;
    }
  }

  // Send LSP message
  sendMessage(message) {
    if (!this.process || !this.process.stdin.writable) {
      this.log('error', 'Cannot send message - JDT.LS not running');
      return;
    }

    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;

    this.process.stdin.write(header);
    this.process.stdin.write(content);
  }

  // Send request and wait for response
  sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;

      this.responseHandlers.set(id, { resolve, reject });

      this.sendMessage({
        jsonrpc: '2.0',
        id: id,
        method: method,
        params: params
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.responseHandlers.has(id)) {
          this.responseHandlers.delete(id);
          reject(new Error(`LSP request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  // Initialize LSP connection
  async initialize(projectPath) {
    this.log('info', 'Initializing LSP for:', projectPath);
    this.currentProject = projectPath;

    const rootUri = this.pathToUri(projectPath);

    const initResult = await this.sendRequest('initialize', {
      processId: process.pid,
      clientInfo: {
        name: 'MCP-JDTLS-Bridge',
        version: '1.0.0'
      },
      rootPath: projectPath,
      rootUri: rootUri,
      capabilities: {
        workspace: {
          applyEdit: true,
          workspaceEdit: {
            documentChanges: true,
            resourceOperations: ['create', 'rename', 'delete']
          },
          configuration: true,
          workspaceFolders: true,
          symbol: {
            dynamicRegistration: false,
            symbolKind: {
              valueSet: Array.from({length: 26}, (_, i) => i + 1)
            }
          }
        },
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            willSave: false,
            didSave: true,
            willSaveWaitUntil: false
          },
          completion: {
            dynamicRegistration: false,
            completionItem: {
              snippetSupport: true,
              documentationFormat: ['markdown', 'plaintext']
            }
          },
          hover: { dynamicRegistration: false },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          documentSymbol: { dynamicRegistration: false },
          typeDefinition: { dynamicRegistration: false },
          implementation: { dynamicRegistration: false },
          codeAction: { dynamicRegistration: false },
          rename: { dynamicRegistration: false }
        },
        window: {
          workDoneProgress: true,
          showMessage: {},
          showDocument: { support: true }
        }
      },
      initializationOptions: {
        bundles: [],
        workspaceFolders: [rootUri],
        settings: {
          java: {
            home: process.env.JAVA_HOME || null,
            import: {
              gradle: { enabled: true },
              maven: { enabled: true }
            },
            configuration: {
              updateBuildConfiguration: 'automatic'
            },
            autobuild: { enabled: true },
            maxConcurrentBuilds: 1,
            errors: { incompleteClasspath: { severity: 'warning' } }
          }
        },
        extendedClientCapabilities: {
          progressReportProvider: true,
          classFileContentsSupport: true,
          overrideMethodsPromptSupport: true,
          hashCodeEqualsPromptSupport: true,
          advancedOrganizeImportsSupport: true,
          generateToStringPromptSupport: true,
          advancedGenerateAccessorsSupport: true,
          generateConstructorsPromptSupport: true,
          generateDelegateMethodsPromptSupport: true
        }
      },
      workspaceFolders: [{
        uri: rootUri,
        name: path.basename(projectPath)
      }]
    });

    this.log('info', 'Initialize response received');

    // Send initialized notification
    this.sendMessage({
      jsonrpc: '2.0',
      method: 'initialized',
      params: {}
    });

    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Index project files
    await this.indexProject();

    return initResult;
  }

  // Index project files
  async indexProject() {
    this.log('info', 'Indexing project files...');

    const javaFiles = this.findJavaFiles(this.currentProject);
    this.log('info', `Found ${javaFiles.length} Java files`);

    // Map class names to URIs
    for (const file of javaFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const className = this.extractClassName(content, file);
      if (className) {
        const uri = this.pathToUri(file);
        this.classToUri.set(className, uri);
        this.documentCache.set(uri, content);
      }
    }

    // Open a few key files to trigger indexing
    const filesToOpen = javaFiles.slice(0, Math.min(5, javaFiles.length));
    for (const file of filesToOpen) {
      await this.openDocument(file);
    }

    // Give JDT.LS time to index
    await new Promise(resolve => setTimeout(resolve, 3000));
    this.log('info', 'Indexing complete');
  }

  // Find all Java files in directory
  findJavaFiles(dir, files = []) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip common non-source directories
          if (!['node_modules', '.git', 'target', 'build', '.'].includes(entry.name)) {
            this.findJavaFiles(fullPath, files);
          }
        } else if (entry.isFile() && entry.name.endsWith('.java')) {
          files.push(fullPath);
        }
      }
    } catch (e) {
      // Ignore permission errors
    }

    return files;
  }

  // Extract class name from Java file
  extractClassName(content, filePath) {
    // Extract package name
    const packageMatch = content.match(/^\s*package\s+([\w.]+)\s*;/m);
    const packageName = packageMatch ? packageMatch[1] : '';

    // Extract class name from file name
    const fileName = path.basename(filePath, '.java');

    return packageName ? `${packageName}.${fileName}` : fileName;
  }

  // Open document in JDT.LS
  async openDocument(filePath) {
    const uri = this.pathToUri(filePath);
    const content = fs.readFileSync(filePath, 'utf8');

    this.documentCache.set(uri, content);

    this.sendMessage({
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

  // Find and open file for class
  async findAndOpenClass(className) {
    // Check cache first
    if (this.classToUri.has(className)) {
      const uri = this.classToUri.get(className);
      if (!this.documentCache.has(uri)) {
        const filePath = this.uriToPath(uri);
        await this.openDocument(filePath);
      }
      return uri;
    }

    // Try to find file
    const parts = className.split('.');
    const fileName = parts[parts.length - 1] + '.java';
    const packagePath = parts.slice(0, -1).join('/');

    // Common source roots
    const sourceRoots = [
      'src/main/java',
      'src/test/java',
      'src',
      ''
    ];

    for (const root of sourceRoots) {
      const filePath = path.join(this.currentProject, root, packagePath, fileName);
      if (fs.existsSync(filePath)) {
        await this.openDocument(filePath);
        const uri = this.pathToUri(filePath);
        this.classToUri.set(className, uri);
        return uri;
      }
    }

    throw new Error(`Cannot find file for class: ${className}`);
  }

  // Find position of symbol in document
  findSymbolPosition(uri, symbolName) {
    const content = this.documentCache.get(uri);
    if (!content) return { line: 0, character: 0 };

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Look for method declaration
      const methodMatch = line.match(new RegExp(`\\b${symbolName}\\s*\\(`));
      if (methodMatch) {
        return {
          line: i,
          character: methodMatch.index
        };
      }

      // Look for class declaration
      const classMatch = line.match(new RegExp(`\\bclass\\s+${symbolName}\\b`));
      if (classMatch) {
        return {
          line: i,
          character: classMatch.index + 6 // Skip "class "
        };
      }
    }

    return { line: 0, character: 0 };
  }

  // Convert file path to URI
  pathToUri(filePath) {
    const absolutePath = path.resolve(filePath);
    return `file://${absolutePath}`;
  }

  // Convert URI to file path
  uriToPath(uri) {
    if (uri.startsWith('file://')) {
      return uri.substring(7);
    }
    return uri;
  }

  // Shutdown server
  shutdown() {
    if (this.process) {
      this.log('info', 'Shutting down JDT.LS...');
      this.sendMessage({
        jsonrpc: '2.0',
        method: 'shutdown',
        id: this.requestId++
      });

      setTimeout(() => {
        if (this.process) {
          this.process.kill();
        }
      }, 1000);
    }
  }
}

// === MCP Server Implementation ===

const jdtls = new JDTLSServer();

// Setup stdin reader for MCP
const rl = readline.createInterface({
  input: process.stdin,
  terminal: false
});

// Handle MCP requests
rl.on('line', async (line) => {
  if (!line.trim()) return;

  try {
    const request = JSON.parse(line);
    await handleMCPRequest(request);
  } catch (e) {
    console.error('[MCP] Failed to handle request:', e.message);
  }
});

// MCP request handler
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
    console.error('[MCP] Request error:', error);
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
        name: 'Eclipse JDT.LS Complete',
        version: '1.0.0'
      }
    }
  };
  console.log(JSON.stringify(response));
}

// List available tools
function handleToolsList(id) {
  const tools = [
    {
      name: 'initialize_project',
      description: 'Initialize Eclipse JDT.LS for Java project',
      inputSchema: {
        type: 'object',
        properties: {
          project_path: {
            type: 'string',
            description: 'Absolute path to Java project'
          }
        },
        required: ['project_path']
      }
    },
    {
      name: 'find_definition',
      description: 'Find definition of a symbol',
      inputSchema: {
        type: 'object',
        properties: {
          class_name: {
            type: 'string',
            description: 'Fully qualified class name'
          },
          symbol: {
            type: 'string',
            description: 'Symbol name (method, field, etc.)'
          }
        },
        required: ['class_name', 'symbol']
      }
    },
    {
      name: 'find_references',
      description: 'Find all references to a symbol',
      inputSchema: {
        type: 'object',
        properties: {
          class_name: {
            type: 'string',
            description: 'Fully qualified class name'
          },
          symbol: {
            type: 'string',
            description: 'Symbol name'
          }
        },
        required: ['class_name', 'symbol']
      }
    },
    {
      name: 'get_symbols',
      description: 'Search for symbols in workspace',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query'
          }
        },
        required: ['query']
      }
    },
    {
      name: 'get_document_symbols',
      description: 'Get all symbols in a class',
      inputSchema: {
        type: 'object',
        properties: {
          class_name: {
            type: 'string',
            description: 'Fully qualified class name'
          }
        },
        required: ['class_name']
      }
    }
  ];

  const response = {
    jsonrpc: '2.0',
    id: id,
    result: { tools }
  };
  console.log(JSON.stringify(response));
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

      case 'find_definition':
        result = await findDefinition(args.class_name, args.symbol);
        break;

      case 'find_references':
        result = await findReferences(args.class_name, args.symbol);
        break;

      case 'get_symbols':
        result = await getSymbols(args.query);
        break;

      case 'get_document_symbols':
        result = await getDocumentSymbols(args.class_name);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    sendMCPToolResult(id, result);

  } catch (error) {
    console.error('[MCP] Tool error:', error);
    sendMCPToolResult(id, { error: error.message }, true);
  }
}

// Tool: Initialize project
async function initializeProject(projectPath) {
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }

  await jdtls.start(projectPath);

  return {
    status: 'success',
    project: projectPath,
    workspace: WORKSPACE,
    ready: jdtls.ready,
    indexedClasses: jdtls.classToUri.size,
    message: 'Eclipse JDT.LS initialized successfully'
  };
}

// Tool: Find definition
async function findDefinition(className, symbol) {
  if (!jdtls.ready) {
    throw new Error('JDT.LS not initialized. Call initialize_project first.');
  }

  const uri = await jdtls.findAndOpenClass(className);
  const position = jdtls.findSymbolPosition(uri, symbol);

  const result = await jdtls.sendRequest('textDocument/definition', {
    textDocument: { uri },
    position
  });

  if (!result || result.length === 0) {
    return {
      symbol: `${className}.${symbol}`,
      found: false,
      message: 'No definition found'
    };
  }

  const locations = Array.isArray(result) ? result : [result];

  return {
    symbol: `${className}.${symbol}`,
    found: true,
    definitions: locations.map(loc => ({
      file: jdtls.uriToPath(loc.uri || loc.targetUri),
      line: (loc.range || loc.targetRange).start.line + 1,
      column: (loc.range || loc.targetRange).start.character
    }))
  };
}

// Tool: Find references
async function findReferences(className, symbol) {
  if (!jdtls.ready) {
    throw new Error('JDT.LS not initialized. Call initialize_project first.');
  }

  const uri = await jdtls.findAndOpenClass(className);
  const position = jdtls.findSymbolPosition(uri, symbol);

  const result = await jdtls.sendRequest('textDocument/references', {
    textDocument: { uri },
    position,
    context: {
      includeDeclaration: false
    }
  });

  if (!result || result.length === 0) {
    return {
      symbol: `${className}.${symbol}`,
      count: 0,
      references: []
    };
  }

  return {
    symbol: `${className}.${symbol}`,
    count: result.length,
    references: result.slice(0, 20).map(ref => ({
      file: jdtls.uriToPath(ref.uri),
      line: ref.range.start.line + 1,
      column: ref.range.start.character,
      preview: getLinePreview(ref.uri, ref.range.start.line)
    }))
  };
}

// Tool: Get workspace symbols
async function getSymbols(query) {
  if (!jdtls.ready) {
    throw new Error('JDT.LS not initialized. Call initialize_project first.');
  }

  const result = await jdtls.sendRequest('workspace/symbol', {
    query: query
  });

  if (!result || result.length === 0) {
    return {
      query: query,
      count: 0,
      symbols: []
    };
  }

  return {
    query: query,
    count: result.length,
    symbols: result.slice(0, 50).map(sym => ({
      name: sym.name,
      kind: getSymbolKindName(sym.kind),
      containerName: sym.containerName || '',
      location: jdtls.uriToPath(sym.location.uri),
      line: sym.location.range.start.line + 1
    }))
  };
}

// Tool: Get document symbols
async function getDocumentSymbols(className) {
  if (!jdtls.ready) {
    throw new Error('JDT.LS not initialized. Call initialize_project first.');
  }

  const uri = await jdtls.findAndOpenClass(className);

  const result = await jdtls.sendRequest('textDocument/documentSymbol', {
    textDocument: { uri }
  });

  if (!result || result.length === 0) {
    return {
      class: className,
      symbols: []
    };
  }

  // Flatten symbol tree
  const symbols = [];
  const processSymbol = (sym, parent = '') => {
    symbols.push({
      name: sym.name,
      kind: getSymbolKindName(sym.kind),
      detail: sym.detail || '',
      parent: parent,
      line: sym.range ? sym.range.start.line + 1 : sym.location.range.start.line + 1
    });

    if (sym.children) {
      sym.children.forEach(child => processSymbol(child, sym.name));
    }
  };

  result.forEach(sym => processSymbol(sym));

  return {
    class: className,
    file: jdtls.uriToPath(uri),
    symbols: symbols
  };
}

// Get line preview from document
function getLinePreview(uri, lineNumber) {
  const content = jdtls.documentCache.get(uri);
  if (!content) return '';

  const lines = content.split('\n');
  if (lineNumber >= 0 && lineNumber < lines.length) {
    return lines[lineNumber].trim();
  }
  return '';
}

// Get symbol kind name
function getSymbolKindName(kind) {
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
function sendMCPToolResult(id, data, isError = false) {
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
  const response = {
    jsonrpc: '2.0',
    id: id,
    error: {
      code: code,
      message: message
    }
  };
  console.log(JSON.stringify(response));
}

// Cleanup on exit
process.on('SIGTERM', () => {
  jdtls.shutdown();
  process.exit(0);
});

process.on('SIGINT', () => {
  jdtls.shutdown();
  process.exit(0);
});

// Keep process alive
process.stdin.resume();

console.error('[MCP] Eclipse JDT.LS Complete MCP Server ready');