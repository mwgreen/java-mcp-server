package com.example;

import org.eclipse.core.runtime.CoreException;
import org.eclipse.core.runtime.NullProgressMonitor;
import org.eclipse.jdt.core.*;

import java.util.*;

public class TypeHierarchyAnalyzer {
    private final JavaProjectAnalyzer projectAnalyzer;
    
    public TypeHierarchyAnalyzer(JavaProjectAnalyzer projectAnalyzer) {
        this.projectAnalyzer = projectAnalyzer;
    }
    
    public List<Map<String, Object>> getSupertypes(String fullyQualifiedTypeName) throws CoreException {
        IType type = projectAnalyzer.findType(fullyQualifiedTypeName);
        if (type == null) {
            return Collections.emptyList();
        }
        
        List<Map<String, Object>> supertypes = new ArrayList<>();
        ITypeHierarchy hierarchy = type.newSupertypeHierarchy(new NullProgressMonitor());
        
        // Get direct supertypes first
        IType[] directSupertypes = hierarchy.getSupertypes(type);
        for (IType supertype : directSupertypes) {
            supertypes.add(createTypeInfo(supertype, "direct"));
        }
        
        // Get all supertypes
        IType[] allSupertypes = hierarchy.getAllSupertypes(type);
        for (IType supertype : allSupertypes) {
            if (!contains(directSupertypes, supertype)) {
                supertypes.add(createTypeInfo(supertype, "indirect"));
            }
        }
        
        return supertypes;
    }
    
    public List<Map<String, Object>> getSubtypes(String fullyQualifiedTypeName) throws CoreException {
        IType type = projectAnalyzer.findType(fullyQualifiedTypeName);
        if (type == null) {
            return Collections.emptyList();
        }
        
        List<Map<String, Object>> subtypes = new ArrayList<>();
        ITypeHierarchy hierarchy = type.newTypeHierarchy(new NullProgressMonitor());
        
        // Get direct subtypes
        IType[] directSubtypes = hierarchy.getSubtypes(type);
        for (IType subtype : directSubtypes) {
            subtypes.add(createTypeInfo(subtype, "direct"));
        }
        
        // Get all subtypes
        IType[] allSubtypes = hierarchy.getAllSubtypes(type);
        for (IType subtype : allSubtypes) {
            if (!contains(directSubtypes, subtype)) {
                subtypes.add(createTypeInfo(subtype, "indirect"));
            }
        }
        
        return subtypes;
    }
    
    public Map<String, Object> getCompleteHierarchy(String fullyQualifiedTypeName) throws CoreException {
        IType type = projectAnalyzer.findType(fullyQualifiedTypeName);
        if (type == null) {
            Map<String, Object> result = new HashMap<>();
            result.put("error", "Type not found: " + fullyQualifiedTypeName);
            return result;
        }
        
        Map<String, Object> hierarchy = new HashMap<>();
        hierarchy.put("type", createTypeInfo(type, "target"));
        hierarchy.put("supertypes", getSupertypes(fullyQualifiedTypeName));
        hierarchy.put("subtypes", getSubtypes(fullyQualifiedTypeName));
        
        return hierarchy;
    }
    
    public List<Map<String, Object>> getInterfaceHierarchy(String fullyQualifiedInterfaceName) throws CoreException {
        IType type = projectAnalyzer.findType(fullyQualifiedInterfaceName);
        if (type == null || !type.isInterface()) {
            return Collections.emptyList();
        }
        
        List<Map<String, Object>> implementors = new ArrayList<>();
        ITypeHierarchy hierarchy = type.newTypeHierarchy(new NullProgressMonitor());
        
        // Get all types that implement this interface
        IType[] allSubtypes = hierarchy.getAllSubtypes(type);
        for (IType subtype : allSubtypes) {
            if (subtype.isClass()) {
                implementors.add(createTypeInfo(subtype, "implementor"));
            } else if (subtype.isInterface()) {
                implementors.add(createTypeInfo(subtype, "extending_interface"));
            }
        }
        
        return implementors;
    }
    
    public List<Map<String, Object>> getImplementedInterfaces(String fullyQualifiedClassName) throws CoreException {
        IType type = projectAnalyzer.findType(fullyQualifiedClassName);
        if (type == null || !type.isClass()) {
            return Collections.emptyList();
        }
        
        List<Map<String, Object>> interfaces = new ArrayList<>();
        
        // Get superinterfaces
        String[] superinterfaceSignatures = type.getSuperInterfaceNames();
        for (String signature : superinterfaceSignatures) {
            String resolvedName = resolveTypeName(type, signature);
            IType interfaceType = projectAnalyzer.findType(resolvedName);
            if (interfaceType != null) {
                interfaces.add(createTypeInfo(interfaceType, "direct"));
            }
        }
        
        // Get all implemented interfaces through hierarchy
        ITypeHierarchy hierarchy = type.newSupertypeHierarchy(new NullProgressMonitor());
        IType[] allSupertypes = hierarchy.getAllSupertypes(type);
        
        for (IType supertype : allSupertypes) {
            if (supertype.isInterface()) {
                Map<String, Object> interfaceInfo = createTypeInfo(supertype, "inherited");
                if (!containsType(interfaces, supertype.getFullyQualifiedName())) {
                    interfaces.add(interfaceInfo);
                }
            }
        }
        
        return interfaces;
    }
    
