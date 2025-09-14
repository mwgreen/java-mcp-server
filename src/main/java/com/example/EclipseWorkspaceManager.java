package com.example;

import org.eclipse.core.resources.*;
import org.eclipse.core.runtime.*;
import org.eclipse.core.runtime.adaptor.EclipseStarter;
import org.eclipse.jdt.core.*;
import org.osgi.framework.BundleContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.*;

/**
 * Manages Eclipse workspace initialization for full JDT functionality
 */
public class EclipseWorkspaceManager {
    private static final Logger logger = LoggerFactory.getLogger(EclipseWorkspaceManager.class);

    private static EclipseWorkspaceManager instance;
    private static final Object lock = new Object();

    private IWorkspace workspace;
    private IWorkspaceRoot workspaceRoot;
    private boolean initialized = false;
    private java.nio.file.Path workspaceDir;
    private BundleContext bundleContext;

    private EclipseWorkspaceManager() {}

    public static EclipseWorkspaceManager getInstance() {
        if (instance == null) {
            synchronized (lock) {
                if (instance == null) {
                    instance = new EclipseWorkspaceManager();
                }
            }
        }
        return instance;
    }

    /**
     * Initialize Eclipse workspace with full OSGi runtime
     */
    public boolean initialize() {
        if (initialized) {
            return true;
        }

        synchronized (lock) {
            if (initialized) {
                return true;
            }

            try {
                logger.info("Initializing Eclipse workspace with OSGi runtime...");

                // Create temporary workspace directory
                workspaceDir = createTempWorkspace();

                // Set up Eclipse/OSGi properties
                Map<String, String> props = new HashMap<>();
                props.put("osgi.instance.area", workspaceDir.toUri().toString());
                props.put("osgi.configuration.area", workspaceDir.resolve("configuration").toUri().toString());
                props.put("osgi.install.area", getEclipseInstallArea());
                props.put("osgi.noShutdown", "true");
                props.put("eclipse.ignoreApp", "true");
                props.put("eclipse.application", "org.eclipse.jdt.core.JavaCodeFormatter");
                props.put("osgi.bundles.defaultStartLevel", "4");
                props.put("osgi.clean", "true");

                // Start OSGi framework
                try {
                    EclipseStarter.setInitialProperties(props);
                    bundleContext = EclipseStarter.startup(new String[]{"-console", "-consoleLog"}, null);

                    if (bundleContext != null) {
                        logger.info("OSGi framework started successfully");

                        // Initialize the workspace
                        initializeWorkspace();

                        initialized = true;
                        logger.info("Eclipse workspace fully initialized at: {}", workspaceDir);
                        return true;
                    } else {
                        logger.warn("OSGi framework started but bundle context is null");
                        return false;
                    }
                } catch (Exception e) {
                    logger.error("Failed to start OSGi framework: {}", e.getMessage(), e);

                    // Try alternative initialization without full OSGi
                    return initializeLightweight();
                }

            } catch (Exception e) {
                logger.error("Failed to initialize Eclipse workspace: {}", e.getMessage(), e);
                return false;
            }
        }
    }

    /**
     * Lightweight initialization without full OSGi (fallback)
     */
    private boolean initializeLightweight() {
        try {
            logger.info("Attempting lightweight Eclipse initialization...");

            // Set minimal properties
            System.setProperty("osgi.instance.area", workspaceDir.toUri().toString());
            System.setProperty("eclipse.ignoreApp", "true");

            // Try to initialize core components directly
            // Platform.startup is not available in newer versions
            // Try to get workspace directly
            logger.info("Attempting to get workspace without full OSGi...");

            // Get workspace
            workspace = ResourcesPlugin.getWorkspace();
            if (workspace != null) {
                workspaceRoot = workspace.getRoot();
                logger.info("Lightweight Eclipse workspace initialized");
                initialized = true;
                return true;
            }

        } catch (Exception e) {
            logger.warn("Lightweight initialization also failed: {}", e.getMessage());
        }

        return false;
    }

