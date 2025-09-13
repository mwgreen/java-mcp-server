package com.example;

import org.eclipse.core.resources.*;
import org.eclipse.core.runtime.*;
import org.eclipse.jdt.core.*;
import org.eclipse.jdt.core.dom.*;
import org.eclipse.jdt.core.search.SearchEngine;
import org.eclipse.jdt.core.search.SearchMatch;
import org.eclipse.jdt.core.search.SearchParticipant;
import org.eclipse.jdt.core.search.SearchPattern;
import org.eclipse.jdt.core.search.SearchRequestor;

import java.io.File;
import java.nio.file.Paths;
import org.eclipse.core.runtime.Path;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.*;

public class JavaProjectAnalyzer {
    private static final Logger logger = LoggerFactory.getLogger(JavaProjectAnalyzer.class);
    
    private IWorkspaceRoot workspaceRoot;
    private IJavaProject javaProject;
    private boolean initialized = false;
    
    private boolean workspaceAvailable = false;
    
    public JavaProjectAnalyzer() {
        // Lazy initialization - don't try Eclipse workspace until needed
        this.workspaceAvailable = false;
    }
    
    private String projectPath;
    private String projectName;
    
    public void initializeProject(String projectPath) throws CoreException {
        if (initialized) {
            return; // Already initialized
        }
        
        this.projectPath = projectPath;
        java.nio.file.Path path = Paths.get(projectPath).toAbsolutePath();
        File projectDir = path.toFile();
        
        if (!projectDir.exists() || !projectDir.isDirectory()) {
            throw new IllegalArgumentException("Project directory does not exist: " + projectPath);
        }
        
        this.projectName = path.getFileName().toString();
        
        if (workspaceAvailable) {
            try {
                initializeWithWorkspace(path, projectDir);
                logger.info("Successfully initialized Java project with full Eclipse workspace support: {}", projectPath);
            } catch (Exception e) {
                logger.warn("Failed to initialize with workspace, falling back to basic mode: {}", e.getMessage());
                this.workspaceAvailable = false;
                initializeBasicMode(projectDir);
            }
        } else {
            initializeBasicMode(projectDir);
        }
        
        this.initialized = true;
    }
    
    private void initializeWithWorkspace(java.nio.file.Path path, File projectDir) throws CoreException {
        // Create Eclipse project
        IProject project = workspaceRoot.getProject(projectName);
        
        if (!project.exists()) {
            IProjectDescription description = ResourcesPlugin.getWorkspace().newProjectDescription(projectName);
            description.setLocation(new Path(path.toString()));
            project.create(description, null);
            logger.debug("Created Eclipse project: {}", projectName);
        }
        
        if (!project.isOpen()) {
            project.open(null);
            logger.debug("Opened Eclipse project: {}", projectName);
        }
        
        // Add Java nature if not present
        if (!project.hasNature(JavaCore.NATURE_ID)) {
            addJavaNature(project);
            logger.debug("Added Java nature to project: {}", projectName);
        }
        
        // Create Java project
        this.javaProject = JavaCore.create(project);
        
        // Configure classpath
        configureClasspath(projectDir);
        logger.debug("Configured classpath for project: {}", projectName);
    }
    
    private void initializeBasicMode(File projectDir) {
        logger.info("Initializing project in basic file analysis mode: {}", projectPath);
        // In basic mode, we'll work with file system scanning
        // This provides limited functionality but allows the server to work
    }
    
    
    private void addJavaNature(IProject project) throws CoreException {
        IProjectDescription description = project.getDescription();
        String[] natures = description.getNatureIds();
        String[] newNatures = new String[natures.length + 1];
        System.arraycopy(natures, 0, newNatures, 0, natures.length);
        newNatures[natures.length] = JavaCore.NATURE_ID;
        description.setNatureIds(newNatures);
        project.setDescription(description, null);
    }
    
    private void configureClasspath(File projectDir) throws CoreException {
        List<IClasspathEntry> classpathEntries = new ArrayList<>();
        
        // Add source folders
        addSourceFolders(projectDir, classpathEntries);
        
        // Add JRE container
        classpathEntries.add(JavaCore.newContainerEntry(
            new Path("org.eclipse.jdt.launching.JRE_CONTAINER")));
        
        // Check for Maven project
        File pomFile = new File(projectDir, "pom.xml");
        if (pomFile.exists()) {
            classpathEntries.add(JavaCore.newContainerEntry(
                new Path("org.eclipse.m2e.MAVEN2_CLASSPATH_CONTAINER")));
        }
        
        // Check for Gradle project
        File buildGradle = new File(projectDir, "build.gradle");
        File buildGradleKts = new File(projectDir, "build.gradle.kts");
        if (buildGradle.exists() || buildGradleKts.exists()) {
            classpathEntries.add(JavaCore.newContainerEntry(
                new Path("org.eclipse.buildship.core.gradleclasspathcontainer")));
        }
        
        // Set classpath
        javaProject.setRawClasspath(classpathEntries.toArray(new IClasspathEntry[0]), null);
    }
    
