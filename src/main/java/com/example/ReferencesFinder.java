package com.example;

import org.eclipse.core.runtime.CoreException;
import org.eclipse.core.runtime.NullProgressMonitor;
import org.eclipse.jdt.core.*;
import org.eclipse.jdt.core.search.*;

import java.util.*;

public class ReferencesFinder {
    private final JavaProjectAnalyzer projectAnalyzer;
    private final SearchEngine searchEngine;
    
    public ReferencesFinder(JavaProjectAnalyzer projectAnalyzer) {
        this.projectAnalyzer = projectAnalyzer;
        this.searchEngine = new SearchEngine();
    }
    
    public List<Map<String, Object>> findMethodReferences(String fullyQualifiedClassName, 
                                                         String methodName, String[] parameterTypes) 
                                                         throws CoreException {
        IMethod method = findMethod(fullyQualifiedClassName, methodName, parameterTypes);
        if (method == null) {
            return Collections.emptyList();
        }
        
        return findReferences(method, "method");
    }
    
    public List<Map<String, Object>> findFieldReferences(String fullyQualifiedClassName, 
                                                        String fieldName) throws CoreException {
        IField field = findField(fullyQualifiedClassName, fieldName);
        if (field == null) {
            return Collections.emptyList();
        }
        
        return findReferences(field, "field");
    }
    
    public List<Map<String, Object>> findTypeReferences(String fullyQualifiedTypeName) 
                                                       throws CoreException {
        IType type = projectAnalyzer.findType(fullyQualifiedTypeName);
        if (type == null) {
            return Collections.emptyList();
        }
        
        return findReferences(type, "type");
    }
    
    public List<Map<String, Object>> findConstructorReferences(String fullyQualifiedClassName,
                                                              String[] parameterTypes) 
                                                              throws CoreException {
        IType type = projectAnalyzer.findType(fullyQualifiedClassName);
        if (type == null) {
            return Collections.emptyList();
        }
        
        IMethod constructor = null;
        IMethod[] methods = type.getMethods();
        for (IMethod method : methods) {
            if (method.isConstructor()) {
                try {
                    if (parameterTypes == null || matchesParameterTypes(method, parameterTypes)) {
                        constructor = method;
                        break;
                    }
                } catch (JavaModelException e) {
                    // Skip this method if parameter types can't be compared
                    continue;
                }
            }
        }
        
        if (constructor == null) {
            return Collections.emptyList();
        }
        
        return findReferences(constructor, "constructor");
    }
    
    public Map<String, Object> findAllReferences(String fullyQualifiedClassName, 
                                                String memberName) throws CoreException {
        Map<String, Object> result = new HashMap<>();
        
        IType type = projectAnalyzer.findType(fullyQualifiedClassName);
        if (type == null) {
            result.put("error", "Type not found: " + fullyQualifiedClassName);
            return result;
        }
        
        List<Map<String, Object>> allReferences = new ArrayList<>();
        
        // Find method references
        IMethod[] methods = type.getMethods();
        for (IMethod method : methods) {
            if (memberName == null || method.getElementName().equals(memberName)) {
                List<Map<String, Object>> methodRefs = findReferences(method, "method");
                allReferences.addAll(methodRefs);
            }
        }
        
        // Find field references
        IField[] fields = type.getFields();
        for (IField field : fields) {
            if (memberName == null || field.getElementName().equals(memberName)) {
                List<Map<String, Object>> fieldRefs = findReferences(field, "field");
                allReferences.addAll(fieldRefs);
            }
        }
        
        // If no specific member name, also include type references
        if (memberName == null) {
            List<Map<String, Object>> typeRefs = findReferences(type, "type");
            allReferences.addAll(typeRefs);
        }
        
        result.put("references", allReferences);
        result.put("totalCount", allReferences.size());
        
        return result;
    }
    
