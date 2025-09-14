#!/usr/bin/env node

/**
 * Eclipse JDT.LS MCP Bridge with Gradle/Maven support
 * Properly indexes project source files
 */

const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Configuration
const JDTLS_HOME = path.join(__dirname, 'eclipse-jdtls');
const WORKSPACE = path.join('/tmp', 'jdtls-workspace-' + crypto.randomBytes(4).toString('hex'));
const DEBUG = process.env.DEBUG === 'true';

// State
let jdtlsProcess = null;
let ready = false;
let initializing = false;
let currentProject = null;
let requestId = 1;
let responseHandlers = new Map();
let documentCache = new Map();
let buffer = '';

// Logging
function log(level, ...args) {
  if (level === 'error' || DEBUG) {
    console.error(`[JDT.LS ${level.toUpperCase()}]`, ...args);
  }
}

// Find launcher JAR
function findLauncherJar() {
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

// Get platform config
function getConfigDir() {
  const platform = process.platform;
  const configMap = {
    'darwin': 'config_mac',
    'linux': 'config_linux',
    'win32': 'config_win'
  };
  return path.join(JDTLS_HOME, configMap[platform] || 'config_linux');
}

// Detect project type
function detectProjectType(projectPath) {
  if (fs.existsSync(path.join(projectPath, 'build.gradle')) ||
      fs.existsSync(path.join(projectPath, 'build.gradle.kts'))) {
    return 'gradle';
  }
  if (fs.existsSync(path.join(projectPath, 'pom.xml'))) {
    return 'maven';
  }
  return 'plain';
}

// Start JDT.LS
async function startJDTLS(projectPath) {
  if (ready && currentProject === projectPath) {
    log('info', 'JDT.LS already ready for this project');
    return;
  }

  if (initializing) {
    log('info', 'JDT.LS already initializing, waiting...');
    // Wait for initialization to complete
    let waitCount = 0;
    while (initializing && waitCount < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      waitCount++;
    }
    if (!ready) {
      throw new Error('JDT.LS initialization timeout');
    }
    return;
  }

  if (jdtlsProcess && currentProject !== projectPath) {
    log('info', 'Restarting JDT.LS for new project');
    cleanup();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  initializing = true;
  currentProject = projectPath;

  log('info', 'Starting Eclipse JDT.LS for:', projectPath);

  try {
    const launcher = findLauncherJar();
    const config = getConfigDir();
    const projectType = detectProjectType(projectPath);

    log('info', `Project type detected: ${projectType}`);

    // Ensure workspace exists
    if (!fs.existsSync(WORKSPACE)) {
      fs.mkdirSync(WORKSPACE, { recursive: true });
    }

    // JVM arguments
    const args = [
      '-Declipse.application=org.eclipse.jdt.ls.core.id1',
      '-Dosgi.bundles.defaultStartLevel=4',
      '-Declipse.product=org.eclipse.jdt.ls.core.product',
      '-Dlog.level=' + (DEBUG ? 'ALL' : 'ERROR'),
      '-Dfile.encoding=UTF-8',
      '-DwatchParentProcess=false',
      '-Xmx2G',
      '-Xms512M',
      '--add-modules=ALL-SYSTEM',
      '--add-opens', 'java.base/java.util=ALL-UNNAMED',
      '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
      '-jar', launcher,
      '-configuration', config,
      '-data', WORKSPACE
    ];

    jdtlsProcess = spawn('java', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: projectPath
    });

    setupCommunication();

    jdtlsProcess.on('error', (err) => {
      log('error', 'Process error:', err.message);
      cleanup();
    });

    jdtlsProcess.on('exit', (code) => {
      log('info', 'Process exited with code:', code);
      cleanup();
    });

    // Wait for process to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Initialize LSP connection
    log('info', 'Calling initializeLSP...');
    await initializeLSP(projectPath, projectType);
    log('info', 'initializeLSP completed');

    ready = true;
    initializing = false;
    log('info', 'JDT.LS ready');

  } catch (error) {
    initializing = false;
    cleanup();
    throw error;
  }
}

// Setup communication
function setupCommunication() {
  jdtlsProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    processBuffer();
  });

  jdtlsProcess.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('ERROR') || msg.includes('SEVERE')) {
      log('stderr', msg.trim());
    }
  });
}

