package com.example;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import org.eclipse.core.runtime.CoreException;
import org.eclipse.core.runtime.Platform;
import org.eclipse.core.resources.ResourcesPlugin;
import org.eclipse.core.resources.IWorkspace;
import org.eclipse.core.runtime.adaptor.EclipseStarter;
import org.eclipse.jdt.core.JavaCore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.*;
import java.net.*;
import java.util.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

public class JavaMCPServer {
    private static final Logger logger = LoggerFactory.getLogger(JavaMCPServer.class);
    private final ObjectMapper objectMapper;
    private final JavaProjectAnalyzer projectAnalyzer;
    private CallHierarchyAnalyzer callHierarchyAnalyzer;
    private TypeHierarchyAnalyzer typeHierarchyAnalyzer;
    private ReferencesFinder referencesFinder;
    private RefactoringEngine refactoringEngine;
    
    // Track initialization state for Claude Code compatibility
    private boolean initialized = false;
    
    public JavaMCPServer() {
        this.objectMapper = new ObjectMapper();
        this.projectAnalyzer = new JavaProjectAnalyzer();
    }
    
    public static void main(String[] args) {
        // Skip Eclipse initialization for faster startup
        // Will be initialized on demand when needed
        
        JavaMCPServer server = new JavaMCPServer();
        server.run();
    }
    
    private static void initializeEclipseWorkspace() {
        // Lazy initialization - called when needed
        try {
            // Create workspace directory for when Eclipse APIs need it
            Path workspaceDir = createTemporaryWorkspace();
            System.setProperty("osgi.instance.area", workspaceDir.toUri().toString());
            System.setProperty("eclipse.ignoreApp", "true");
        } catch (Exception e) {
            logger.error("Failed to set up Eclipse environment: {}", e.getMessage());
            throw new RuntimeException("Failed to set up Eclipse environment: " + e.getMessage(), e);
        }
    }
    