    private Map<String, Object> createTypeInfo(IType type, String relationship) {
        Map<String, Object> info = new HashMap<>();
        
        try {
            info.put("fullyQualifiedName", type.getFullyQualifiedName());
            info.put("simpleName", type.getElementName());
            info.put("packageName", type.getPackageFragment().getElementName());
            info.put("relationship", relationship);
            info.put("typeKind", getTypeKind(type));
            
            ICompilationUnit cu = type.getCompilationUnit();
            if (cu != null) {
                info.put("filePath", cu.getResource().getLocation().toString());
                info.put("fileName", cu.getElementName());
            } else {
                // Binary type
                info.put("filePath", type.getPath().toString());
                info.put("fileName", type.getTypeQualifiedName() + ".class");
                info.put("binary", true);
            }
            
            // Get modifiers
            int flags = type.getFlags();
            List<String> modifiers = new ArrayList<>();
            if (Flags.isPublic(flags)) modifiers.add("public");
            if (Flags.isProtected(flags)) modifiers.add("protected");
            if (Flags.isPrivate(flags)) modifiers.add("private");
            if (Flags.isStatic(flags)) modifiers.add("static");
            if (Flags.isFinal(flags)) modifiers.add("final");
            if (Flags.isAbstract(flags)) modifiers.add("abstract");
            info.put("modifiers", modifiers);
            
        } catch (JavaModelException e) {
            info.put("error", "Failed to get type info: " + e.getMessage());
        }
        
        return info;
    }
    
    private String getTypeKind(IType type) throws JavaModelException {
        if (type.isInterface()) {
            return "interface";
        } else if (type.isEnum()) {
            return "enum";
        } else if (type.isAnnotation()) {
            return "annotation";
        } else if (type.isClass()) {
            return "class";
        } else {
            return "unknown";
        }
    }
    
    private String resolveTypeName(IType contextType, String typeName) {
        try {
            // Try to resolve the type name in the context of the given type
            String[][] resolvedNames = contextType.resolveType(typeName);
            if (resolvedNames != null && resolvedNames.length > 0) {
                String packageName = resolvedNames[0][0];
                String simpleName = resolvedNames[0][1];
                if (packageName != null && !packageName.isEmpty()) {
                    return packageName + "." + simpleName;
                } else {
                    return simpleName;
                }
            }
        } catch (JavaModelException e) {
            // Fall back to original name
        }
        return typeName;
    }
    
    private boolean contains(IType[] array, IType type) {
        for (IType t : array) {
            if (t.equals(type)) {
                return true;
            }
        }
        return false;
    }
    
    private boolean containsType(List<Map<String, Object>> list, String fullyQualifiedName) {
        for (Map<String, Object> typeInfo : list) {
            if (fullyQualifiedName.equals(typeInfo.get("fullyQualifiedName"))) {
                return true;
            }
        }
        return false;
    }
    
    public Map<String, Object> analyzeSuperclassChain(String fullyQualifiedClassName) throws CoreException {
        IType type = projectAnalyzer.findType(fullyQualifiedClassName);
        if (type == null || !type.isClass()) {
            Map<String, Object> result = new HashMap<>();
            result.put("error", "Class not found or not a class: " + fullyQualifiedClassName);
            return result;
        }
        
        Map<String, Object> result = new HashMap<>();
        List<Map<String, Object>> chain = new ArrayList<>();
        
        IType currentType = type;
        while (currentType != null) {
            chain.add(createTypeInfo(currentType, "superclass"));
            
            try {
                String superclassSignature = currentType.getSuperclassName();
                if (superclassSignature == null || "Object".equals(superclassSignature) || 
                    "java.lang.Object".equals(superclassSignature)) {
                    break;
                }
                
                String resolvedName = resolveTypeName(currentType, superclassSignature);
                currentType = projectAnalyzer.findType(resolvedName);
                
                if (currentType == null && !"java.lang.Object".equals(resolvedName)) {
                    // Add Object as final superclass
                    Map<String, Object> objectInfo = new HashMap<>();
                    objectInfo.put("fullyQualifiedName", "java.lang.Object");
                    objectInfo.put("simpleName", "Object");
                    objectInfo.put("packageName", "java.lang");
                    objectInfo.put("relationship", "superclass");
                    objectInfo.put("typeKind", "class");
                    objectInfo.put("binary", true);
                    chain.add(objectInfo);
                    break;
                }
            } catch (JavaModelException e) {
                break;
            }
        }
        
        result.put("superclassChain", chain);
        result.put("depth", chain.size() - 1); // Exclude the class itself
        
        return result;
    }
}