// Process LSP buffer
function processBuffer() {
  while (buffer.length > 0) {
    // Look for Content-Length header
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      // No complete header yet
      break;
    }

    const header = buffer.slice(0, headerEnd);
    const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);

    if (!contentLengthMatch) {
      // Invalid header, skip it
      log('warn', 'Invalid LSP header, skipping');
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(contentLengthMatch[1], 10);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + contentLength;

    // Check if we have the complete message
    if (buffer.length < messageEnd) {
      // Wait for more data
      break;
    }

    // Extract the message
    const messageStr = buffer.slice(messageStart, messageEnd);

    // Remove processed data from buffer
    buffer = buffer.slice(messageEnd);

    // Parse and handle the message
    try {
      const message = JSON.parse(messageStr);
      handleLSPMessage(message);
    } catch (e) {
      log('error', 'Failed to parse LSP message:', e.message);
      log('error', 'Message was:', messageStr.substring(0, 200));
    }
  }
}

// Handle LSP messages
function handleLSPMessage(message) {
  // Response to our request
  if (message.id !== undefined && responseHandlers.has(message.id)) {
    const handler = responseHandlers.get(message.id);
    responseHandlers.delete(message.id);

    if (message.error) {
      handler.reject(new Error(message.error.message || 'LSP error'));
    } else {
      handler.resolve(message.result);
    }
    return;
  }

  // Server request/notification
  if (message.method) {
    handleServerMessage(message);
  }
}

// Handle server messages
function handleServerMessage(message) {
  switch (message.method) {
    case 'window/showMessage':
    case 'window/logMessage':
      if (message.params.type === 1 || DEBUG) {
        log('server', message.params.message);
      }
      break;

    case 'workspace/configuration':
      // Send Java configuration
      sendMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: [{
          'java.import.gradle.enabled': true,
          'java.import.maven.enabled': true,
          'java.autobuild.enabled': true,
          'java.configuration.updateBuildConfiguration': 'automatic'
        }]
      });
      break;

    case 'client/registerCapability':
    case 'client/unregisterCapability':
      if (message.id) {
        sendMessage({
          jsonrpc: '2.0',
          id: message.id,
          result: null
        });
      }
      break;

    case 'workspace/executeCommand':
      if (message.id) {
        sendMessage({
          jsonrpc: '2.0',
          id: message.id,
          result: null
        });
      }
      break;

    case 'language/status':
      // Project import status
      if (message.params?.type === 'Started' || message.params?.type === 'ProjectStatus') {
        log('info', 'Project status:', message.params.message);
      }
      break;
  }
}

// Send LSP message
function sendMessage(message) {
  if (!jdtlsProcess || !jdtlsProcess.stdin.writable) return;

  const content = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;

  jdtlsProcess.stdin.write(header);
  jdtlsProcess.stdin.write(content);
}

// Send request
function sendRequest(method, params) {
  return new Promise((resolve, reject) => {
    const id = requestId++;

    responseHandlers.set(id, { resolve, reject });

    sendMessage({
      jsonrpc: '2.0',
      id: id,
      method: method,
      params: params
    });

    setTimeout(() => {
      if (responseHandlers.has(id)) {
        responseHandlers.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }
    }, 30000); // 30 second timeout
  });
}

