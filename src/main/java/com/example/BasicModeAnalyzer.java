package com.example;

import org.eclipse.jdt.core.dom.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Analyzer that works without Eclipse workspace using only AST parsing
 */
public class BasicModeAnalyzer {
    private static final Logger logger = LoggerFactory.getLogger(BasicModeAnalyzer.class);
    
    private String projectPath;
    private Map<String, CompilationUnit> astCache = new HashMap<>();
    private Map<String, String> sourceFiles = new HashMap<>(); // className -> filePath
    
    public BasicModeAnalyzer(String projectPath) {
        this.projectPath = projectPath;
        scanProjectFiles();
    }
    
    private void scanProjectFiles() {
        try {
            Path root = Paths.get(projectPath);
            final int[] fileCount = {0};
            Files.walk(root)
                .filter(path -> path.toString().endsWith(".java"))
                .forEach(path -> {
                    fileCount[0]++;
                    try {
                        String content = new String(Files.readAllBytes(path));
                        CompilationUnit ast = parseJavaFile(content);
                        
                        // Store the AST first
                        astCache.put(path.toString(), ast);
                        
                        // Extract class names from the file
                        ast.accept(new ASTVisitor() {
                            @Override
                            public boolean visit(TypeDeclaration node) {
                                String packageName = ast.getPackage() != null ? 
                                    ast.getPackage().getName().getFullyQualifiedName() : "";
                                String className = node.getName().getIdentifier();
                                String fullyQualifiedName = packageName.isEmpty() ? 
                                    className : packageName + "." + className;
                                
                                sourceFiles.put(fullyQualifiedName, path.toString());
                                logger.debug("Found class: {} in {}", fullyQualifiedName, path.getFileName());
                                return true;
                            }
                        });
                    } catch (Exception e) {
                        logger.warn("Failed to parse file: {} - {}", path.getFileName(), e.getMessage());
                    }
                });
            
            logger.info("Scanned {} Java files, found {} classes", fileCount[0], sourceFiles.size());
        } catch (Exception e) {
            logger.error("Failed to scan project files", e);
        }
    }
    
    private CompilationUnit parseJavaFile(String source) {
        ASTParser parser = ASTParser.newParser(AST.JLS_Latest);
        parser.setSource(source.toCharArray());
        parser.setKind(ASTParser.K_COMPILATION_UNIT);
        parser.setResolveBindings(false); // Don't resolve bindings in basic mode
        
        return (CompilationUnit) parser.createAST(null);
    }
    
    public Map<String, Object> getCallHierarchy(String className, String methodName, 
                                                 List<String> parameterTypes,
                                                 boolean includeCallers, 
                                                 boolean includeCallees) {
        Map<String, Object> result = new HashMap<>();
        
        String filePath = sourceFiles.get(className);
        if (filePath == null) {
            result.put("error", "Class not found: " + className);
            return result;
        }
        
        CompilationUnit ast = astCache.get(filePath);
        if (ast == null) {
            result.put("error", "AST not available for class: " + className);
            return result;
        }
        
        // Find the method in the AST
        MethodDeclaration targetMethod = findMethod(ast, className, methodName, parameterTypes);
        if (targetMethod == null) {
            result.put("error", "Method not found: " + className + "." + methodName);
            return result;
        }
        
        // Method info
        Map<String, Object> methodInfo = new HashMap<>();
        methodInfo.put("name", methodName);
        methodInfo.put("className", className);
        methodInfo.put("returnType", targetMethod.getReturnType2() != null ? 
            targetMethod.getReturnType2().toString() : "void");
        methodInfo.put("modifiers", targetMethod.modifiers().toString());
        result.put("method", methodInfo);
        
        List<Map<String, Object>> callers = null;
        List<Map<String, Object>> callees = null;
        
        if (includeCallers) {
            callers = findCallers(className, methodName);
            result.put("callers", callers);
        }
        
        if (includeCallees) {
            callees = findCallees(ast, targetMethod);
            result.put("callees", callees);
        }
        
        // Add summary for easier viewing
        Map<String, Object> summary = new HashMap<>();
        summary.put("totalCallers", callers != null ? Math.min(callers.size(), 20) : 0);
        summary.put("totalCallees", callees != null ? callees.size() : 0);
        if (callers != null && callers.size() > 20) {
            summary.put("note", "Showing first 20 callers. Total found: " + countAllCallers(className, methodName));
        }
        result.put("summary", summary);
        
        return result;
    }
    
    private MethodDeclaration findMethod(CompilationUnit ast, String className, 
                                        String methodName, List<String> parameterTypes) {
        final MethodDeclaration[] result = {null};
        
        ast.accept(new ASTVisitor() {
            @Override
            public boolean visit(MethodDeclaration node) {
                if (node.getName().getIdentifier().equals(methodName)) {
                    // Check parameter types if specified
                    if (parameterTypes != null && !parameterTypes.isEmpty()) {
                        List<SingleVariableDeclaration> params = node.parameters();
                        if (params.size() != parameterTypes.size()) {
                            return true;
                        }
                        // Simple parameter matching (could be improved)
                        boolean match = true;
                        for (int i = 0; i < params.size(); i++) {
                            String paramType = params.get(i).getType().toString();
                            if (!paramType.contains(parameterTypes.get(i))) {
                                match = false;
                                break;
                            }
                        }
                        if (match) {
                            result[0] = node;
                        }
                    } else {
                        result[0] = node;
                    }
                }
                return true;
            }
        });
        
        return result[0];
    }
    