    private static Path createTemporaryWorkspace() throws IOException {
        Path tempDir = Files.createTempDirectory("eclipse-workspace-");
        Files.createDirectories(tempDir.resolve("configuration"));
        
        // Add shutdown hook to clean up
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try {
                deleteDirectory(tempDir);
                logger.debug("Cleaned up temporary workspace: {}", tempDir);
            } catch (Exception e) {
                logger.warn("Failed to clean up temporary workspace: {}", e.getMessage());
            }
        }));
        
        return tempDir;
    }
    
    private static void deleteDirectory(Path directory) throws IOException {
        if (Files.exists(directory)) {
            Files.walk(directory)
                    .sorted((a, b) -> b.compareTo(a)) // Delete files before directories
                    .forEach(path -> {
                        try {
                            Files.delete(path);
                        } catch (IOException e) {
                            logger.debug("Could not delete {}: {}", path, e.getMessage());
                        }
                    });
        }
    }
    
    public void run() {
        // No startup logging for faster response
        
        // Use unbuffered output for immediate response
        PrintWriter writer = new PrintWriter(new OutputStreamWriter(System.out), false);
        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));
        
        // Keep track of EOF encounters
        int eofCount = 0;
        final int MAX_EOF_RETRIES = 50; // Wait for up to 5 seconds (50 * 100ms)
        
        try {
            String line;
            while (eofCount < MAX_EOF_RETRIES) {
                line = reader.readLine();
                
                if (line == null) {
                    // EOF encountered - wait a bit and retry
                    eofCount++;
                    if (eofCount == 1) {
                        logger.debug("EOF on stdin, waiting for reconnection...");
                    }
                    try {
                        Thread.sleep(100); // Wait 100ms before retry
                    } catch (InterruptedException e) {
                        break;
                    }
                    continue;
                }
                
                // Reset EOF counter on successful read
                eofCount = 0;
                
                // Skip empty lines
                if (line.trim().isEmpty()) {
                    continue;
                }
                
                try {
                    JsonNode request = objectMapper.readTree(line);
                    JsonNode response = handleRequest(request);
                    
                    if (response != null) {
                        String responseStr = objectMapper.writeValueAsString(response);
                        writer.println(responseStr);
                        writer.flush();
                        System.out.flush(); // Extra flush at system level
                        logger.debug("Sent response: {}", responseStr);
                    }
                } catch (Exception e) {
                    logger.error("Error processing request: {}", line, e);
                    JsonNode errorResponse = createErrorResponse(null, "parse_error", "Invalid JSON-RPC request");
                    String errorStr = objectMapper.writeValueAsString(errorResponse);
                    writer.println(errorStr);
                    writer.flush();
                    System.out.flush(); // Extra flush at system level
                    logger.debug("Sent error response: {}", errorStr);
                }
            }
        } catch (IOException e) {
            logger.error("IO error in main loop", e);
        } finally {
            try {
                writer.close();
                reader.close();
            } catch (IOException e) {
                logger.error("Error closing streams", e);
            }
        }
    }
    
    public void runTcpServer(int port) {
        System.err.println("Starting Java MCP TCP server on port " + port + "...");
        
        try (ServerSocket serverSocket = new ServerSocket(port)) {
            System.err.println("Java MCP TCP server listening on port " + port);
            
            while (true) {
                try {
                    Socket clientSocket = serverSocket.accept();
                    logger.info("Client connected from {}", clientSocket.getRemoteSocketAddress());
                    
                    // Handle each client in a new thread
                    new Thread(() -> handleTcpClient(clientSocket)).start();
                } catch (IOException e) {
                    logger.error("Error accepting client connection", e);
                }
            }
        } catch (IOException e) {
            logger.error("Failed to start TCP server on port {}", port, e);
        }
    }
    
    private void handleTcpClient(Socket clientSocket) {
        try (
            BufferedReader reader = new BufferedReader(new InputStreamReader(clientSocket.getInputStream()));
            PrintWriter writer = new PrintWriter(new OutputStreamWriter(clientSocket.getOutputStream()), false)
        ) {
            String line;
            while ((line = reader.readLine()) != null) {
                // Skip empty lines
                if (line.trim().isEmpty()) {
                    continue;
                }
                
                try {
                    JsonNode request = objectMapper.readTree(line);
                    JsonNode response = handleRequest(request);
                    
                    if (response != null) {
                        String responseStr = objectMapper.writeValueAsString(response);
                        writer.println(responseStr);
                        writer.flush();
                        logger.debug("Sent response: {}", responseStr);
                    }
                } catch (Exception e) {
                    logger.error("Error processing request: {}", line, e);
                    JsonNode errorResponse = createErrorResponse(null, "parse_error", "Invalid JSON-RPC request");
                    String errorStr = objectMapper.writeValueAsString(errorResponse);
                    writer.println(errorStr);
                    writer.flush();
                    logger.debug("Sent error response: {}", errorStr);
                }
            }
        } catch (IOException e) {
            logger.error("Error handling TCP client", e);
        } finally {
            try {
                clientSocket.close();
            } catch (IOException e) {
                logger.error("Error closing client socket", e);
            }
            logger.info("Client disconnected");
        }
    }
    
    private JsonNode handleRequest(JsonNode request) {
        String method = request.path("method").asText();
        JsonNode id = request.path("id");
        JsonNode params = request.path("params");
        
        logger.debug("Handling request: method={}, id={}", method, id);
        
        try {
            switch (method) {
                case "initialize":
                    return handleInitialize(id, params);
                case "notifications/initialized":
                    return handleInitialized(id, params);
                case "ping":
                    return handlePing(id);
                case "health":
                    return handleHealth(id);
                case "tools/list":
                    return handleToolsList(id);
                case "tools/call":
                    return handleToolCall(id, params);
                default:
                    return createErrorResponse(id, "method_not_found", "Method not found: " + method);
            }
        } catch (Exception e) {
            logger.error("Error handling request method: {}", method, e);
            return createErrorResponse(id, "internal_error", "Internal server error: " + e.getMessage());
        }
    }
    
    private JsonNode handleInitialize(JsonNode id, JsonNode params) {
        // Validate that params contains required fields (proper MCP protocol)
        if (params == null || params.isNull()) {
            return createErrorResponse(id, "invalid_params", "Initialize params are required");
        }
        
        // Check for required fields in params
        JsonNode clientProtocolVersion = params.path("protocolVersion");
        JsonNode clientCapabilities = params.path("capabilities"); 
        JsonNode clientInfo = params.path("clientInfo");
        
        // Log client information for debugging
        if (!clientProtocolVersion.isMissingNode()) {
            logger.debug("Client protocol version: {}", clientProtocolVersion.asText());
        }
        if (!clientInfo.isMissingNode()) {
            logger.debug("Client info: {}", clientInfo);
        }
        
        // Build response - use the client's protocol version if newer
        ObjectNode result = objectMapper.createObjectNode();
        String clientVersion = clientProtocolVersion.isMissingNode() ? "2024-11-05" : clientProtocolVersion.asText();
        if ("2025-06-18".equals(clientVersion)) {
            result.put("protocolVersion", "2025-06-18");
        } else {
            result.put("protocolVersion", "2024-11-05");
        }
        
        ObjectNode capabilities = objectMapper.createObjectNode();
        capabilities.put("tools", true);
        
        // Add roots capability that Claude Code expects
        ObjectNode roots = objectMapper.createObjectNode();
        capabilities.set("roots", roots);
        
        result.set("capabilities", capabilities);
        
        ObjectNode serverInfo = objectMapper.createObjectNode();
        serverInfo.put("name", "Java MCP Server");
        serverInfo.put("version", "1.0.0");
        result.set("serverInfo", serverInfo);
        
        // For Claude Code compatibility: mark as initialized immediately
        // (Claude Code doesn't send the notifications/initialized message)
        this.initialized = true;
        logger.debug("MCP server initialized - client protocol: {}", 
                    clientProtocolVersion.isMissingNode() ? "not provided" : clientProtocolVersion.asText());
        
        return createSuccessResponse(id, result);
    }
    
    private JsonNode handleInitialized(JsonNode id, JsonNode params) {
        // Handle the proper MCP notifications/initialized message
        this.initialized = true;
        logger.debug("MCP server initialized (proper MCP protocol)");
        
        // Notifications don't require a response in MCP protocol
        return null;
    }
    
    private JsonNode handlePing(JsonNode id) {
        // Simple ping/pong for health checks
        ObjectNode result = objectMapper.createObjectNode();
        result.put("pong", true);
        return createSuccessResponse(id, result);
    }
    
    private JsonNode handleHealth(JsonNode id) {
        // Health check endpoint
        ObjectNode result = objectMapper.createObjectNode();
        result.put("status", "healthy");
        result.put("initialized", this.initialized);
        return createSuccessResponse(id, result);
    }
    
    private JsonNode handleToolsList(JsonNode id) {
        ArrayNode tools = objectMapper.createArrayNode();
        
        // Initialize Project tool
        ObjectNode initProjectTool = objectMapper.createObjectNode();
        initProjectTool.put("name", "initialize_project");
        initProjectTool.put("description", "Initialize Java project analysis for a given directory path");
        ObjectNode initParams = objectMapper.createObjectNode();
        ObjectNode projectPathParam = objectMapper.createObjectNode();
        projectPathParam.put("type", "string");
        projectPathParam.put("description", "Absolute path to the Java project directory");
        projectPathParam.put("required", true);
        initParams.set("project_path", projectPathParam);
        initProjectTool.set("inputSchema", createInputSchema(initParams));
        tools.add(initProjectTool);
        
        // Get Call Hierarchy tool
        ObjectNode callHierarchyTool = objectMapper.createObjectNode();
        callHierarchyTool.put("name", "get_call_hierarchy");
        callHierarchyTool.put("description", "Get method call hierarchy (callers and callees)");
        ObjectNode callHierarchyParams = objectMapper.createObjectNode();
        callHierarchyParams.set("class_name", createStringParam("Fully qualified class name", true));
        callHierarchyParams.set("method_name", createStringParam("Method name", true));
        callHierarchyParams.set("parameter_types", createArrayParam("Method parameter types", false));
        callHierarchyParams.set("include_callers", createBooleanParam("Include callers in result", false));
        callHierarchyParams.set("include_callees", createBooleanParam("Include callees in result", false));
        callHierarchyTool.set("inputSchema", createInputSchema(callHierarchyParams));
        tools.add(callHierarchyTool);
        
        // Get Type Hierarchy tool
        ObjectNode typeHierarchyTool = objectMapper.createObjectNode();
        typeHierarchyTool.put("name", "get_type_hierarchy");
        typeHierarchyTool.put("description", "Get class inheritance hierarchy");
        ObjectNode typeHierarchyParams = objectMapper.createObjectNode();
        typeHierarchyParams.set("type_name", createStringParam("Fully qualified type name", true));
        typeHierarchyTool.set("inputSchema", createInputSchema(typeHierarchyParams));
        tools.add(typeHierarchyTool);
        
        // Find References tool
        ObjectNode findRefsTool = objectMapper.createObjectNode();
        findRefsTool.put("name", "find_references");
        findRefsTool.put("description", "Find all references to symbols");
        ObjectNode findRefsParams = objectMapper.createObjectNode();
        findRefsParams.set("class_name", createStringParam("Fully qualified class name", true));
        findRefsParams.set("member_name", createStringParam("Member name (method/field)", false));
        findRefsParams.set("parameter_types", createArrayParam("Method parameter types", false));
        findRefsParams.set("element_type", createStringParam("Element type (method/field/type/constructor)", false));
        findRefsTool.set("inputSchema", createInputSchema(findRefsParams));
        tools.add(findRefsTool);
        
        // Get Class Info tool
        ObjectNode classInfoTool = objectMapper.createObjectNode();
        classInfoTool.put("name", "get_class_info");
        classInfoTool.put("description", "Get detailed information about a class");
        ObjectNode classInfoParams = objectMapper.createObjectNode();
        classInfoParams.set("class_name", createStringParam("Fully qualified class name", true));
        classInfoTool.set("inputSchema", createInputSchema(classInfoParams));
        tools.add(classInfoTool);
        
        // List Classes tool
        ObjectNode listClassesTool = objectMapper.createObjectNode();
        listClassesTool.put("name", "list_classes");
        listClassesTool.put("description", "List all classes in the project");
        listClassesTool.set("inputSchema", createInputSchema(objectMapper.createObjectNode()));
        tools.add(listClassesTool);
        
        // Get Method Info tool
        ObjectNode methodInfoTool = objectMapper.createObjectNode();
        methodInfoTool.put("name", "get_method_info");
        methodInfoTool.put("description", "Get detailed information about a method");
        ObjectNode methodInfoParams = objectMapper.createObjectNode();
        methodInfoParams.set("class_name", createStringParam("Fully qualified class name", true));
        methodInfoParams.set("method_name", createStringParam("Method name", true));
        methodInfoParams.set("parameter_types", createArrayParam("Method parameter types", false));
        methodInfoTool.set("inputSchema", createInputSchema(methodInfoParams));
        tools.add(methodInfoTool);
        
        // Refactor Rename tool
        ObjectNode renameTool = objectMapper.createObjectNode();
        renameTool.put("name", "refactor_rename");
        renameTool.put("description", "Rename symbols across the project");
        ObjectNode renameParams = objectMapper.createObjectNode();
        renameParams.set("element_type", createStringParam("Element type (class/method/field)", true));
        renameParams.set("class_name", createStringParam("Fully qualified class name", true));
        renameParams.set("member_name", createStringParam("Member name (for methods/fields)", false));
        renameParams.set("parameter_types", createArrayParam("Method parameter types", false));
        renameParams.set("new_name", createStringParam("New name", true));
        renameParams.set("preview", createBooleanParam("Preview changes only", false));
        renameTool.set("inputSchema", createInputSchema(renameParams));
        tools.add(renameTool);
        
        ObjectNode result = objectMapper.createObjectNode();
        result.set("tools", tools);
        
        return createSuccessResponse(id, result);
    }
    
    private JsonNode handleToolCall(JsonNode id, JsonNode params) {
        String toolName = params.path("name").asText();
        JsonNode arguments = params.path("arguments");
        
        logger.debug("Tool call: name={}, args={}", toolName, arguments);
        
        try {
            switch (toolName) {
                case "initialize_project":
                    return handleInitializeProject(id, arguments);
                case "get_call_hierarchy":
                    return handleGetCallHierarchy(id, arguments);
                case "get_type_hierarchy":
                    return handleGetTypeHierarchy(id, arguments);
                case "find_references":
                    return handleFindReferences(id, arguments);
                case "get_class_info":
                    return handleGetClassInfo(id, arguments);
                case "list_classes":
                    return handleListClasses(id, arguments);
                case "get_method_info":
                    return handleGetMethodInfo(id, arguments);
                case "refactor_rename":
                    return handleRefactorRename(id, arguments);
                default:
                    return createErrorResponse(id, "unknown_tool", "Unknown tool: " + toolName);
            }
        } catch (Exception e) {
            logger.error("Error executing tool: {}", toolName, e);
            return createErrorResponse(id, "tool_error", "Tool execution failed: " + e.getMessage());
        }
    }
    
    private JsonNode handleInitializeProject(JsonNode id, JsonNode arguments) throws CoreException {
        String projectPath = arguments.path("project_path").asText();
        
        if (projectPath.isEmpty()) {
            return createErrorResponse(id, "invalid_params", "project_path is required");
        }
        
        projectAnalyzer.initializeProject(projectPath);
        
        // Initialize analyzers
        callHierarchyAnalyzer = new CallHierarchyAnalyzer(projectAnalyzer);
        typeHierarchyAnalyzer = new TypeHierarchyAnalyzer(projectAnalyzer);
        referencesFinder = new ReferencesFinder(projectAnalyzer);
        refactoringEngine = new RefactoringEngine(projectAnalyzer);
        
        Map<String, Object> projectInfo = projectAnalyzer.getProjectInfo();
        ObjectNode result = objectMapper.valueToTree(projectInfo);
        result.put("initialized", true);
        result.put("message", "Project initialized successfully");
        
        return createSuccessResponse(id, result);
    }
    
    private JsonNode handleGetCallHierarchy(JsonNode id, JsonNode arguments) throws CoreException {
        if (!checkInitialized(id)) {
            return createErrorResponse(id, "not_initialized", "Project not initialized");
        }
        
        String className = arguments.path("class_name").asText();
        String methodName = arguments.path("method_name").asText();
        String[] paramTypes = getStringArray(arguments.path("parameter_types"));
        boolean includeCallers = arguments.path("include_callers").asBoolean(true);
        boolean includeCallees = arguments.path("include_callees").asBoolean(true);
        
        Map<String, Object> hierarchy = callHierarchyAnalyzer.getCallHierarchy(
            className, methodName, paramTypes, includeCallers, includeCallees);
        
        return createSuccessResponse(id, objectMapper.valueToTree(hierarchy));
    }
    
    private JsonNode handleGetTypeHierarchy(JsonNode id, JsonNode arguments) throws CoreException {
        if (!checkInitialized(id)) {
            return createErrorResponse(id, "not_initialized", "Project not initialized");
        }
        
        String typeName = arguments.path("type_name").asText();
        Map<String, Object> hierarchy = typeHierarchyAnalyzer.getCompleteHierarchy(typeName);
        
        return createSuccessResponse(id, objectMapper.valueToTree(hierarchy));
    }
    
    private JsonNode handleFindReferences(JsonNode id, JsonNode arguments) throws CoreException {
        if (!checkInitialized(id)) {
            return createErrorResponse(id, "not_initialized", "Project not initialized");
        }
        
        String className = arguments.path("class_name").asText();
        String memberName = arguments.path("member_name").asText();
        String[] paramTypes = getStringArray(arguments.path("parameter_types"));
        String elementType = arguments.path("element_type").asText();
        
        List<Map<String, Object>> references;
        
        if ("method".equals(elementType)) {
            references = referencesFinder.findMethodReferences(className, memberName, paramTypes);
        } else if ("field".equals(elementType)) {
            references = referencesFinder.findFieldReferences(className, memberName);
        } else if ("constructor".equals(elementType)) {
            references = referencesFinder.findConstructorReferences(className, paramTypes);
        } else if ("type".equals(elementType)) {
            references = referencesFinder.findTypeReferences(className);
        } else {
            // Find all references if no specific type
            Map<String, Object> allRefs = referencesFinder.findAllReferences(className, memberName);
            return createSuccessResponse(id, objectMapper.valueToTree(allRefs));
        }
        
        ObjectNode result = objectMapper.createObjectNode();
        result.set("references", objectMapper.valueToTree(references));
        result.put("totalCount", references.size());
        
        return createSuccessResponse(id, result);
    }
    
    private JsonNode handleGetClassInfo(JsonNode id, JsonNode arguments) throws CoreException {
        if (!checkInitialized(id)) {
            return createErrorResponse(id, "not_initialized", "Project not initialized");
        }
        
        String className = arguments.path("class_name").asText();
        Map<String, Object> classInfo = getDetailedClassInfo(className);
        
        return createSuccessResponse(id, objectMapper.valueToTree(classInfo));
    }
    
    private JsonNode handleListClasses(JsonNode id, JsonNode arguments) throws CoreException {
        if (!checkInitialized(id)) {
            return createErrorResponse(id, "not_initialized", "Project not initialized");
        }
        
        List<org.eclipse.jdt.core.IType> types = projectAnalyzer.getAllTypes();
        ArrayNode classList = objectMapper.createArrayNode();
        
        for (org.eclipse.jdt.core.IType type : types) {
            ObjectNode typeInfo = objectMapper.createObjectNode();
            typeInfo.put("fullyQualifiedName", type.getFullyQualifiedName());
            typeInfo.put("simpleName", type.getElementName());
            typeInfo.put("packageName", type.getPackageFragment().getElementName());
            classList.add(typeInfo);
        }
        
        ObjectNode result = objectMapper.createObjectNode();
        result.set("classes", classList);
        result.put("totalCount", types.size());
        
        return createSuccessResponse(id, result);
    }
    
    private JsonNode handleGetMethodInfo(JsonNode id, JsonNode arguments) throws CoreException {
        if (!checkInitialized(id)) {
            return createErrorResponse(id, "not_initialized", "Project not initialized");
        }
        
        String className = arguments.path("class_name").asText();
        String methodName = arguments.path("method_name").asText();
        String[] paramTypes = getStringArray(arguments.path("parameter_types"));
        
        Map<String, Object> methodInfo = getDetailedMethodInfo(className, methodName, paramTypes);
        
        return createSuccessResponse(id, objectMapper.valueToTree(methodInfo));
    }
    
    private JsonNode handleRefactorRename(JsonNode id, JsonNode arguments) throws CoreException {
        if (!checkInitialized(id)) {
            return createErrorResponse(id, "not_initialized", "Project not initialized");
        }
        
        String elementType = arguments.path("element_type").asText();
        String className = arguments.path("class_name").asText();
        String memberName = arguments.path("member_name").asText();
        String[] paramTypes = getStringArray(arguments.path("parameter_types"));
        String newName = arguments.path("new_name").asText();
        boolean preview = arguments.path("preview").asBoolean(false);
        
        Map<String, Object> result;
        if (preview) {
            result = refactoringEngine.getRefactoringPreview(elementType, className, memberName, paramTypes, newName);
        } else {
            result = refactoringEngine.executeRefactoring(elementType, className, memberName, paramTypes, newName);
        }
        
        return createSuccessResponse(id, objectMapper.valueToTree(result));
    }
    
    private Map<String, Object> getDetailedClassInfo(String className) throws CoreException {
        org.eclipse.jdt.core.IType type = projectAnalyzer.findType(className);
        if (type == null) {
            Map<String, Object> result = new HashMap<>();
            result.put("error", "Class not found: " + className);
            return result;
        }
        
        Map<String, Object> info = new HashMap<>();
        info.put("fullyQualifiedName", type.getFullyQualifiedName());
        info.put("simpleName", type.getElementName());
        info.put("packageName", type.getPackageFragment().getElementName());
        
        // Get methods
        List<Map<String, Object>> methods = new ArrayList<>();
        org.eclipse.jdt.core.IMethod[] typeMethods = type.getMethods();
        for (org.eclipse.jdt.core.IMethod method : typeMethods) {
            Map<String, Object> methodInfo = new HashMap<>();
            methodInfo.put("name", method.getElementName());
            methodInfo.put("signature", method.getSignature());
            methodInfo.put("isConstructor", method.isConstructor());
            methods.add(methodInfo);
        }
        info.put("methods", methods);
        
        // Get fields
        List<Map<String, Object>> fields = new ArrayList<>();
        org.eclipse.jdt.core.IField[] typeFields = type.getFields();
        for (org.eclipse.jdt.core.IField field : typeFields) {
            Map<String, Object> fieldInfo = new HashMap<>();
            fieldInfo.put("name", field.getElementName());
            fieldInfo.put("type", org.eclipse.jdt.core.Signature.toString(field.getTypeSignature()));
            fields.add(fieldInfo);
        }
        info.put("fields", fields);
        
        return info;
    }
    
    private Map<String, Object> getDetailedMethodInfo(String className, String methodName, String[] paramTypes) 
                                                    throws CoreException {
        org.eclipse.jdt.core.IType type = projectAnalyzer.findType(className);
        if (type == null) {
            Map<String, Object> result = new HashMap<>();
            result.put("error", "Class not found: " + className);
            return result;
        }
        
        org.eclipse.jdt.core.IMethod method = null;
        if (paramTypes == null) {
            org.eclipse.jdt.core.IMethod[] methods = type.getMethods();
            for (org.eclipse.jdt.core.IMethod m : methods) {
                if (m.getElementName().equals(methodName)) {
                    method = m;
                    break;
                }
            }
        } else {
            method = type.getMethod(methodName, paramTypes);
        }
        
        if (method == null) {
            Map<String, Object> result = new HashMap<>();
            result.put("error", "Method not found: " + className + "." + methodName);
            return result;
        }
        
        Map<String, Object> info = new HashMap<>();
        info.put("name", method.getElementName());
        info.put("signature", method.getSignature());
        info.put("returnType", org.eclipse.jdt.core.Signature.toString(method.getReturnType()));
        info.put("isConstructor", method.isConstructor());
        info.put("declaringClass", method.getDeclaringType().getFullyQualifiedName());
        
        return info;
    }
    
    private boolean checkInitialized(JsonNode id) {
        return projectAnalyzer.isInitialized();
    }
    
    private String[] getStringArray(JsonNode arrayNode) {
        if (arrayNode == null || arrayNode.isNull() || !arrayNode.isArray()) {
            return null;
        }
        
        String[] result = new String[arrayNode.size()];
        for (int i = 0; i < arrayNode.size(); i++) {
            result[i] = arrayNode.get(i).asText();
        }
        return result;
    }
    
    private ObjectNode createInputSchema(ObjectNode properties) {
        ObjectNode schema = objectMapper.createObjectNode();
        schema.put("type", "object");
        schema.set("properties", properties);
        return schema;
    }
    
    private ObjectNode createStringParam(String description, boolean required) {
        ObjectNode param = objectMapper.createObjectNode();
        param.put("type", "string");
        param.put("description", description);
        return param;
    }
    
    private ObjectNode createArrayParam(String description, boolean required) {
        ObjectNode param = objectMapper.createObjectNode();
        param.put("type", "array");
        param.put("description", description);
        ObjectNode items = objectMapper.createObjectNode();
        items.put("type", "string");
        param.set("items", items);
        return param;
    }
    
    private ObjectNode createBooleanParam(String description, boolean required) {
        ObjectNode param = objectMapper.createObjectNode();
        param.put("type", "boolean");
        param.put("description", description);
        return param;
    }
    
    private JsonNode createSuccessResponse(JsonNode id, JsonNode result) {
        ObjectNode response = objectMapper.createObjectNode();
        response.set("result", result);
        response.put("jsonrpc", "2.0");
        response.set("id", id);
        return response;
    }
    
    private JsonNode createErrorResponse(Object id, String code, String message) {
        ObjectNode error = objectMapper.createObjectNode();
        error.put("code", code);
        error.put("message", message);
        
        ObjectNode response = objectMapper.createObjectNode();
        response.set("error", error);
        response.put("jsonrpc", "2.0");
        if (id instanceof JsonNode) {
            response.set("id", (JsonNode) id);
        } else if (id instanceof String) {
            response.put("id", (String) id);
        } else {
            response.putPOJO("id", id);
        }
        return response;
    }
}