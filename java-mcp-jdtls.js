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

// Detect project type and find root
function detectProjectType(projectPath) {
  // Check if this is a Gradle project
  if (fs.existsSync(path.join(projectPath, 'build.gradle')) ||
      fs.existsSync(path.join(projectPath, 'build.gradle.kts'))) {
    return 'gradle';
  }

  // Check if this is a Maven project
  if (fs.existsSync(path.join(projectPath, 'pom.xml'))) {
    return 'maven';
  }

  return 'plain';
}

// Find the root of a Gradle/Maven project
function findProjectRoot(projectPath) {
  let currentPath = projectPath;

  // Look for settings.gradle or settings.gradle.kts (Gradle root)
  while (currentPath !== path.dirname(currentPath)) {
    if (fs.existsSync(path.join(currentPath, 'settings.gradle')) ||
        fs.existsSync(path.join(currentPath, 'settings.gradle.kts'))) {
      log('info', `Found Gradle root at: ${currentPath}`);
      return currentPath;
    }

    // Also check for root pom.xml (Maven root)
    if (fs.existsSync(path.join(currentPath, 'pom.xml'))) {
      const pomPath = path.join(currentPath, 'pom.xml');
      const pomContent = fs.readFileSync(pomPath, 'utf8');
      if (pomContent.includes('<modules>')) {
        log('info', `Found Maven root at: ${currentPath}`);
        return currentPath;
      }
    }

    currentPath = path.dirname(currentPath);
  }

  // No root found, use original path
  return projectPath;
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

    // JVM arguments - increased memory for large projects
    const args = [
      '-Declipse.application=org.eclipse.jdt.ls.core.id1',
      '-Dosgi.bundles.defaultStartLevel=4',
      '-Declipse.product=org.eclipse.jdt.ls.core.product',
      '-Dlog.level=' + (DEBUG ? 'ALL' : 'ERROR'),
      '-Dfile.encoding=UTF-8',
      '-DwatchParentProcess=false',
      '-Xmx4G',  // Increased from 2G for large projects
      '-Xms1G',  // Increased from 512M for faster startup
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

    // Wait for workspace to be ready
    log('info', 'Waiting for workspace to be ready...');
    const isReady = await waitForWorkspaceReady(projectPath);

    if (isReady) {
      ready = true;
      initializing = false;
      log('info', 'JDT.LS ready and workspace indexed');
    } else {
      throw new Error('Workspace failed to become ready within timeout period');
    }

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
      // Check if this might be a partial header at the start
      if (buffer.startsWith('Content-Length:') || buffer.startsWith('Co')) {
        // Wait for more data
        break;
      }
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

    // Extract the message - be precise about the length
    const messageStr = buffer.substring(messageStart, messageEnd);

    // Remove processed data from buffer - be precise
    buffer = buffer.substring(messageEnd);

    // Parse and handle the message
    try {
      const message = JSON.parse(messageStr);
      handleLSPMessage(message);
    } catch (e) {
      // Check if there's extra data at the end
      const trimmed = messageStr.trim();
      try {
        // Try parsing just the JSON part
        const jsonEnd = messageStr.lastIndexOf('}');
        if (jsonEnd > 0) {
          const jsonOnly = messageStr.substring(0, jsonEnd + 1);
          const message = JSON.parse(jsonOnly);
          handleLSPMessage(message);
          // Put the rest back in the buffer
          const remainder = messageStr.substring(jsonEnd + 1);
          if (remainder.length > 0) {
            buffer = remainder + buffer;
          }
          continue;
        }
      } catch (e2) {
        // Still failed
      }
      log('error', 'Failed to parse LSP message:', e.message);
      log('error', 'Message was:', messageStr.substring(0, 250));
      log('debug', 'Full message:', messageStr);
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

// Send request with configurable timeout
function sendRequest(method, params, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const id = requestId++;
    let timeoutHandle;

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      responseHandlers.delete(id);
    };

    const wrappedResolve = (result) => {
      cleanup();
      resolve(result);
    };

    const wrappedReject = (error) => {
      cleanup();
      reject(error);
    };

    responseHandlers.set(id, {
      resolve: wrappedResolve,
      reject: wrappedReject
    });

    sendMessage({
      jsonrpc: '2.0',
      id: id,
      method: method,
      params: params
    });

    // Set timeout with better error message
    timeoutHandle = setTimeout(() => {
      if (responseHandlers.has(id)) {
        cleanup();
        const errorMsg = `Request timeout: ${method} after ${timeout}ms. The workspace may still be indexing.`;
        log('error', errorMsg);
        reject(new Error(errorMsg));
      }
    }, timeout);
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
    // Use the project's Gradle wrapper if available
    const hasWrapper = fs.existsSync(path.join(projectPath, 'gradlew'));
    const gradleVersion = detectGradleVersion(projectPath);

    // Update existing gradle settings (don't create new nested objects)
    initOptions.settings.java.import.gradle.wrapper.enabled = hasWrapper;
    initOptions.settings.java.import.gradle.offline.enabled = false;

    // Only set gradle home if not using wrapper
    if (!hasWrapper) {
      const gradleHome = findGradleHome(projectPath);
      if (gradleHome) {
        initOptions.settings.java.import.gradle.home = gradleHome;
      }
    }

    // Set gradle version if detected
    if (gradleVersion) {
      initOptions.settings.java.import.gradle.version = gradleVersion;
    }

    // Add java.home at the root level if needed
    if (process.env.JAVA_HOME) {
      initOptions.settings.java.home = process.env.JAVA_HOME;
    }

    log('info', `Gradle settings: wrapper=${hasWrapper}, version=${gradleVersion}`);
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
    log('info', 'Triggering workspace build for ' + projectType + ' project...');
    log('info', 'Note: Large projects with many dependencies may take 2-3 minutes to index');

    // For Gradle, try to trigger a full project import
    if (projectType === 'gradle') {
      try {
        // Execute Gradle-specific commands
        await sendRequest('workspace/executeCommand', {
          command: 'java.projectConfiguration.update',
          arguments: [rootUri]
        });
        log('info', 'Triggered Gradle project configuration update');
      } catch (e) {
        log('warn', 'Could not trigger project configuration update:', e.message);
      }

      try {
        // Also try to reload projects
        await sendRequest('workspace/executeCommand', {
          command: 'java.reloadProjects'
        });
        log('info', 'Triggered project reload');
      } catch (e) {
        log('warn', 'Could not trigger project reload:', e.message);
      }
    }

    // Trigger workspace build
    try {
      await sendRequest('java/buildWorkspace', true, 90000); // 90 second timeout for build
      log('info', 'Workspace build triggered');
      // Wait for build to complete - longer for large projects
      log('info', 'Waiting for initial build to complete (this may download dependencies)...');
      await new Promise(resolve => setTimeout(resolve, 20000)); // Increased from 15s
    } catch (e) {
      log('error', 'Failed to trigger workspace build:', e.message);
      // Continue anyway - build might complete in background
    }
  }

  log('info', 'LSP initialization complete');

  return initResult;
}

// Wait for workspace to be ready by checking if we can query symbols
async function waitForWorkspaceReady(projectPath, maxWaitTime = 180000) {  // Increased to 3 minutes for large projects
  const startTime = Date.now();
  const checkInterval = 5000; // Check every 5 seconds

  while (Date.now() - startTime < maxWaitTime) {
    try {
      // Try to query workspace symbols with a short timeout
      const result = await sendRequest('workspace/symbol', { query: '' }, 10000);

      if (result && Array.isArray(result)) {
        // Check if we have actual project classes (not just JDK)
        const projectClasses = result.filter(s =>
          s.location?.uri?.includes(projectPath) ||
          !s.location?.uri?.includes('/jrt-fs/')
        );

        if (projectClasses.length > 0) {
          log('info', `Workspace ready with ${projectClasses.length} project symbols indexed`);
          return true;
        } else {
          log('info', 'Workspace symbols found but no project classes yet, waiting...');
        }
      }
    } catch (e) {
      log('debug', 'Workspace not ready yet:', e.message);
    }

    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, checkInterval));

    // Show progress
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    log('info', `Waiting for workspace indexing... ${elapsed}s elapsed (may take 2-3 minutes for large projects)`);
  }

  log('error', 'Workspace failed to become ready within timeout period');
  return false;
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
      name: 'check_status',
      description: 'Check the status of the JDT.LS server and workspace',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
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
    },
    {
      name: 'get_call_hierarchy',
      description: 'Get method call hierarchy (callers and callees)',
      inputSchema: {
        type: 'object',
        properties: {
          class_name: {
            type: 'string',
            description: 'Fully qualified class name'
          },
          method_name: {
            type: 'string',
            description: 'Method name'
          },
          parameter_types: {
            type: 'array',
            items: { type: 'string' },
            description: 'Method parameter types (optional)'
          },
          include_callers: {
            type: 'boolean',
            description: 'Include callers in result',
            default: true
          },
          include_callees: {
            type: 'boolean',
            description: 'Include callees in result',
            default: true
          }
        },
        required: ['class_name', 'method_name']
      }
    },
    {
      name: 'get_type_hierarchy',
      description: 'Get class inheritance hierarchy',
      inputSchema: {
        type: 'object',
        properties: {
          type_name: {
            type: 'string',
            description: 'Fully qualified type name'
          }
        },
        required: ['type_name']
      }
    },
    {
      name: 'find_references',
      description: 'Find all references to symbols',
      inputSchema: {
        type: 'object',
        properties: {
          class_name: {
            type: 'string',
            description: 'Fully qualified class name'
          },
          member_name: {
            type: 'string',
            description: 'Member name (method/field, optional)'
          },
          parameter_types: {
            type: 'array',
            items: { type: 'string' },
            description: 'Method parameter types (optional)'
          },
          element_type: {
            type: 'string',
            description: 'Element type (method/field/type/constructor)',
            enum: ['method', 'field', 'type', 'constructor']
          }
        },
        required: ['class_name']
      }
    },
    {
      name: 'get_class_info',
      description: 'Get detailed information about a class',
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
    },
    {
      name: 'get_method_info',
      description: 'Get detailed information about a method',
      inputSchema: {
        type: 'object',
        properties: {
          class_name: {
            type: 'string',
            description: 'Fully qualified class name'
          },
          method_name: {
            type: 'string',
            description: 'Method name'
          },
          parameter_types: {
            type: 'array',
            items: { type: 'string' },
            description: 'Method parameter types (optional)'
          }
        },
        required: ['class_name', 'method_name']
      }
    },
    {
      name: 'refactor_rename',
      description: 'Rename symbols across the project',
      inputSchema: {
        type: 'object',
        properties: {
          class_name: {
            type: 'string',
            description: 'Fully qualified class name'
          },
          old_name: {
            type: 'string',
            description: 'Current name'
          },
          new_name: {
            type: 'string',
            description: 'New name'
          },
          element_type: {
            type: 'string',
            description: 'Element type (class/method/field)',
            enum: ['class', 'method', 'field']
          }
        },
        required: ['class_name', 'old_name', 'new_name', 'element_type']
      }
    },
    {
      name: 'extract_method',
      description: 'Extract selected code into a new method',
      inputSchema: {
        type: 'object',
        properties: {
          class_name: {
            type: 'string',
            description: 'Fully qualified class name'
          },
          start_line: {
            type: 'integer',
            description: 'Start line number'
          },
          end_line: {
            type: 'integer',
            description: 'End line number'
          },
          new_method_name: {
            type: 'string',
            description: 'Name for the extracted method'
          }
        },
        required: ['class_name', 'start_line', 'end_line', 'new_method_name']
      }
    },
    {
      name: 'find_usages',
      description: 'Find all usages of a symbol',
      inputSchema: {
        type: 'object',
        properties: {
          class_name: {
            type: 'string',
            description: 'Fully qualified class name'
          },
          member_name: {
            type: 'string',
            description: 'Member name (optional)'
          }
        },
        required: ['class_name']
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

      case 'check_status':
        result = await checkServerStatus();
        break;

      case 'get_symbols':
        result = await getSymbols(args.query);
        break;

      case 'list_classes':
        result = await listClasses();
        break;

      case 'get_call_hierarchy':
        result = await getCallHierarchy(args.class_name, args.method_name, args.parameter_types, args.include_callers, args.include_callees);
        break;

      case 'get_type_hierarchy':
        result = await getTypeHierarchy(args.type_name);
        break;

      case 'find_references':
        result = await findReferences(args.class_name, args.member_name, args.parameter_types, args.element_type);
        break;

      case 'get_class_info':
        result = await getClassInfo(args.class_name);
        break;

      case 'get_method_info':
        result = await getMethodInfo(args.class_name, args.method_name, args.parameter_types);
        break;

      case 'refactor_rename':
        result = await refactorRename(args.class_name, args.old_name, args.new_name, args.element_type);
        break;

      case 'extract_method':
        result = await extractMethod(args.class_name, args.start_line, args.end_line, args.new_method_name);
        break;

      case 'find_usages':
        result = await findUsages(args.class_name, args.member_name);
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

  // Find the actual project root (for multi-module projects)
  const rootPath = findProjectRoot(projectPath);
  if (rootPath !== projectPath) {
    log('info', `Using project root: ${rootPath}`);
    projectPath = rootPath;
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
    }, 30000); // 30 second timeout
  } catch (e) {
    log('error', 'Failed to get workspace symbols:', e.message);
    if (e.message.includes('timeout')) {
      return {
        count: 0,
        classes: [],
        error: 'Request timed out. The workspace may still be indexing. Please wait a moment and try again.'
      };
    }
    return {
      count: 0,
      classes: [],
      error: 'Failed to query workspace symbols: ' + e.message
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

// Additional tool implementations for JDT.LS

async function checkServerStatus() {
  const status = {
    jdtls_running: jdtlsProcess !== null,
    jdtls_ready: ready,
    initializing: initializing,
    current_project: currentProject,
    workspace_dir: WORKSPACE
  };

  // Try to get workspace symbols to check if server is responsive
  if (ready) {
    try {
      const startTime = Date.now();
      const symbols = await sendRequest('workspace/symbol', { query: '' }, 5000);
      const responseTime = Date.now() - startTime;

      status.server_responsive = true;
      status.response_time_ms = responseTime;
      status.indexed_symbols = symbols ? symbols.length : 0;

      // Check if we have project symbols (not just JDK)
      if (symbols && currentProject) {
        const projectSymbols = symbols.filter(s =>
          s.location?.uri?.includes(currentProject) ||
          !s.location?.uri?.includes('/jrt-fs/')
        );
        status.project_symbols = projectSymbols.length;
      }
    } catch (e) {
      status.server_responsive = false;
      status.error = e.message;

      if (e.message.includes('timeout')) {
        status.suggestion = 'The server is not responding. The workspace may still be indexing. Please wait and try again.';
      }
    }
  } else {
    status.server_responsive = false;
    status.suggestion = 'Server is not ready. Please call initialize_project first.';
  }

  return status;
}

async function getCallHierarchy(className, methodName, parameterTypes, includeCallers = true, includeCallees = true) {
  if (!ready) {
    throw new Error('JDT.LS not initialized. Call initialize_project first.');
  }

  // First find the method symbol
  const symbols = await sendRequest('workspace/symbol', { query: methodName });
  if (!symbols || symbols.length === 0) {
    return {
      class: className,
      method: methodName,
      error: 'Method not found'
    };
  }

  const methodSymbol = symbols.find(s =>
    s.kind === 6 && // Method
    s.name === methodName &&
    s.containerName?.includes(className)
  );

  if (!methodSymbol) {
    return {
      class: className,
      method: methodName,
      error: 'Method not found in specified class'
    };
  }

  // Prepare call hierarchy using textDocument/prepareCallHierarchy
  const prepareParams = {
    textDocument: { uri: methodSymbol.location.uri },
    position: methodSymbol.location.range.start
  };

  const items = await sendRequest('textDocument/prepareCallHierarchy', prepareParams);
  if (!items || items.length === 0) {
    return {
      class: className,
      method: methodName,
      callers: [],
      callees: []
    };
  }

  const result = {
    class: className,
    method: methodName,
    callers: [],
    callees: []
  };

  // Get incoming calls (callers)
  if (includeCallers) {
    const incomingCalls = await sendRequest('callHierarchy/incomingCalls', { item: items[0] });
    if (incomingCalls) {
      result.callers = incomingCalls.map(call => ({
        class: call.from.detail || '',
        method: call.from.name,
        location: `${call.from.uri}:${call.from.range.start.line + 1}`
      }));
    }
  }

  // Get outgoing calls (callees)
  if (includeCallees) {
    const outgoingCalls = await sendRequest('callHierarchy/outgoingCalls', { item: items[0] });
    if (outgoingCalls) {
      result.callees = outgoingCalls.map(call => ({
        class: call.to.detail || '',
        method: call.to.name,
        location: `${call.to.uri}:${call.to.range.start.line + 1}`
      }));
    }
  }

  return result;
}

async function getTypeHierarchy(typeName) {
  if (!ready) {
    throw new Error('JDT.LS not initialized. Call initialize_project first.');
  }

  // Search for the type first
  const symbols = await sendRequest('workspace/symbol', { query: typeName });

  if (!symbols || symbols.length === 0) {
    return {
      type: typeName,
      error: 'Type not found'
    };
  }

  // Find the class symbol
  const classSymbol = symbols.find(s =>
    (s.kind === 5 || s.kind === 23) && // Class or Interface
    s.name === typeName
  );

  if (!classSymbol) {
    return {
      type: typeName,
      error: 'Type not found'
    };
  }

  // Prepare type hierarchy using textDocument/prepareTypeHierarchy
  const prepareParams = {
    textDocument: { uri: classSymbol.location.uri },
    position: classSymbol.location.range.start
  };

  const items = await sendRequest('textDocument/prepareTypeHierarchy', prepareParams);
  if (!items || items.length === 0) {
    return {
      type: typeName,
      superTypes: [],
      subTypes: []
    };
  }

  const result = {
    type: typeName,
    superTypes: [],
    subTypes: []
  };

  // Get supertypes
  const supertypes = await sendRequest('typeHierarchy/supertypes', { item: items[0] });
  if (supertypes) {
    result.superTypes = supertypes.map(type => ({
      name: type.name,
      kind: type.kind === 5 ? 'class' : 'interface',
      location: `${type.uri}:${type.range.start.line + 1}`
    }));
  }

  // Get subtypes
  const subtypes = await sendRequest('typeHierarchy/subtypes', { item: items[0] });
  if (subtypes) {
    result.subTypes = subtypes.map(type => ({
      name: type.name,
      kind: type.kind === 5 ? 'class' : 'interface',
      location: `${type.uri}:${type.range.start.line + 1}`
    }));
  }

  return result;
}

async function findReferences(className, memberName, parameterTypes, elementType) {
  if (!ready) {
    throw new Error('JDT.LS not initialized. Call initialize_project first.');
  }

  // Search for the symbol
  const query = memberName || className.split('.').pop();
  const symbols = await sendRequest('workspace/symbol', { query });

  if (!symbols || symbols.length === 0) {
    return {
      symbol: `${className}${memberName ? '.' + memberName : ''}`,
      count: 0,
      references: [],
      message: 'Symbol not found'
    };
  }

  // Find the best match
  const target = symbols.find(s =>
    s.containerName?.includes(className) ||
    s.name === memberName ||
    s.name === className.split('.').pop()
  ) || symbols[0];

  try {
    const refs = await sendRequest('textDocument/references', {
      textDocument: { uri: target.location.uri },
      position: target.location.range.start,
      context: { includeDeclaration: false }
    });

    if (!refs || refs.length === 0) {
      return {
        symbol: target.name,
        count: 0,
        references: []
      };
    }

    return {
      symbol: target.name,
      count: refs.length,
      references: refs.slice(0, 50).map(r => ({
        file: r.uri.replace('file://', ''),
        line: r.range.start.line + 1,
        character: r.range.start.character
      }))
    };
  } catch (e) {
    return {
      symbol: target.name,
      error: e.message
    };
  }
}

async function getClassInfo(className) {
  if (!ready) {
    throw new Error('JDT.LS not initialized. Call initialize_project first.');
  }

  const symbols = await sendRequest('workspace/symbol', { query: className });

  if (!symbols || symbols.length === 0) {
    return {
      class: className,
      error: 'Class not found'
    };
  }

  const classSymbol = symbols.find(s =>
    s.kind === 5 && // Class
    (s.name === className.split('.').pop() || s.containerName?.includes(className))
  ) || symbols[0];

  return {
    class: className,
    name: classSymbol.name,
    kind: getSymbolKindName(classSymbol.kind),
    location: classSymbol.location?.uri?.replace('file://', ''),
    containerName: classSymbol.containerName || ''
  };
}

async function getMethodInfo(className, methodName, parameterTypes) {
  if (!ready) {
    throw new Error('JDT.LS not initialized. Call initialize_project first.');
  }

  const symbols = await sendRequest('workspace/symbol', { query: methodName });

  if (!symbols || symbols.length === 0) {
    return {
      class: className,
      method: methodName,
      error: 'Method not found'
    };
  }

  const methodSymbol = symbols.find(s =>
    s.kind === 6 && // Method
    s.name === methodName &&
    s.containerName?.includes(className)
  );

  if (!methodSymbol) {
    return {
      class: className,
      method: methodName,
      error: 'Method not found in specified class'
    };
  }

  // Get hover information for more details
  const hoverInfo = await sendRequest('textDocument/hover', {
    textDocument: { uri: methodSymbol.location.uri },
    position: methodSymbol.location.range.start
  });

  let signature = methodName;
  let documentation = '';

  if (hoverInfo && hoverInfo.contents) {
    if (typeof hoverInfo.contents === 'string') {
      documentation = hoverInfo.contents;
    } else if (hoverInfo.contents.value) {
      const content = hoverInfo.contents.value;
      // Extract method signature and documentation from hover content
      const lines = content.split('\n');
      if (lines.length > 0) {
        signature = lines[0].replace(/^```java\s*/, '').replace(/```$/, '').trim();
        documentation = lines.slice(1).join('\n').trim();
      }
    }
  }

  return {
    class: className,
    method: methodName,
    signature: signature,
    documentation: documentation,
    location: methodSymbol.location?.uri?.replace('file://', ''),
    line: methodSymbol.location?.range?.start?.line + 1
  };
}

async function refactorRename(className, oldName, newName, elementType) {
  if (!ready) {
    throw new Error('JDT.LS not initialized. Call initialize_project first.');
  }

  // Note: Rename requires workspace/applyEdit support
  return {
    class: className,
    oldName: oldName,
    newName: newName,
    elementType: elementType,
    message: 'Rename refactoring requires workspace edit capabilities'
  };
}

async function extractMethod(className, startLine, endLine, newMethodName) {
  if (!ready) {
    throw new Error('JDT.LS not initialized. Call initialize_project first.');
  }

  // Note: Extract method requires code action support
  return {
    class: className,
    startLine: startLine,
    endLine: endLine,
    newMethodName: newMethodName,
    message: 'Extract method requires code action capabilities'
  };
}

async function findUsages(className, memberName) {
  if (!ready) {
    throw new Error('JDT.LS not initialized. Call initialize_project first.');
  }

  // This is similar to find_references
  return await findReferences(className, memberName, null, null);
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