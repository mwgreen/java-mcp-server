package com.example;

import org.eclipse.core.runtime.CoreException;
import org.eclipse.core.runtime.IProgressMonitor;
import org.eclipse.core.runtime.NullProgressMonitor;
import org.eclipse.jdt.core.*;
import org.eclipse.ltk.core.refactoring.*;

import java.util.*;

public class RefactoringEngine {
    private final JavaProjectAnalyzer projectAnalyzer;
    
    public RefactoringEngine(JavaProjectAnalyzer projectAnalyzer) {
        this.projectAnalyzer = projectAnalyzer;
    }
    
    public Map<String, Object> renameClass(String fullyQualifiedClassName, String newName, 
                                         boolean preview) throws CoreException {
        IType type = projectAnalyzer.findType(fullyQualifiedClassName);
        if (type == null) {
            Map<String, Object> result = new HashMap<>();
            result.put("error", "Class not found: " + fullyQualifiedClassName);
            return result;
        }
        
        return performRename(type, newName, preview, "class");
    }
    
    public Map<String, Object> renameMethod(String fullyQualifiedClassName, String methodName,
                                          String[] parameterTypes, String newName, boolean preview) 
                                          throws CoreException {
        IMethod method = findMethod(fullyQualifiedClassName, methodName, parameterTypes);
        if (method == null) {
            Map<String, Object> result = new HashMap<>();
            result.put("error", "Method not found: " + fullyQualifiedClassName + "." + methodName);
            return result;
        }
        
        return performRename(method, newName, preview, "method");
    }
    
    public Map<String, Object> renameField(String fullyQualifiedClassName, String fieldName,
                                         String newName, boolean preview) throws CoreException {
        IField field = findField(fullyQualifiedClassName, fieldName);
        if (field == null) {
            Map<String, Object> result = new HashMap<>();
            result.put("error", "Field not found: " + fullyQualifiedClassName + "." + fieldName);
            return result;
        }
        
        return performRename(field, newName, preview, "field");
    }
    
    public Map<String, Object> renameLocalVariable(String fullyQualifiedClassName, String methodName,
                                                 String[] parameterTypes, String variableName,
                                                 String newName, boolean preview) throws CoreException {
        IMethod method = findMethod(fullyQualifiedClassName, methodName, parameterTypes);
        if (method == null) {
            Map<String, Object> result = new HashMap<>();
            result.put("error", "Method not found: " + fullyQualifiedClassName + "." + methodName);
            return result;
        }
        
        // Find the local variable within the method
        ILocalVariable localVar = findLocalVariable(method, variableName);
        if (localVar == null) {
            Map<String, Object> result = new HashMap<>();
            result.put("error", "Local variable not found: " + variableName + " in " + 
                      fullyQualifiedClassName + "." + methodName);
            return result;
        }
        
        return performRename(localVar, newName, preview, "local_variable");
    }
    
    private Map<String, Object> performRename(IJavaElement element, String newName, boolean preview,
                                            String elementType) throws CoreException {
        Map<String, Object> result = new HashMap<>();
        
        try {
            // Validate the new name
            RefactoringStatus validationStatus = validateNewName(element, newName);
            if (validationStatus.hasFatalError()) {
                result.put("error", "Invalid new name: " + validationStatus.getMessageMatchingSeverity(RefactoringStatus.FATAL));
                return result;
            }
            
            // Create rename refactoring
            Refactoring refactoring = createRenameRefactoring(element, newName);
            if (refactoring == null) {
                result.put("error", "Refactoring functionality not fully implemented in this version");
                result.put("note", "This is a simplified implementation. Full refactoring support requires additional Eclipse JDT setup");
                return result;
            }
            
        } catch (Exception e) {
            result.put("error", "Refactoring failed: " + e.getMessage());
        }
        
        return result;
    }
    
    private Refactoring createRenameRefactoring(IJavaElement element, String newName) 
                                                    throws CoreException {
        // Simplified refactoring implementation
        // In a full implementation, this would use Eclipse's refactoring APIs
        // For now, return null to indicate refactoring is not supported
        return null;
    }
    