    private void initializeWorkspace() throws CoreException {
        // Get the workspace
        workspace = ResourcesPlugin.getWorkspace();
        workspaceRoot = workspace.getRoot();

        // Set workspace preferences for Java projects
        IWorkspaceDescription desc = workspace.getDescription();
        desc.setAutoBuilding(false); // Disable auto-build for performance
        workspace.setDescription(desc);

        // Set Java-specific preferences
        Hashtable<String, String> options = JavaCore.getOptions();
        options.put(JavaCore.COMPILER_COMPLIANCE, JavaCore.VERSION_11);
        options.put(JavaCore.COMPILER_SOURCE, JavaCore.VERSION_11);
        options.put(JavaCore.COMPILER_CODEGEN_TARGET_PLATFORM, JavaCore.VERSION_11);
        JavaCore.setOptions(options);

        logger.info("Workspace initialized with Java compliance level: {}", JavaCore.VERSION_11);
    }

    /**
     * Create a Java project in the workspace
     */
    public IJavaProject createJavaProject(String projectName, String projectPath) throws CoreException {
        if (!initialized) {
            throw new IllegalStateException("Workspace not initialized");
        }

        // Create project
        IProject project = workspaceRoot.getProject(projectName);

        if (project.exists()) {
            // Delete existing project
            project.delete(true, true, new NullProgressMonitor());
        }

        project.create(new NullProgressMonitor());
        project.open(new NullProgressMonitor());

        // Add Java nature
        IProjectDescription description = project.getDescription();
        description.setNatureIds(new String[] { JavaCore.NATURE_ID });
        project.setDescription(description, new NullProgressMonitor());

        // Create Java project
        IJavaProject javaProject = JavaCore.create(project);

        // Set up classpath
        setupClasspath(javaProject, projectPath);

        // Link source folders
        linkSourceFolders(project, javaProject, projectPath);

        return javaProject;
    }

    private void setupClasspath(IJavaProject javaProject, String projectPath) throws CoreException {
        List<IClasspathEntry> entries = new ArrayList<>();

        // Add JRE container
        entries.add(JavaCore.newContainerEntry(
            new org.eclipse.core.runtime.Path("org.eclipse.jdt.launching.JRE_CONTAINER/org.eclipse.jdt.internal.debug.ui.launcher.StandardVMType/JavaSE-11")
        ));

        // Look for source folders
        File projectDir = new File(projectPath);

        // Common source folder patterns
        String[] sourcePaths = {
            "src/main/java",
            "src/test/java",
            "src",
            "source"
        };

        for (String srcPath : sourcePaths) {
            File srcDir = new File(projectDir, srcPath);
            if (srcDir.exists() && srcDir.isDirectory()) {
                IPath sourcePath = new org.eclipse.core.runtime.Path("/" + javaProject.getElementName() + "/" + srcPath);
                entries.add(JavaCore.newSourceEntry(sourcePath));
                logger.debug("Added source folder: {}", srcPath);
            }
        }

        // Look for lib folder with JARs
        File libDir = new File(projectDir, "lib");
        if (libDir.exists() && libDir.isDirectory()) {
            File[] jars = libDir.listFiles((dir, name) -> name.endsWith(".jar"));
            if (jars != null) {
                for (File jar : jars) {
                    entries.add(JavaCore.newLibraryEntry(
                        new org.eclipse.core.runtime.Path(jar.getAbsolutePath()),
                        null, // source attachment
                        null  // source attachment root
                    ));
                    logger.debug("Added library: {}", jar.getName());
                }
            }
        }

        // Check for Maven/Gradle build files and add common dependency locations
        addBuildToolDependencies(projectDir, entries);

        // Set the classpath
        javaProject.setRawClasspath(
            entries.toArray(new IClasspathEntry[0]),
            new NullProgressMonitor()
        );
    }

