package com.example;

import org.eclipse.core.runtime.CoreException;
import org.eclipse.core.runtime.IProgressMonitor;
import org.eclipse.core.runtime.NullProgressMonitor;
import org.eclipse.jdt.core.*;
import org.eclipse.jdt.core.dom.*;
import org.eclipse.jdt.core.search.*;

import java.util.*;

public class CallHierarchyAnalyzer {
    private final JavaProjectAnalyzer projectAnalyzer;
    private final SearchEngine searchEngine;
    
    public CallHierarchyAnalyzer(JavaProjectAnalyzer projectAnalyzer) {
        this.projectAnalyzer = projectAnalyzer;
        this.searchEngine = new SearchEngine();
    }
    
    public List<Map<String, Object>> getCallers(String fullyQualifiedClassName, String methodName, 
                                               String[] parameterTypes) throws CoreException {
        IMethod method = findMethod(fullyQualifiedClassName, methodName, parameterTypes);
        if (method == null) {
            return Collections.emptyList();
        }
        
        List<Map<String, Object>> callers = new ArrayList<>();
        
        SearchPattern pattern = SearchPattern.createPattern(
            method,
            IJavaSearchConstants.REFERENCES,
            SearchPattern.R_EXACT_MATCH
        );
        
        IJavaSearchScope scope = SearchEngine.createJavaSearchScope(
            new IJavaElement[]{projectAnalyzer.getJavaProject()}
        );
        
        SearchRequestor requestor = new SearchRequestor() {
            @Override
            public void acceptSearchMatch(SearchMatch match) throws CoreException {
                if (match.getElement() instanceof IMember) {
                    IMember caller = (IMember) match.getElement();
                    Map<String, Object> callerInfo = createCallInfo(caller, match);
                    callers.add(callerInfo);
                }
            }
        };
        
        searchEngine.search(pattern, new SearchParticipant[]{SearchEngine.getDefaultSearchParticipant()},
                          scope, requestor, new NullProgressMonitor());
        
        return callers;
    }
    