// Initialize LSP
async function initializeLSP(projectPath, projectType) {
  log('info', 'Initializing LSP...');

  const rootUri = `file://${path.resolve(projectPath)}`;

  // Prepare initialization options based on project type
  const initOptions = {
    bundles: [],
    workspaceFolders: [rootUri],
    settings: {
      java: {
        home: process.env.JAVA_HOME || null,
        import: {
          gradle: {
            enabled: true,
            wrapper: { enabled: true },
            offline: { enabled: false },
            arguments: '',
            jvmArguments: '',
            user: { home: process.env.HOME }
          },
          maven: {
            enabled: true,
            offline: { enabled: false }
          },
          exclusions: ['**/node_modules/**', '**/.metadata/**', '**/archetype-resources/**', '**/META-INF/maven/**']
        },
        configuration: {
          updateBuildConfiguration: 'automatic',
          checkProjectSettingsExclusions: false
        },
        autobuild: { enabled: true },
        maxConcurrentBuilds: 1,
        completion: { enabled: true },
        errors: { incompleteClasspath: { severity: 'warning' } },
        trace: { server: DEBUG ? 'verbose' : 'off' }
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
      generateDelegateMethodsPromptSupport: true,
      resolveAdditionalTextEditsSupport: true
    }
  };

  // Add Gradle-specific settings
  if (projectType === 'gradle') {
    initOptions.settings.java.import.gradle.home = findGradleHome(projectPath);
    initOptions.settings.java.import.gradle.version = detectGradleVersion(projectPath);
  }

  const initResult = await sendRequest('initialize', {
    processId: process.pid,
    clientInfo: {
      name: 'MCP-JDTLS',
      version: '1.0.0'
    },
    locale: 'en',
    rootPath: projectPath,
    rootUri: rootUri,
    capabilities: {
      workspace: {
        applyEdit: true,
        workspaceEdit: {
          documentChanges: true,
          resourceOperations: ['create', 'rename', 'delete']
        },
        didChangeConfiguration: { dynamicRegistration: true },
        didChangeWatchedFiles: { dynamicRegistration: true },
        symbol: {
          dynamicRegistration: true,
          symbolKind: { valueSet: Array.from({length: 26}, (_, i) => i + 1) }
        },
        executeCommand: { dynamicRegistration: true },
        configuration: true,
        workspaceFolders: true
      },
      textDocument: {
        publishDiagnostics: { relatedInformation: true },
        synchronization: {
          dynamicRegistration: true,
          willSave: true,
          willSaveWaitUntil: true,
          didSave: true
        },
        completion: {
          dynamicRegistration: true,
          contextSupport: true,
          completionItem: {
            snippetSupport: true,
            commitCharactersSupport: true,
            documentationFormat: ['markdown', 'plaintext'],
            deprecatedSupport: true,
            preselectSupport: true
          },
          completionItemKind: { valueSet: Array.from({length: 25}, (_, i) => i + 1) }
        },
        hover: {
          dynamicRegistration: true,
          contentFormat: ['markdown', 'plaintext']
        },
        signatureHelp: {
          dynamicRegistration: true,
          signatureInformation: {
            documentationFormat: ['markdown', 'plaintext'],
            parameterInformation: { labelOffsetSupport: true }
          }
        },
        definition: { dynamicRegistration: true },
        references: { dynamicRegistration: true },
        documentHighlight: { dynamicRegistration: true },
        documentSymbol: {
          dynamicRegistration: true,
          symbolKind: { valueSet: Array.from({length: 26}, (_, i) => i + 1) },
          hierarchicalDocumentSymbolSupport: true
        },
        codeAction: {
          dynamicRegistration: true,
          codeActionLiteralSupport: {
            codeActionKind: { valueSet: ['quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports'] }
          }
        },
        codeLens: { dynamicRegistration: true },
        formatting: { dynamicRegistration: true },
        rangeFormatting: { dynamicRegistration: true },
        onTypeFormatting: { dynamicRegistration: true },
        rename: { dynamicRegistration: true, prepareSupport: true },
        documentLink: { dynamicRegistration: true },
        typeDefinition: { dynamicRegistration: true },
        implementation: { dynamicRegistration: true },
        colorProvider: { dynamicRegistration: true },
        foldingRange: { dynamicRegistration: true, rangeLimit: 5000, lineFoldingOnly: true }
      },
      window: {
        workDoneProgress: true,
        showMessage: { messageActionItem: { additionalPropertiesSupport: false } },
        showDocument: { support: true }
      }
    },
    initializationOptions: initOptions,
    workspaceFolders: [{
      uri: rootUri,
      name: path.basename(projectPath)
    }]
  });

  log('info', 'Initialize response received');

  // Send initialized
  sendMessage({
    jsonrpc: '2.0',
    method: 'initialized',
    params: {}
  });

  // CRITICAL: Tell JDT.LS to import the project
  if (projectType === 'gradle' || projectType === 'maven') {
    log('info', `Triggering ${projectType} import...`);

    // Send didChangeConfiguration to trigger import
    sendMessage({
      jsonrpc: '2.0',
      method: 'workspace/didChangeConfiguration',
      params: {
        settings: initOptions.settings
      }
    });

    // For Gradle projects, also send build file as watched
    if (projectType === 'gradle') {
      const buildFile = path.join(projectPath, 'build.gradle');
      if (fs.existsSync(buildFile)) {
        sendMessage({
          jsonrpc: '2.0',
          method: 'workspace/didChangeWatchedFiles',
          params: {
            changes: [{
              uri: `file://${buildFile}`,
              type: 1 // Created
            }]
          }
        });
      }
    }

    // Wait for import to complete
    log('info', 'Waiting for project import to complete...');
    await new Promise(resolve => setTimeout(resolve, 10000)); // Give it 10 seconds to import
  }

  // Force build/refresh
  try {
    await sendRequest('workspace/executeCommand', {
      command: 'java.project.refreshDiagnostics'
    });
  } catch (e) {
    // Some commands might not be available
  }

  try {
    await sendRequest('workspace/executeCommand', {
      command: 'java.project.import'
    });
  } catch (e) {
    // Command might not exist
  }

  // CRITICAL: Trigger workspace build for Gradle/Maven projects
  if (projectType === 'gradle' || projectType === 'maven') {
    log('info', 'Triggering workspace build...');
    try {
      await sendRequest('java/buildWorkspace', true);
      log('info', 'Workspace build triggered');
      // Wait for build to complete
      await new Promise(resolve => setTimeout(resolve, 10000));
    } catch (e) {
      log('error', 'Failed to trigger workspace build:', e.message);
    }
  }

  log('info', 'LSP initialization complete');

  return initResult;
}

// Find Gradle home
function findGradleHome(projectPath) {
  // Check for gradle wrapper
  if (fs.existsSync(path.join(projectPath, 'gradlew'))) {
    return path.join(projectPath, 'gradle');
  }
  // Check environment
  return process.env.GRADLE_HOME || null;
}

// Detect Gradle version
function detectGradleVersion(projectPath) {
  const wrapperProps = path.join(projectPath, 'gradle/wrapper/gradle-wrapper.properties');
  if (fs.existsSync(wrapperProps)) {
    const content = fs.readFileSync(wrapperProps, 'utf8');
    const match = content.match(/gradle-(\d+\.\d+(?:\.\d+)?)/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

// Cleanup
function cleanup() {
  ready = false;
  jdtlsProcess = null;
  buffer = '';
  responseHandlers.clear();
}

// === MCP Interface ===

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
    console.error('[MCP] Failed to handle request:', e.message);
  }
});

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

function handleMCPInitialize(id, params) {
  console.log(JSON.stringify({
    jsonrpc: '2.0',
    id: id,
    result: {
      protocolVersion: params.protocolVersion || '2024-11-05',
      capabilities: {
        tools: { listChanged: false }
      },
      serverInfo: {
        name: 'Eclipse JDT.LS (Gradle-aware)',
        version: '2.0.0'
      }
    }
  }));
}

function handleToolsList(id) {
  const tools = [
    {
      name: 'initialize_project',
      description: 'Initialize Eclipse JDT.LS for a Java project (supports Gradle/Maven)',
      inputSchema: {
        type: 'object',
        properties: {
          project_path: {
            type: 'string',
            description: 'Path to Java project root (containing build.gradle/pom.xml)'
          }
        },
        required: ['project_path']
      }
    },
    {
      name: 'get_symbols',
      description: 'Search for symbols in the workspace',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Symbol search query (e.g., class name, method name)'
          }
        },
        required: ['query']
      }
    },
    {
      name: 'list_classes',
      description: 'List all indexed classes in the workspace',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  ];

  console.log(JSON.stringify({
    jsonrpc: '2.0',
    id: id,
    result: { tools }
  }));
}