    private void addBuildToolDependencies(File projectDir, List<IClasspathEntry> entries) {
        // Check for Maven
        if (new File(projectDir, "pom.xml").exists()) {
            // Add Maven repository JARs (simplified - in production, parse pom.xml)
            String userHome = System.getProperty("user.home");
            File m2Repo = new File(userHome, ".m2/repository");
            if (m2Repo.exists()) {
                logger.debug("Found Maven repository at: {}", m2Repo);
                // In a real implementation, we'd parse pom.xml and add specific dependencies
            }
        }

        // Check for Gradle
        if (new File(projectDir, "build.gradle").exists() ||
            new File(projectDir, "build.gradle.kts").exists()) {
            // Add Gradle cache JARs (simplified)
            String userHome = System.getProperty("user.home");
            File gradleCache = new File(userHome, ".gradle/caches");
            if (gradleCache.exists()) {
                logger.debug("Found Gradle cache at: {}", gradleCache);
                // In a real implementation, we'd parse build.gradle and add specific dependencies
            }
        }

        // For now, add the build output directories if they exist
        String[] outputPaths = {
            "target/classes",           // Maven
            "build/classes/java/main",  // Gradle
            "out/production",            // IntelliJ
            "bin"                        // Eclipse
        };

        for (String outPath : outputPaths) {
            File outDir = new File(projectDir, outPath);
            if (outDir.exists() && outDir.isDirectory()) {
                entries.add(JavaCore.newLibraryEntry(
                    new org.eclipse.core.runtime.Path(outDir.getAbsolutePath()),
                    null,
                    null
                ));
                logger.debug("Added output directory to classpath: {}", outPath);
            }
        }
    }

    private void linkSourceFolders(IProject project, IJavaProject javaProject, String projectPath)
            throws CoreException {
        File projectDir = new File(projectPath);

        // Link the project directory to Eclipse workspace
        IPath location = new org.eclipse.core.runtime.Path(projectPath);
        if (!project.getLocation().equals(location)) {
            // Create linked resource
            IFolder srcFolder = project.getFolder("external_src");
            srcFolder.createLink(location, IResource.ALLOW_MISSING_LOCAL, new NullProgressMonitor());
            logger.debug("Linked external source folder: {}", projectPath);
        }
    }

    private java.nio.file.Path createTempWorkspace() throws Exception {
        java.nio.file.Path tempDir = Files.createTempDirectory("eclipse-jdt-workspace-");
        Files.createDirectories(tempDir.resolve("configuration"));
        Files.createDirectories(tempDir.resolve(".metadata"));
        Files.createDirectories(tempDir.resolve(".metadata/.plugins"));

        // Register cleanup hook
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            cleanup();
        }));

        logger.debug("Created temporary workspace at: {}", tempDir);
        return tempDir;
    }

    private String getEclipseInstallArea() {
        // Try to find Eclipse installation or use current directory
        String eclipseHome = System.getProperty("eclipse.home");
        if (eclipseHome != null) {
            return new File(eclipseHome).toURI().toString();
        }

        // Use current directory as fallback
        return new File(".").toURI().toString();
    }

    public IWorkspace getWorkspace() {
        return workspace;
    }

    public IWorkspaceRoot getWorkspaceRoot() {
        return workspaceRoot;
    }

    public boolean isInitialized() {
        return initialized;
    }

    /**
     * Cleanup workspace and shutdown OSGi
     */
    public void cleanup() {
        if (!initialized) {
            return;
        }

        try {
            logger.info("Cleaning up Eclipse workspace...");

            // Close all projects
            if (workspaceRoot != null) {
                for (IProject project : workspaceRoot.getProjects()) {
                    try {
                        project.close(new NullProgressMonitor());
                        project.delete(true, true, new NullProgressMonitor());
                    } catch (Exception e) {
                        logger.debug("Error closing project: {}", e.getMessage());
                    }
                }
            }

            // Shutdown OSGi if it was started
            if (bundleContext != null) {
                EclipseStarter.shutdown();
            }

            // Delete workspace directory
            if (workspaceDir != null && Files.exists(workspaceDir)) {
                deleteDirectory(workspaceDir);
            }

            initialized = false;
            logger.info("Eclipse workspace cleaned up");

        } catch (Exception e) {
            logger.error("Error during cleanup: {}", e.getMessage(), e);
        }
    }

    private void deleteDirectory(java.nio.file.Path dir) throws Exception {
        if (Files.exists(dir)) {
            Files.walk(dir)
                .sorted(Comparator.reverseOrder())
                .forEach(path -> {
                    try {
                        Files.delete(path);
                    } catch (Exception e) {
                        logger.debug("Could not delete: {}", path);
                    }
                });
        }
    }
}