    private RefactoringStatus validateNewName(IJavaElement element, String newName) {
        RefactoringStatus status = new RefactoringStatus();
        
        if (newName == null || newName.trim().isEmpty()) {
            status.addFatalError("New name cannot be empty");
            return status;
        }
        
        String trimmedName = newName.trim();
        
        // Validate based on element type
        if (element instanceof IType) {
            if (!JavaConventions.validateJavaTypeName(trimmedName).isOK()) {
                status.addFatalError("Invalid type name: " + trimmedName);
            }
        } else if (element instanceof IMethod) {
            if (!JavaConventions.validateMethodName(trimmedName).isOK()) {
                status.addFatalError("Invalid method name: " + trimmedName);
            }
        } else if (element instanceof IField) {
            if (!JavaConventions.validateFieldName(trimmedName).isOK()) {
                status.addFatalError("Invalid field name: " + trimmedName);
            }
        } else if (element instanceof ILocalVariable) {
            if (!JavaConventions.validateIdentifier(trimmedName).isOK()) {
                status.addFatalError("Invalid variable name: " + trimmedName);
            }
        }
        
        return status;
    }
    
    private List<Map<String, Object>> describeChanges(Change change) {
        List<Map<String, Object>> changes = new ArrayList<>();
        Map<String, Object> changeInfo = new HashMap<>();
        changeInfo.put("name", change.getName());
        changeInfo.put("enabled", change.isEnabled());
        changeInfo.put("type", "change");
        changes.add(changeInfo);
        return changes;
    }
    
    private int countChanges(Change change) {
        return 1; // Simplified counting
    }
    
    private IMethod findMethod(String fullyQualifiedClassName, String methodName, String[] parameterTypes) 
                              throws JavaModelException {
        IType type = projectAnalyzer.findType(fullyQualifiedClassName);
        if (type == null) {
            return null;
        }
        
        if (parameterTypes == null) {
            IMethod[] methods = type.getMethods();
            for (IMethod method : methods) {
                if (method.getElementName().equals(methodName)) {
                    return method;
                }
            }
        } else {
            return type.getMethod(methodName, parameterTypes);
        }
        
        return null;
    }
    
    private IField findField(String fullyQualifiedClassName, String fieldName) throws JavaModelException {
        IType type = projectAnalyzer.findType(fullyQualifiedClassName);
        if (type == null) {
            return null;
        }
        
        return type.getField(fieldName);
    }
    
    private ILocalVariable findLocalVariable(IMethod method, String variableName) {
        try {
            ILocalVariable[] localVariables = method.getParameters();
            for (ILocalVariable localVar : localVariables) {
                if (localVar.getElementName().equals(variableName)) {
                    return localVar;
                }
            }
            
            // Note: Finding local variables within method body requires AST parsing
            // This is a simplified implementation that only finds parameters
            // A full implementation would need to parse the method body
            
        } catch (JavaModelException e) {
            // Return null if we can't find the variable
        }
        return null;
    }
    
    public Map<String, Object> getRefactoringPreview(String elementType, String fullyQualifiedName,
                                                    String memberName, String[] parameterTypes, 
                                                    String newName) throws CoreException {
        Map<String, Object> result = new HashMap<>();
        
        switch (elementType.toLowerCase()) {
            case "class":
            case "type":
                return renameClass(fullyQualifiedName, newName, true);
            case "method":
                return renameMethod(fullyQualifiedName, memberName, parameterTypes, newName, true);
            case "field":
                return renameField(fullyQualifiedName, memberName, newName, true);
            default:
                result.put("error", "Unsupported element type for refactoring: " + elementType);
                return result;
        }
    }
    
    public Map<String, Object> executeRefactoring(String elementType, String fullyQualifiedName,
                                                 String memberName, String[] parameterTypes, 
                                                 String newName) throws CoreException {
        switch (elementType.toLowerCase()) {
            case "class":
            case "type":
                return renameClass(fullyQualifiedName, newName, false);
            case "method":
                return renameMethod(fullyQualifiedName, memberName, parameterTypes, newName, false);
            case "field":
                return renameField(fullyQualifiedName, memberName, newName, false);
            default:
                Map<String, Object> result = new HashMap<>();
                result.put("error", "Unsupported element type for refactoring: " + elementType);
                return result;
        }
    }
    
    public List<String> getSupportedRefactorings() {
        return Arrays.asList(
            "rename_class",
            "rename_method", 
            "rename_field",
            "rename_local_variable"
        );
    }
}