async function handleToolCall(id, params) {
  const { name, arguments: args } = params;

  try {
    let result;

    switch (name) {
      case 'initialize_project':
        result = await initializeProject(args.project_path);
        break;

      case 'get_symbols':
        result = await getSymbols(args.query);
        break;

      case 'list_classes':
        result = await listClasses();
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    sendMCPToolResult(id, result);

  } catch (error) {
    sendMCPToolResult(id, { error: error.message }, true);
  }
}

async function initializeProject(projectPath) {
  log('info', 'initializeProject called with:', projectPath);

  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }

  const projectType = detectProjectType(projectPath);
  log('info', 'Project type:', projectType);

  // If already initialized for this project, just return status
  if (ready && currentProject === projectPath) {
    log('info', 'Already initialized for this project');
    return {
      status: 'ready',
      project: projectPath,
      projectType: projectType,
      workspace: WORKSPACE,
      ready: true,
      message: 'JDT.LS already initialized'
    };
  }

  // If not initialized, start in background
  if (!jdtlsProcess && !initializing) {
    log('info', 'Starting JDT.LS in background...');
    // Start asynchronously - don't wait
    startJDTLS(projectPath).catch(e => {
      log('error', 'Background JDT.LS start failed:', e.message);
    });

    // Return immediately with initializing status
    return {
      status: 'initializing',
      project: projectPath,
      projectType: projectType,
      message: 'JDT.LS starting in background. Try again in 30 seconds.',
      ready: false
    };
  }

  // If initializing, return status
  if (initializing) {
    return {
      status: 'initializing',
      project: projectPath,
      projectType: projectType,
      message: 'JDT.LS is initializing. Try again in a few seconds.',
      ready: false
    };
  }

  // If ready but different project, need to restart
  if (ready && currentProject !== projectPath) {
    log('info', 'Need to restart for new project');
    cleanup();

    // Start new project in background
    startJDTLS(projectPath).catch(e => {
      log('error', 'Background JDT.LS restart failed:', e.message);
    });

    return {
      status: 'restarting',
      project: projectPath,
      projectType: projectType,
      message: 'Restarting JDT.LS for new project. Try again in 30 seconds.',
      ready: false
    };
  }

  // Default case - ready
  return {
    status: 'ready',
    project: projectPath,
    projectType: projectType,
    workspace: WORKSPACE,
    ready: ready,
    message: 'JDT.LS is ready'
  };
}