    private List<Map<String, Object>> findReferences(IJavaElement element, String elementType) 
                                                    throws CoreException {
        List<Map<String, Object>> references = new ArrayList<>();
        
        SearchPattern pattern = SearchPattern.createPattern(
            element,
            IJavaSearchConstants.REFERENCES,
            SearchPattern.R_EXACT_MATCH
        );
        
        IJavaSearchScope scope = SearchEngine.createJavaSearchScope(
            new IJavaElement[]{projectAnalyzer.getJavaProject()}
        );
        
        SearchRequestor requestor = new SearchRequestor() {
            @Override
            public void acceptSearchMatch(SearchMatch match) throws CoreException {
                Map<String, Object> referenceInfo = createReferenceInfo(match, elementType);
                references.add(referenceInfo);
            }
        };
        
        searchEngine.search(pattern, new SearchParticipant[]{SearchEngine.getDefaultSearchParticipant()},
                          scope, requestor, new NullProgressMonitor());
        
        return references;
    }
    
    private Map<String, Object> createReferenceInfo(SearchMatch match, String elementType) {
        Map<String, Object> info = new HashMap<>();
        
        try {
            info.put("elementType", elementType);
            info.put("accuracy", getAccuracyDescription(match.getAccuracy()));
            info.put("referenceType", getReferenceType(match, elementType));
            
            // Location information
            info.put("offset", match.getOffset());
            info.put("length", match.getLength());
            info.put("lineNumber", getLineNumber(match));
            
            // File information
            if (match.getResource() != null) {
                info.put("filePath", match.getResource().getLocation().toString());
                info.put("fileName", match.getResource().getName());
                info.put("projectName", match.getResource().getProject().getName());
            }
            
            // Context information
            if (match.getElement() instanceof IMember) {
                IMember member = (IMember) match.getElement();
                info.put("containingType", member.getDeclaringType().getFullyQualifiedName());
                info.put("containingMember", member.getElementName());
                info.put("containingMemberType", getMemberType(member));
            }
            
            // Source context
            String sourceContext = getSourceContext(match);
            if (sourceContext != null) {
                info.put("sourceContext", sourceContext);
            }
            
        } catch (Exception e) {
            info.put("error", "Failed to create reference info: " + e.getMessage());
        }
        
        return info;
    }
    
    private String getAccuracyDescription(int accuracy) {
        switch (accuracy) {
            case SearchMatch.A_ACCURATE:
                return "accurate";
            case SearchMatch.A_INACCURATE:
                return "inaccurate";
            default:
                return "unknown";
        }
    }
    
    private String getReferenceType(SearchMatch match, String elementType) {
        if ("field".equals(elementType)) {
            if ((match.getRule() & SearchPattern.R_PATTERN_MATCH) != 0) {
                return "read_write";
            }
            return "reference";
        } else if ("method".equals(elementType) || "constructor".equals(elementType)) {
            return "call";
        } else if ("type".equals(elementType)) {
            return "usage";
        }
        return "reference";
    }
    
