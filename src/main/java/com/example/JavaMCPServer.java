package com.example;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import org.eclipse.core.runtime.CoreException;
import org.eclipse.core.runtime.Platform;
import org.eclipse.core.runtime.adaptor.EclipseStarter;
import org.eclipse.core.resources.ResourcesPlugin;
import org.osgi.framework.BundleContext;
import org.eclipse.core.resources.IWorkspace;
import org.eclipse.core.resources.IWorkspaceRoot;
import org.eclipse.jdt.core.JavaCore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.*;
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
        // Eclipse workspace will be initialized on demand through EclipseWorkspaceManager
        JavaMCPServer server = new JavaMCPServer();
        server.run();
    }
    
    // Eclipse workspace initialization is now handled by EclipseWorkspaceManager
    
    public void run() {
        // Log session ID if provided
        String sessionId = System.getProperty("session.id", "default");
        logger.info("Java MCP Server started (session: {})", sessionId);
        
        // Use unbuffered output for immediate response
        PrintWriter writer = new PrintWriter(new OutputStreamWriter(System.out), false);
        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));
        
        try {
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

        // Tools capability with proper structure
        ObjectNode tools = objectMapper.createObjectNode();
        tools.put("listChanged", false);  // We don't support dynamic tool list changes
        capabilities.set("tools", tools);

        // Add roots capability (empty object indicates support)
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
        initParams.set("project_path", createStringParam("Absolute path to the Java project directory"));
        ArrayNode initRequired = objectMapper.createArrayNode();
        initRequired.add("project_path");
        initProjectTool.set("inputSchema", createInputSchema(initParams, initRequired));
        tools.add(initProjectTool);
        
        // Get Call Hierarchy tool
        ObjectNode callHierarchyTool = objectMapper.createObjectNode();
        callHierarchyTool.put("name", "get_call_hierarchy");
        callHierarchyTool.put("description", "Get method call hierarchy (callers and callees)");
        ObjectNode callHierarchyParams = objectMapper.createObjectNode();
        callHierarchyParams.set("class_name", createStringParam("Fully qualified class name"));
        callHierarchyParams.set("method_name", createStringParam("Method name"));
        callHierarchyParams.set("parameter_types", createArrayParam("Method parameter types"));
        callHierarchyParams.set("include_callers", createBooleanParam("Include callers in result"));
        callHierarchyParams.set("include_callees", createBooleanParam("Include callees in result"));
        ArrayNode callRequired = objectMapper.createArrayNode();
        callRequired.add("class_name");
        callRequired.add("method_name");
        callHierarchyTool.set("inputSchema", createInputSchema(callHierarchyParams, callRequired));
        tools.add(callHierarchyTool);
        
        // Get Type Hierarchy tool
        ObjectNode typeHierarchyTool = objectMapper.createObjectNode();
        typeHierarchyTool.put("name", "get_type_hierarchy");
        typeHierarchyTool.put("description", "Get class inheritance hierarchy");
        ObjectNode typeHierarchyParams = objectMapper.createObjectNode();
        typeHierarchyParams.set("type_name", createStringParam("Fully qualified type name"));
        ArrayNode typeRequired = objectMapper.createArrayNode();
        typeRequired.add("type_name");
        typeHierarchyTool.set("inputSchema", createInputSchema(typeHierarchyParams, typeRequired));
        tools.add(typeHierarchyTool);
        
        // Find References tool
        ObjectNode findRefsTool = objectMapper.createObjectNode();
        findRefsTool.put("name", "find_references");
        findRefsTool.put("description", "Find all references to symbols");
        ObjectNode findRefsParams = objectMapper.createObjectNode();
        findRefsParams.set("class_name", createStringParam("Fully qualified class name"));
        findRefsParams.set("member_name", createStringParam("Member name (method/field)"));
        findRefsParams.set("parameter_types", createArrayParam("Method parameter types"));
        findRefsParams.set("element_type", createStringParam("Element type (method/field/type/constructor)"));
        ArrayNode findRefsRequired = objectMapper.createArrayNode();
        findRefsRequired.add("class_name");
        findRefsTool.set("inputSchema", createInputSchema(findRefsParams, findRefsRequired));
        tools.add(findRefsTool);
        
        // Get Class Info tool
        ObjectNode classInfoTool = objectMapper.createObjectNode();
        classInfoTool.put("name", "get_class_info");
        classInfoTool.put("description", "Get detailed information about a class");
        ObjectNode classInfoParams = objectMapper.createObjectNode();
        classInfoParams.set("class_name", createStringParam("Fully qualified class name"));
        ArrayNode classInfoRequired = objectMapper.createArrayNode();
        classInfoRequired.add("class_name");
        classInfoTool.set("inputSchema", createInputSchema(classInfoParams, classInfoRequired));
        tools.add(classInfoTool);
        
        // List Classes tool
        ObjectNode listClassesTool = objectMapper.createObjectNode();
        listClassesTool.put("name", "list_classes");
        listClassesTool.put("description", "List all classes in the project");
        listClassesTool.set("inputSchema", createInputSchema(objectMapper.createObjectNode(), objectMapper.createArrayNode()));
        tools.add(listClassesTool);
        
        // Get Method Info tool
        ObjectNode methodInfoTool = objectMapper.createObjectNode();
        methodInfoTool.put("name", "get_method_info");
        methodInfoTool.put("description", "Get detailed information about a method");
        ObjectNode methodInfoParams = objectMapper.createObjectNode();
        methodInfoParams.set("class_name", createStringParam("Fully qualified class name"));
        methodInfoParams.set("method_name", createStringParam("Method name"));
        methodInfoParams.set("parameter_types", createArrayParam("Method parameter types"));
        ArrayNode methodInfoRequired = objectMapper.createArrayNode();
        methodInfoRequired.add("class_name");
        methodInfoRequired.add("method_name");
        methodInfoTool.set("inputSchema", createInputSchema(methodInfoParams, methodInfoRequired));
        tools.add(methodInfoTool);
        
        // Refactor Rename tool
        ObjectNode renameTool = objectMapper.createObjectNode();
        renameTool.put("name", "refactor_rename");
        renameTool.put("description", "Rename symbols across the project");
        ObjectNode renameParams = objectMapper.createObjectNode();
        renameParams.set("element_type", createStringParam("Element type (class/method/field)"));
        renameParams.set("class_name", createStringParam("Fully qualified class name"));
        renameParams.set("member_name", createStringParam("Member name (for methods/fields)"));
        renameParams.set("parameter_types", createArrayParam("Method parameter types"));
        renameParams.set("new_name", createStringParam("New name"));
        renameParams.set("preview", createBooleanParam("Preview changes only"));
        ArrayNode renameRequired = objectMapper.createArrayNode();
        renameRequired.add("element_type");
        renameRequired.add("class_name");
        renameRequired.add("new_name");
        renameTool.set("inputSchema", createInputSchema(renameParams, renameRequired));
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
            JsonNode toolResult;
            switch (toolName) {
                case "initialize_project":
                    toolResult = handleInitializeProject(id, arguments);
                    break;
                case "get_call_hierarchy":
                    toolResult = handleGetCallHierarchy(id, arguments);
                    break;
                case "get_type_hierarchy":
                    toolResult = handleGetTypeHierarchy(id, arguments);
                    break;
                case "find_references":
                    toolResult = handleFindReferences(id, arguments);
                    break;
                case "get_class_info":
                    toolResult = handleGetClassInfo(id, arguments);
                    break;
                case "list_classes":
                    toolResult = handleListClasses(id, arguments);
                    break;
                case "get_method_info":
                    toolResult = handleGetMethodInfo(id, arguments);
                    break;
                case "refactor_rename":
                    toolResult = handleRefactorRename(id, arguments);
                    break;
                default:
                    return createToolErrorResponse(id, "Unknown tool: " + toolName);
            }

            // Check if the tool returned an error response
            if (toolResult.has("error")) {
                // It's already an error response, return as-is
                return toolResult;
            }

            // For successful tool calls, we need to wrap the result in MCP format
            // Extract the result from the standard response
            JsonNode resultData = toolResult.path("result");
            return createToolSuccessResponse(id, resultData);

        } catch (Exception e) {
            logger.error("Error executing tool: {}", toolName, e);
            return createToolErrorResponse(id, "Tool execution failed: " + e.getMessage());
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

        // Check if we're in basic mode
        if (projectAnalyzer.isBasicMode()) {
            Map<String, Object> result = new HashMap<>();
            result.put("error", "Type hierarchy analysis not available in basic mode. Full Eclipse workspace required.");
            result.put("type", typeName);
            result.put("mode", "basic");
            return createSuccessResponse(id, objectMapper.valueToTree(result));
        }

        if (typeHierarchyAnalyzer == null) {
            Map<String, Object> result = new HashMap<>();
            result.put("error", "Type hierarchy analyzer not initialized");
            return createSuccessResponse(id, objectMapper.valueToTree(result));
        }

        Map<String, Object> hierarchy = typeHierarchyAnalyzer.getCompleteHierarchy(typeName);
        return createSuccessResponse(id, objectMapper.valueToTree(hierarchy));
    }
    
    private JsonNode handleFindReferences(JsonNode id, JsonNode arguments) throws CoreException {
        if (!checkInitialized(id)) {
            return createErrorResponse(id, "not_initialized", "Project not initialized");
        }

        // Check if we're in basic mode
        if (projectAnalyzer.isBasicMode()) {
            Map<String, Object> result = new HashMap<>();
            result.put("error", "Reference finding not available in basic mode. Full Eclipse workspace required.");
            result.put("mode", "basic");
            return createSuccessResponse(id, objectMapper.valueToTree(result));
        }

        if (referencesFinder == null) {
            Map<String, Object> result = new HashMap<>();
            result.put("error", "References finder not initialized");
            return createSuccessResponse(id, objectMapper.valueToTree(result));
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
        
        ArrayNode classList = objectMapper.createArrayNode();
        
        // Check if we're in basic mode
        if (projectAnalyzer.isBasicMode()) {
            List<String> classes = projectAnalyzer.getBasicAnalyzer().getAllClasses();
            for (String className : classes) {
                classList.add(className);
            }
        } else {
            List<org.eclipse.jdt.core.IType> types = projectAnalyzer.getAllTypes();
            for (org.eclipse.jdt.core.IType type : types) {
                ObjectNode typeInfo = objectMapper.createObjectNode();
                typeInfo.put("fullyQualifiedName", type.getFullyQualifiedName());
                typeInfo.put("simpleName", type.getElementName());
                typeInfo.put("packageName", type.getPackageFragment().getElementName());
                classList.add(typeInfo);
            }
        }
        
        ObjectNode result = objectMapper.createObjectNode();
        result.set("classes", classList);
        result.put("totalCount", classList.size());
        
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

        // Check if we're in basic mode
        if (projectAnalyzer.isBasicMode()) {
            Map<String, Object> result = new HashMap<>();
            result.put("error", "Refactoring not available in basic mode. Full Eclipse workspace required.");
            result.put("mode", "basic");
            return createSuccessResponse(id, objectMapper.valueToTree(result));
        }

        if (refactoringEngine == null) {
            Map<String, Object> result = new HashMap<>();
            result.put("error", "Refactoring engine not initialized");
            return createSuccessResponse(id, objectMapper.valueToTree(result));
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
        // Check if we're in basic mode
        if (projectAnalyzer.isBasicMode()) {
            return projectAnalyzer.getBasicAnalyzer().getClassInfo(className);
        }
        
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
    
    private ObjectNode createInputSchema(ObjectNode properties, ArrayNode required) {
        ObjectNode schema = objectMapper.createObjectNode();
        schema.put("type", "object");
        schema.set("properties", properties);
        if (required != null && required.size() > 0) {
            schema.set("required", required);
        }
        return schema;
    }
    
    private ObjectNode createStringParam(String description) {
        ObjectNode param = objectMapper.createObjectNode();
        param.put("type", "string");
        param.put("description", description);
        return param;
    }
    
    private ObjectNode createArrayParam(String description) {
        ObjectNode param = objectMapper.createObjectNode();
        param.put("type", "array");
        param.put("description", description);
        ObjectNode items = objectMapper.createObjectNode();
        items.put("type", "string");
        param.set("items", items);
        return param;
    }
    
    private ObjectNode createBooleanParam(String description) {
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

    private JsonNode createToolSuccessResponse(JsonNode id, JsonNode data) {
        // Create the content array with a text item containing the JSON data
        ArrayNode content = objectMapper.createArrayNode();
        ObjectNode textContent = objectMapper.createObjectNode();
        textContent.put("type", "text");

        // Convert the data to a pretty-printed JSON string
        String jsonText;
        try {
            jsonText = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(data);
        } catch (Exception e) {
            jsonText = data.toString();
        }
        textContent.put("text", jsonText);
        content.add(textContent);

        // Create the result with content and isError
        ObjectNode result = objectMapper.createObjectNode();
        result.set("content", content);
        result.put("isError", false);

        // Wrap in standard JSON-RPC response
        ObjectNode response = objectMapper.createObjectNode();
        response.set("result", result);
        response.put("jsonrpc", "2.0");
        response.set("id", id);
        return response;
    }

    private JsonNode createToolErrorResponse(Object id, String errorMessage) {
        // Create the content array with error message
        ArrayNode content = objectMapper.createArrayNode();
        ObjectNode textContent = objectMapper.createObjectNode();
        textContent.put("type", "text");
        textContent.put("text", errorMessage);
        content.add(textContent);

        // Create the result with content and isError
        ObjectNode result = objectMapper.createObjectNode();
        result.set("content", content);
        result.put("isError", true);

        // Wrap in standard JSON-RPC response
        ObjectNode response = objectMapper.createObjectNode();
        response.set("result", result);
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