async function getSymbols(query) {
  if (!ready) {
    throw new Error('JDT.LS not initialized. Call initialize_project first.');
  }

  const result = await sendRequest('workspace/symbol', {
    query: query || ''
  });

  if (!result || result.length === 0) {
    return {
      query: query,
      count: 0,
      symbols: [],
      message: 'No symbols found. Project may still be indexing.'
    };
  }

  // Group symbols by type
  const byKind = {};
  result.forEach(sym => {
    const kind = getSymbolKindName(sym.kind);
    if (!byKind[kind]) byKind[kind] = [];
    byKind[kind].push(sym);
  });

  return {
    query: query,
    count: result.length,
    byType: Object.keys(byKind).map(k => ({
      type: k,
      count: byKind[k].length
    })),
    symbols: result.slice(0, 50).map(sym => ({
      name: sym.name,
      kind: getSymbolKindName(sym.kind),
      containerName: sym.containerName || '',
      location: sym.location.uri.replace('file://', '')
    }))
  };
}

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

async function listClasses() {
  if (!ready) {
    throw new Error('JDT.LS not initialized. Call initialize_project first.');
  }

  // Get all symbols (empty query) with a shorter timeout
  let result;
  try {
    // Use a more specific query to avoid getting too many results
    result = await sendRequest('workspace/symbol', {
      query: '*'
    });
  } catch (e) {
    log('error', 'Failed to get workspace symbols:', e.message);
    return {
      count: 0,
      classes: [],
      message: 'Failed to query workspace symbols: ' + e.message
    };
  }

  if (!result || result.length === 0) {
    return {
      count: 0,
      classes: [],
      message: 'No classes indexed yet'
    };
  }

  // Filter for classes (SymbolKind.Class = 5)
  const classes = result
    .filter(s => s.kind === 5)
    .map(s => s.containerName ? `${s.containerName}.${s.name}` : s.name);

  // Count project vs JDK classes
  const projectClasses = classes.filter(c =>
    c.startsWith('com.frazierlifesciences') ||
    c.startsWith('com.example'));
  const jdkClasses = classes.filter(c =>
    c.startsWith('java.') ||
    c.startsWith('javax.') ||
    c.startsWith('jdk.'));

  return {
    count: classes.length,
    classes: classes.slice(0, 100), // Limit to first 100 for readability
    projectClassCount: projectClasses.length,
    jdkClassCount: jdkClasses.length,
    message: projectClasses.length > 0 ?
      'Project classes indexed successfully' :
      'Only JDK classes found - project may still be importing'
  };
}

function sendMCPToolResult(id, data, isError = false) {
  console.log(JSON.stringify({
    jsonrpc: '2.0',
    id: id,
    result: {
      content: [{
        type: 'text',
        text: JSON.stringify(data, null, 2)
      }],
      isError: isError
    }
  }));
}

function sendMCPError(id, code, message) {
  console.log(JSON.stringify({
    jsonrpc: '2.0',
    id: id,
    error: { code, message }
  }));
}

// Cleanup on exit
process.on('SIGTERM', () => {
  if (jdtlsProcess) {
    sendMessage({ jsonrpc: '2.0', method: 'shutdown', id: requestId++ });
    setTimeout(() => {
      if (jdtlsProcess) jdtlsProcess.kill();
    }, 1000);
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  if (jdtlsProcess) jdtlsProcess.kill();
  process.exit(0);
});

process.stdin.resume();

console.error('[MCP] Eclipse JDT.LS (Gradle-aware) ready');