    public List<Map<String, Object>> getCallees(String fullyQualifiedClassName, String methodName,
                                               String[] parameterTypes) throws CoreException {
        IMethod method = findMethod(fullyQualifiedClassName, methodName, parameterTypes);
        if (method == null) {
            return Collections.emptyList();
        }
        
        List<Map<String, Object>> callees = new ArrayList<>();
        
        // Parse method to find all method invocations
        ICompilationUnit compilationUnit = method.getCompilationUnit();
        if (compilationUnit != null) {
            ASTParser parser = ASTParser.newParser(AST.getJLSLatest());
            parser.setSource(compilationUnit);
            parser.setResolveBindings(true);
            CompilationUnit astRoot = (CompilationUnit) parser.createAST(new NullProgressMonitor());
            
            MethodCallVisitor visitor = new MethodCallVisitor(method);
            astRoot.accept(visitor);
            
            callees.addAll(visitor.getCallees());
        }
        
        return callees;
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
    
    private Map<String, Object> createCallInfo(IMember caller, SearchMatch match) {
        Map<String, Object> info = new HashMap<>();
        
        try {
            info.put("signature", getElementSignature(caller));
            info.put("declaringClass", caller.getDeclaringType().getFullyQualifiedName());
            info.put("elementType", getElementType(caller));
            
            ICompilationUnit cu = caller.getCompilationUnit();
            if (cu != null) {
                info.put("filePath", cu.getResource().getLocation().toString());
                info.put("fileName", cu.getElementName());
            }
            
            info.put("lineNumber", getLineNumber(match));
            info.put("offset", match.getOffset());
            info.put("length", match.getLength());
            
        } catch (JavaModelException e) {
            info.put("error", "Failed to get caller info: " + e.getMessage());
        }
        
        return info;
    }
    
    private String getElementSignature(IMember member) throws JavaModelException {
        if (member instanceof IMethod) {
            IMethod method = (IMethod) member;
            StringBuilder signature = new StringBuilder();
            signature.append(method.getElementName());
            signature.append("(");
            
            String[] paramTypes = method.getParameterTypes();
            for (int i = 0; i < paramTypes.length; i++) {
                if (i > 0) signature.append(", ");
                signature.append(Signature.toString(paramTypes[i]));
            }
            signature.append(")");
            
            return signature.toString();
        } else if (member instanceof IField) {
            return member.getElementName();
        } else {
            return member.getElementName();
        }
    }
    
    private String getElementType(IMember member) {
        if (member instanceof IMethod) {
            return "method";
        } else if (member instanceof IField) {
            return "field";
        } else if (member instanceof IType) {
            return "type";
        } else {
            return "unknown";
        }
    }
    
    private int getLineNumber(SearchMatch match) {
        try {
            ICompilationUnit cu = null;
            if (match.getElement() instanceof IMember) {
                IMember member = (IMember) match.getElement();
                cu = member.getCompilationUnit();
            }
            
            if (cu != null) {
                String source = cu.getSource();
                if (source != null) {
                    return getLineNumberFromOffset(source, match.getOffset());
                }
            }
        } catch (JavaModelException e) {
            // Fall back to -1
        }
        return -1;
    }
    
    private int getLineNumberFromOffset(String source, int offset) {
        int lineNumber = 1;
        for (int i = 0; i < offset && i < source.length(); i++) {
            if (source.charAt(i) == '\n') {
                lineNumber++;
            }
        }
        return lineNumber;
    }
    
    private class MethodCallVisitor extends ASTVisitor {
        private final IMethod targetMethod;
        private final List<Map<String, Object>> callees = new ArrayList<>();
        
        public MethodCallVisitor(IMethod targetMethod) {
            this.targetMethod = targetMethod;
        }
        
        @Override
        public boolean visit(MethodInvocation node) {
            if (isInTargetMethod(node)) {
                IMethodBinding binding = node.resolveMethodBinding();
                if (binding != null) {
                    Map<String, Object> calleeInfo = createCalleeInfo(binding, node);
                    callees.add(calleeInfo);
                }
            }
            return super.visit(node);
        }
        
        @Override
        public boolean visit(SuperMethodInvocation node) {
            if (isInTargetMethod(node)) {
                IMethodBinding binding = node.resolveMethodBinding();
                if (binding != null) {
                    Map<String, Object> calleeInfo = createCalleeInfo(binding, node);
                    callees.add(calleeInfo);
                }
            }
            return super.visit(node);
        }
        
        private boolean isInTargetMethod(ASTNode node) {
            ASTNode parent = node.getParent();
            while (parent != null) {
                if (parent instanceof MethodDeclaration) {
                    MethodDeclaration methodDecl = (MethodDeclaration) parent;
                    IMethodBinding binding = methodDecl.resolveBinding();
                    if (binding != null) {
                        IJavaElement javaElement = binding.getJavaElement();
                        return targetMethod.equals(javaElement);
                    }
                    break;
                }
                parent = parent.getParent();
            }
            return false;
        }
        
        private Map<String, Object> createCalleeInfo(IMethodBinding binding, ASTNode node) {
            Map<String, Object> info = new HashMap<>();
            
            info.put("signature", getMethodSignature(binding));
            info.put("declaringClass", binding.getDeclaringClass().getQualifiedName());
            info.put("elementType", "method");
            
            CompilationUnit cu = (CompilationUnit) node.getRoot();
            int lineNumber = cu.getLineNumber(node.getStartPosition());
            info.put("lineNumber", lineNumber);
            info.put("offset", node.getStartPosition());
            info.put("length", node.getLength());
            
            return info;
        }
        
        private String getMethodSignature(IMethodBinding binding) {
            StringBuilder signature = new StringBuilder();
            signature.append(binding.getName());
            signature.append("(");
            
            ITypeBinding[] paramTypes = binding.getParameterTypes();
            for (int i = 0; i < paramTypes.length; i++) {
                if (i > 0) signature.append(", ");
                signature.append(paramTypes[i].getName());
            }
            signature.append(")");
            
            return signature.toString();
        }
        
        public List<Map<String, Object>> getCallees() {
            return callees;
        }
    }
    
    public Map<String, Object> getCallHierarchy(String fullyQualifiedClassName, String methodName,
                                              String[] parameterTypes, boolean includeCallers, 
                                              boolean includeCallees) throws CoreException {
        Map<String, Object> hierarchy = new HashMap<>();
        
        IMethod method = findMethod(fullyQualifiedClassName, methodName, parameterTypes);
        if (method == null) {
            hierarchy.put("error", "Method not found: " + fullyQualifiedClassName + "." + methodName);
            return hierarchy;
        }
        
        hierarchy.put("method", createMethodInfo(method));
        
        if (includeCallers) {
            hierarchy.put("callers", getCallers(fullyQualifiedClassName, methodName, parameterTypes));
        }
        
        if (includeCallees) {
            hierarchy.put("callees", getCallees(fullyQualifiedClassName, methodName, parameterTypes));
        }
        
        return hierarchy;
    }
    
    private Map<String, Object> createMethodInfo(IMethod method) throws JavaModelException {
        Map<String, Object> info = new HashMap<>();
        info.put("signature", getElementSignature(method));
        info.put("declaringClass", method.getDeclaringType().getFullyQualifiedName());
        info.put("returnType", Signature.toString(method.getReturnType()));
        
        ICompilationUnit cu = method.getCompilationUnit();
        if (cu != null) {
            info.put("filePath", cu.getResource().getLocation().toString());
            info.put("fileName", cu.getElementName());
        }
        
        return info;
    }
}