    private List<Map<String, Object>> findCallers(String className, String methodName) {
        List<Map<String, Object>> callers = new ArrayList<>();
        final int MAX_CALLERS = 20; // Limit to prevent UI issues
        
        // Search all files for calls to this method
        for (Map.Entry<String, String> entry : sourceFiles.entrySet()) {
            if (callers.size() >= MAX_CALLERS) {
                // Add a summary entry if we hit the limit
                Map<String, Object> summary = new HashMap<>();
                summary.put("note", "Results limited to " + MAX_CALLERS + " entries");
                summary.put("totalFound", countAllCallers(className, methodName));
                callers.add(summary);
                break;
            }
            
            String searchClassName = entry.getKey();
            String filePath = entry.getValue();
            CompilationUnit ast = astCache.get(filePath);
            
            if (ast != null) {
                ast.accept(new ASTVisitor() {
                    @Override
                    public boolean visit(MethodInvocation node) {
                        if (node.getName().getIdentifier().equals(methodName) && callers.size() < MAX_CALLERS) {
                            // Find the containing method
                            ASTNode parent = node.getParent();
                            while (parent != null && !(parent instanceof MethodDeclaration)) {
                                parent = parent.getParent();
                            }
                            
                            if (parent instanceof MethodDeclaration) {
                                MethodDeclaration containingMethod = (MethodDeclaration) parent;
                                Map<String, Object> caller = new HashMap<>();
                                caller.put("className", searchClassName);
                                caller.put("methodName", containingMethod.getName().getIdentifier());
                                caller.put("line", ast.getLineNumber(node.getStartPosition()));
                                callers.add(caller);
                            }
                        }
                        return true;
                    }
                });
            }
        }
        
        return callers;
    }
    
    private int countAllCallers(String className, String methodName) {
        int count = 0;
        for (Map.Entry<String, String> entry : sourceFiles.entrySet()) {
            String filePath = entry.getValue();
            CompilationUnit ast = astCache.get(filePath);
            
            if (ast != null) {
                final int[] fileCount = {0};
                ast.accept(new ASTVisitor() {
                    @Override
                    public boolean visit(MethodInvocation node) {
                        if (node.getName().getIdentifier().equals(methodName)) {
                            fileCount[0]++;
                        }
                        return true;
                    }
                });
                count += fileCount[0];
            }
        }
        return count;
    }
    
    private List<Map<String, Object>> findCallees(CompilationUnit ast, MethodDeclaration method) {
        List<Map<String, Object>> callees = new ArrayList<>();
        
        method.accept(new ASTVisitor() {
            @Override
            public boolean visit(MethodInvocation node) {
                Map<String, Object> callee = new HashMap<>();
                callee.put("methodName", node.getName().getIdentifier());
                callee.put("line", ast.getLineNumber(node.getStartPosition()));
                
                // Try to get the expression (receiver) if available
                if (node.getExpression() != null) {
                    callee.put("receiver", node.getExpression().toString());
                }
                
                callees.add(callee);
                return true;
            }
        });
        
        return callees;
    }
    
    public Map<String, Object> getClassInfo(String className) {
        Map<String, Object> result = new HashMap<>();
        
        String filePath = sourceFiles.get(className);
        if (filePath == null) {
            result.put("error", "Class not found: " + className);
            return result;
        }
        
        CompilationUnit ast = astCache.get(filePath);
        if (ast == null) {
            result.put("error", "AST not available for class: " + className);
            return result;
        }
        
        ast.accept(new ASTVisitor() {
            @Override
            public boolean visit(TypeDeclaration node) {
                String nodeName = node.getName().getIdentifier();
                String packageName = ast.getPackage() != null ? 
                    ast.getPackage().getName().getFullyQualifiedName() : "";
                String fqn = packageName.isEmpty() ? nodeName : packageName + "." + nodeName;
                
                if (fqn.equals(className)) {
                    result.put("name", className);
                    result.put("isInterface", node.isInterface());
                    result.put("modifiers", node.modifiers().toString());
                    
                    // Get methods
                    List<Map<String, Object>> methods = new ArrayList<>();
                    for (MethodDeclaration method : node.getMethods()) {
                        Map<String, Object> methodInfo = new HashMap<>();
                        methodInfo.put("name", method.getName().getIdentifier());
                        methodInfo.put("returnType", method.getReturnType2() != null ? 
                            method.getReturnType2().toString() : "void");
                        methodInfo.put("parameters", method.parameters().stream()
                            .map(p -> ((SingleVariableDeclaration) p).getType().toString())
                            .collect(Collectors.toList()));
                        methods.add(methodInfo);
                    }
                    result.put("methods", methods);
                    
                    // Get fields
                    List<Map<String, Object>> fields = new ArrayList<>();
                    for (FieldDeclaration field : node.getFields()) {
                        for (Object fragment : field.fragments()) {
                            VariableDeclarationFragment vdf = (VariableDeclarationFragment) fragment;
                            Map<String, Object> fieldInfo = new HashMap<>();
                            fieldInfo.put("name", vdf.getName().getIdentifier());
                            fieldInfo.put("type", field.getType().toString());
                            fields.add(fieldInfo);
                        }
                    }
                    result.put("fields", fields);
                }
                return true;
            }
        });
        
        return result;
    }
    
    public List<String> getAllClasses() {
        return new ArrayList<>(sourceFiles.keySet());
    }
}