    private int getLineNumber(SearchMatch match) {
        try {
            if (match.getElement() instanceof IMember) {
                IMember member = (IMember) match.getElement();
                ICompilationUnit cu = member.getCompilationUnit();
                if (cu != null) {
                    String source = cu.getSource();
                    if (source != null) {
                        return getLineNumberFromOffset(source, match.getOffset());
                    }
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
    
    private String getSourceContext(SearchMatch match) {
        try {
            if (match.getElement() instanceof IMember) {
                IMember member = (IMember) match.getElement();
                ICompilationUnit cu = member.getCompilationUnit();
                if (cu != null) {
                    String source = cu.getSource();
                    if (source != null) {
                        return extractSourceContext(source, match.getOffset(), match.getLength());
                    }
                }
            }
        } catch (JavaModelException e) {
            // Return null if we can't get context
        }
        return null;
    }
    
    private String extractSourceContext(String source, int offset, int length) {
        int contextSize = 50; // Characters before and after
        
        int start = Math.max(0, offset - contextSize);
        int end = Math.min(source.length(), offset + length + contextSize);
        
        String context = source.substring(start, end);
        
        // Clean up context (remove excessive whitespace)
        context = context.replaceAll("\\s+", " ").trim();
        
        // Highlight the actual match
        int relativeOffset = offset - start;
        if (relativeOffset >= 0 && relativeOffset + length <= context.length()) {
            String before = context.substring(0, relativeOffset);
            String match = context.substring(relativeOffset, relativeOffset + length);
            String after = context.substring(relativeOffset + length);
            return before + "**" + match + "**" + after;
        }
        
        return context;
    }
    
    private String getMemberType(IMember member) {
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
    
    private boolean matchesParameterTypes(IMethod method, String[] parameterTypes) throws JavaModelException {
        String[] methodParamTypes = method.getParameterTypes();
        if (methodParamTypes.length != parameterTypes.length) {
            return false;
        }
        
        for (int i = 0; i < methodParamTypes.length; i++) {
            String resolved = Signature.toString(methodParamTypes[i]);
            if (!resolved.equals(parameterTypes[i])) {
                return false;
            }
        }
        
        return true;
    }
    
    public Map<String, Object> findReferencesInScope(String fullyQualifiedClassName, String memberName,
                                                   String packageScope) throws CoreException {
        Map<String, Object> result = new HashMap<>();
        
        IType type = projectAnalyzer.findType(fullyQualifiedClassName);
        if (type == null) {
            result.put("error", "Type not found: " + fullyQualifiedClassName);
            return result;
        }
        
        // Create scope based on package
        IJavaSearchScope scope;
        if (packageScope != null && !packageScope.isEmpty()) {
            IPackageFragment pkg = projectAnalyzer.getJavaProject().findPackageFragment(
                projectAnalyzer.getJavaProject().getPath().append(packageScope.replace('.', '/')));
            if (pkg != null) {
                scope = SearchEngine.createJavaSearchScope(new IJavaElement[]{pkg});
            } else {
                scope = SearchEngine.createJavaSearchScope(
                    new IJavaElement[]{projectAnalyzer.getJavaProject()}
                );
            }
        } else {
            scope = SearchEngine.createJavaSearchScope(
                new IJavaElement[]{projectAnalyzer.getJavaProject()}
            );
        }
        
        List<Map<String, Object>> allReferences = new ArrayList<>();
        
        // Find references for the specific member or all members
        if (memberName != null) {
            // Try to find specific method or field
            IMethod[] methods = type.getMethods();
            for (IMethod method : methods) {
                if (method.getElementName().equals(memberName)) {
                    allReferences.addAll(findReferencesInScope(method, "method", scope));
                }
            }
            
            IField[] fields = type.getFields();
            for (IField field : fields) {
                if (field.getElementName().equals(memberName)) {
                    allReferences.addAll(findReferencesInScope(field, "field", scope));
                }
            }
        } else {
            // Find all references to the type
            allReferences.addAll(findReferencesInScope(type, "type", scope));
        }
        
        result.put("references", allReferences);
        result.put("totalCount", allReferences.size());
        result.put("scope", packageScope != null ? packageScope : "project");
        
        return result;
    }
    
    private List<Map<String, Object>> findReferencesInScope(IJavaElement element, String elementType,
                                                           IJavaSearchScope scope) throws CoreException {
        List<Map<String, Object>> references = new ArrayList<>();
        
        SearchPattern pattern = SearchPattern.createPattern(
            element,
            IJavaSearchConstants.REFERENCES,
            SearchPattern.R_EXACT_MATCH
        );
        
        SearchRequestor requestor = new SearchRequestor() {
            @Override
            public void acceptSearchMatch(SearchMatch match) throws CoreException {
                Map<String, Object> referenceInfo = createReferenceInfo(match, elementType);
                references.add(referenceInfo);
            }
        };
        
        searchEngine.search(pattern, new SearchParticipant[]{SearchEngine.getDefaultSearchParticipant()},
                          scope, requestor, new NullProgressMonitor());
        
        return references;
    }
}