    private void addSourceFolders(File projectDir, List<IClasspathEntry> classpathEntries) {
        // Common source folder patterns
        String[] sourceFolders = {
            "src/main/java",
            "src/test/java", 
            "src",
            "test"
        };
        
        for (String srcFolder : sourceFolders) {
            File sourceDir = new File(projectDir, srcFolder);
            if (sourceDir.exists() && sourceDir.isDirectory()) {
                classpathEntries.add(JavaCore.newSourceEntry(
                    javaProject.getProject().getFullPath().append(srcFolder)));
            }
        }
    }
    
    public List<IType> getAllTypes() throws CoreException {
        if (!initialized) {
            throw new IllegalStateException("Project not initialized");
        }
        
        List<IType> types = new ArrayList<>();
        IPackageFragmentRoot[] roots = javaProject.getPackageFragmentRoots();
        
        for (IPackageFragmentRoot root : roots) {
            if (root.getKind() == IPackageFragmentRoot.K_SOURCE) {
                IJavaElement[] packages = root.getChildren();
                for (IJavaElement pkg : packages) {
                    if (pkg instanceof IPackageFragment) {
                        IPackageFragment packageFragment = (IPackageFragment) pkg;
                        ICompilationUnit[] compilationUnits = packageFragment.getCompilationUnits();
                        for (ICompilationUnit cu : compilationUnits) {
                            IType[] cuTypes = cu.getTypes();
                            types.addAll(Arrays.asList(cuTypes));
                        }
                    }
                }
            }
        }
        
        return types;
    }
    
    public IType findType(String fullyQualifiedName) throws JavaModelException {
        if (!initialized) {
            throw new IllegalStateException("Project not initialized");
        }
        
        return javaProject.findType(fullyQualifiedName);
    }
    
    public List<IMethod> findMethods(String className, String methodName) throws JavaModelException {
        IType type = findType(className);
        if (type == null) {
            return Collections.emptyList();
        }
        
        List<IMethod> methods = new ArrayList<>();
        IMethod[] allMethods = type.getMethods();
        
        for (IMethod method : allMethods) {
            if (methodName == null || method.getElementName().equals(methodName)) {
                methods.add(method);
            }
        }
        
        return methods;
    }
    
    public List<IField> findFields(String className, String fieldName) throws JavaModelException {
        IType type = findType(className);
        if (type == null) {
            return Collections.emptyList();
        }
        
        List<IField> fields = new ArrayList<>();
        IField[] allFields = type.getFields();
        
        for (IField field : allFields) {
            if (fieldName == null || field.getElementName().equals(fieldName)) {
                fields.add(field);
            }
        }
        
        return fields;
    }
    
    public IJavaProject getJavaProject() {
        return javaProject;
    }
    
    public boolean isInitialized() {
        return initialized;
    }
    
    public List<ICompilationUnit> getAllCompilationUnits() throws JavaModelException {
        if (!initialized) {
            throw new IllegalStateException("Project not initialized");
        }
        
        List<ICompilationUnit> compilationUnits = new ArrayList<>();
        IPackageFragmentRoot[] roots = javaProject.getPackageFragmentRoots();
        
        for (IPackageFragmentRoot root : roots) {
            if (root.getKind() == IPackageFragmentRoot.K_SOURCE) {
                IJavaElement[] packages = root.getChildren();
                for (IJavaElement pkg : packages) {
                    if (pkg instanceof IPackageFragment) {
                        IPackageFragment packageFragment = (IPackageFragment) pkg;
                        ICompilationUnit[] units = packageFragment.getCompilationUnits();
                        compilationUnits.addAll(Arrays.asList(units));
                    }
                }
            }
        }
        
        return compilationUnits;
    }
    
    public Map<String, Object> getProjectInfo() throws JavaModelException {
        if (!initialized) {
            throw new IllegalStateException("Project not initialized");
        }
        
        Map<String, Object> info = new HashMap<>();
        info.put("projectName", projectName);
        info.put("location", projectPath);
        
        if (workspaceAvailable && javaProject != null) {
            info.put("mode", "full_eclipse_workspace");
            
            try {
                // Count types
                List<IType> types = getAllTypes();
                info.put("totalTypes", types.size());
                
                // Count packages
                Set<String> packages = new HashSet<>();
                for (IType type : types) {
                    packages.add(type.getPackageFragment().getElementName());
                }
                info.put("totalPackages", packages.size());
                
                // Count compilation units
                List<ICompilationUnit> compilationUnits = getAllCompilationUnits();
                info.put("totalCompilationUnits", compilationUnits.size());
                
            } catch (CoreException e) {
                logger.warn("Error getting project info from workspace: {}", e.getMessage());
                info.put("totalTypes", 0);
                info.put("totalPackages", 0);
                info.put("totalCompilationUnits", 0);
                info.put("note", "Workspace analysis failed: " + e.getMessage());
            }
        } else {
            info.put("mode", "basic_file_analysis");
            info.put("totalTypes", 0);
            info.put("totalPackages", 0);
            info.put("totalCompilationUnits", 0);
            info.put("note", "Running in basic mode. Full Eclipse workspace not available.");
        }
        
        return info;
    }
}