package com.example;

import org.eclipse.core.runtime.adaptor.EclipseStarter;
import org.eclipse.core.resources.*;
import org.eclipse.core.runtime.*;
import org.eclipse.jdt.core.*;
import org.osgi.framework.Bundle;
import org.osgi.framework.BundleContext;
import org.osgi.framework.BundleException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.IOException;
import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.*;

/**
 * Starts Eclipse platform with full OSGi support for JDT operations
 */
public class EclipsePlatformStarter {
    private static final Logger logger = LoggerFactory.getLogger(EclipsePlatformStarter.class);

    private static EclipsePlatformStarter instance;
    private BundleContext bundleContext;
    private IWorkspace workspace;
    private boolean initialized = false;
    private java.nio.file.Path workspaceLocation;

    private EclipsePlatformStarter() {}

    public static synchronized EclipsePlatformStarter getInstance() {
        if (instance == null) {
            instance = new EclipsePlatformStarter();
        }
        return instance;
    }

    /**
     * Initialize Eclipse platform with embedded OSGi
     */
    public boolean initialize() {
        if (initialized) {
            return true;
        }

        try {
            logger.info("Starting Eclipse platform initialization...");

            // Create workspace directory
            workspaceLocation = Files.createTempDirectory("eclipse-workspace-");
            Files.createDirectories(workspaceLocation.resolve(".metadata"));
            Files.createDirectories(workspaceLocation.resolve(".metadata/.plugins"));

            // Setup Eclipse home (use embedded jars from classpath)
            java.nio.file.Path eclipseHome = setupEclipseHome();

            // Configure OSGi properties
            Map<String, String> config = new HashMap<>();
            config.put("osgi.install.area", eclipseHome.toUri().toString());
            config.put("osgi.instance.area", workspaceLocation.toUri().toString());
            config.put("osgi.instance.area.default", workspaceLocation.toUri().toString());
            config.put("osgi.configuration.area", workspaceLocation.resolve("configuration").toUri().toString());
            config.put("osgi.noShutdown", "true");
            config.put("eclipse.ignoreApp", "true");
            config.put("eclipse.application.launchDefault", "false");
            config.put("osgi.bundles.defaultStartLevel", "4");
            config.put("osgi.compatibility.bootdelegation", "true");
            config.put("osgi.contextClassLoaderParent", "ccl");
            config.put("osgi.parentClassloader", "app");
            config.put("osgi.framework.useSystemProperties", "true");

            // Add required bundles to auto-start
            StringBuilder bundles = new StringBuilder();
            bundles.append("org.eclipse.core.runtime@start,");
            bundles.append("org.eclipse.core.resources@start,");
            bundles.append("org.eclipse.jdt.core@start,");
            bundles.append("org.eclipse.equinox.common@2:start,");
            bundles.append("org.eclipse.core.jobs@start,");
            bundles.append("org.eclipse.equinox.registry@start,");
            bundles.append("org.eclipse.equinox.preferences@start,");
            bundles.append("org.eclipse.core.contenttype@start,");
            bundles.append("org.eclipse.equinox.app@start");
            config.put("osgi.bundles", bundles.toString());

            // Set as system properties as well
            for (Map.Entry<String, String> entry : config.entrySet()) {
                System.setProperty(entry.getKey(), entry.getValue());
            }

            logger.info("Starting OSGi framework...");

            try {
                // Initialize and start Eclipse
                EclipseStarter.setInitialProperties(config);
                bundleContext = EclipseStarter.startup(new String[]{"-consoleLog"}, null);

                if (bundleContext == null) {
                    logger.error("Failed to get bundle context from EclipseStarter");
                    return false;
                }

                logger.info("OSGi framework started, initializing workspace...");

                // Start required bundles
                startRequiredBundles();

                // Initialize workspace
                if (initializeWorkspace()) {
                    initialized = true;
                    logger.info("Eclipse platform fully initialized!");
                    return true;
                } else {
                    logger.error("Failed to initialize workspace");
                    return false;
                }

            } catch (Exception e) {
                logger.error("Failed to start OSGi framework: {}", e.getMessage(), e);

                // Try alternative approach - direct platform initialization
                return tryDirectPlatformInit();
            }

        } catch (Exception e) {
            logger.error("Failed to initialize Eclipse platform: {}", e.getMessage(), e);
            return false;
        }
    }

    /**
     * Setup Eclipse home with required plugins
     */
    private java.nio.file.Path setupEclipseHome() throws IOException {
        java.nio.file.Path eclipseHome = Files.createTempDirectory("eclipse-home-");
        java.nio.file.Path pluginsDir = eclipseHome.resolve("plugins");
        Files.createDirectories(pluginsDir);

        // The plugins are already in our classpath via Maven dependencies
        // We just need to set up the directory structure
        logger.debug("Eclipse home created at: {}", eclipseHome);

        return eclipseHome;
    }

    /**
     * Start required OSGi bundles
     */
    private void startRequiredBundles() {
        try {
            Bundle[] bundles = bundleContext.getBundles();
            logger.info("Found {} bundles in OSGi framework", bundles.length);

            String[] requiredBundles = {
                "org.eclipse.core.runtime",
                "org.eclipse.core.resources",
                "org.eclipse.jdt.core",
                "org.eclipse.core.jobs",
                "org.eclipse.equinox.common",
                "org.eclipse.equinox.registry",
                "org.eclipse.equinox.preferences"
            };

            for (String bundleName : requiredBundles) {
                for (Bundle bundle : bundles) {
                    if (bundle.getSymbolicName() != null &&
                        bundle.getSymbolicName().startsWith(bundleName)) {
                        try {
                            if (bundle.getState() != Bundle.ACTIVE) {
                                bundle.start();
                                logger.debug("Started bundle: {}", bundle.getSymbolicName());
                            }
                        } catch (BundleException e) {
                            logger.warn("Could not start bundle {}: {}",
                                bundle.getSymbolicName(), e.getMessage());
                        }
                    }
                }
            }
        } catch (Exception e) {
            logger.error("Error starting bundles: {}", e.getMessage());
        }
    }

    /**
     * Try direct platform initialization without full OSGi
     */
    private boolean tryDirectPlatformInit() {
        try {
            logger.info("Attempting direct platform initialization...");

            // Use reflection to access Platform internals if available
            Class<?> platformClass = Class.forName("org.eclipse.core.internal.runtime.InternalPlatform");
            Method getDefault = platformClass.getMethod("getDefault");
            Object platform = getDefault.invoke(null);

            if (platform != null) {
                Method startup = platformClass.getMethod("start", BundleContext.class);
                startup.invoke(platform, (Object) null);

                // Try to get workspace
                workspace = ResourcesPlugin.getWorkspace();
                if (workspace != null) {
                    logger.info("Direct platform initialization successful");
                    initialized = true;
                    return true;
                }
            }
        } catch (Exception e) {
            logger.debug("Direct platform init failed: {}", e.getMessage());
        }

        // Last resort - try to just get workspace directly
        try {
            workspace = ResourcesPlugin.getWorkspace();
            if (workspace != null) {
                logger.info("Got workspace without full platform init");
                initialized = true;
                return true;
            }
        } catch (Exception e) {
            logger.debug("Could not get workspace: {}", e.getMessage());
        }

        return false;
    }

    /**
     * Initialize Eclipse workspace
     */
    private boolean initializeWorkspace() {
        try {
            // Get workspace
            workspace = ResourcesPlugin.getWorkspace();

            if (workspace == null) {
                logger.error("Workspace is null after platform startup");
                return false;
            }

            IWorkspaceRoot root = workspace.getRoot();
            logger.info("Workspace root: {}", root.getLocation());

            // Configure workspace
            IWorkspaceDescription desc = workspace.getDescription();
            desc.setAutoBuilding(false);
            workspace.setDescription(desc);

            // Configure Java settings
            Hashtable<String, String> options = JavaCore.getOptions();
            options.put(JavaCore.COMPILER_COMPLIANCE, JavaCore.VERSION_11);
            options.put(JavaCore.COMPILER_SOURCE, JavaCore.VERSION_11);
            options.put(JavaCore.COMPILER_CODEGEN_TARGET_PLATFORM, JavaCore.VERSION_11);
            JavaCore.setOptions(options);

            logger.info("Workspace initialized successfully");
            return true;

        } catch (Exception e) {
            logger.error("Failed to initialize workspace: {}", e.getMessage(), e);
            return false;
        }
    }

    /**
     * Create a Java project in the workspace
     */
    public IJavaProject createJavaProject(String name, String sourceLocation) throws CoreException {
        if (!initialized || workspace == null) {
            throw new IllegalStateException("Eclipse platform not initialized");
        }

        IWorkspaceRoot root = workspace.getRoot();
        IProject project = root.getProject(name);

        // Delete if exists
        if (project.exists()) {
            project.delete(true, true, new NullProgressMonitor());
        }

        // Create project
        IProjectDescription description = workspace.newProjectDescription(name);

        // Link to external location if provided
        if (sourceLocation != null) {
            IPath locationPath = new org.eclipse.core.runtime.Path(sourceLocation);
            description.setLocation(locationPath);
        }

        project.create(description, new NullProgressMonitor());
        project.open(new NullProgressMonitor());

        // Add Java nature
        description = project.getDescription();
        description.setNatureIds(new String[] { JavaCore.NATURE_ID });
        project.setDescription(description, new NullProgressMonitor());

        // Create Java project
        IJavaProject javaProject = JavaCore.create(project);

        // Setup classpath
        setupProjectClasspath(javaProject, sourceLocation);

        return javaProject;
    }

    /**
     * Setup project classpath
     */
    private void setupProjectClasspath(IJavaProject javaProject, String projectPath) throws CoreException {
        List<IClasspathEntry> entries = new ArrayList<>();

        // Add JRE
        entries.add(JavaCore.newContainerEntry(
            new org.eclipse.core.runtime.Path("org.eclipse.jdt.launching.JRE_CONTAINER/org.eclipse.jdt.internal.debug.ui.launcher.StandardVMType/JavaSE-11")
        ));

        if (projectPath != null) {
            File projectDir = new File(projectPath);

            // Add source folders
            String[] sourcePaths = {"src/main/java", "src/test/java", "src"};
            for (String srcPath : sourcePaths) {
                File srcDir = new File(projectDir, srcPath);
                if (srcDir.exists() && srcDir.isDirectory()) {
                    IPath path = javaProject.getPath().append(srcPath);
                    entries.add(JavaCore.newSourceEntry(path));
                    logger.debug("Added source entry: {}", srcPath);
                }
            }

            // Add JARs from lib directory
            File libDir = new File(projectDir, "lib");
            if (libDir.exists() && libDir.isDirectory()) {
                File[] jars = libDir.listFiles((dir, name) -> name.endsWith(".jar"));
                if (jars != null) {
                    for (File jar : jars) {
                        entries.add(JavaCore.newLibraryEntry(
                            new org.eclipse.core.runtime.Path(jar.getAbsolutePath()),
                            null, null
                        ));
                    }
                }
            }

            // Add build output directories
            String[] outputDirs = {"target/classes", "build/classes/java/main", "bin"};
            for (String outDir : outputDirs) {
                File dir = new File(projectDir, outDir);
                if (dir.exists()) {
                    entries.add(JavaCore.newLibraryEntry(
                        new org.eclipse.core.runtime.Path(dir.getAbsolutePath()),
                        null, null
                    ));
                }
            }
        }

        // Set classpath
        javaProject.setRawClasspath(
            entries.toArray(new IClasspathEntry[0]),
            new NullProgressMonitor()
        );
    }

    public IWorkspace getWorkspace() {
        return workspace;
    }

    public boolean isInitialized() {
        return initialized;
    }

    /**
     * Shutdown Eclipse platform
     */
    public void shutdown() {
        if (!initialized) {
            return;
        }

        try {
            logger.info("Shutting down Eclipse platform...");

            if (workspace != null) {
                IWorkspaceRoot root = workspace.getRoot();
                for (IProject project : root.getProjects()) {
                    try {
                        project.close(new NullProgressMonitor());
                        project.delete(true, true, new NullProgressMonitor());
                    } catch (Exception e) {
                        logger.debug("Error closing project: {}", e.getMessage());
                    }
                }
            }

            if (bundleContext != null) {
                EclipseStarter.shutdown();
            }

            // Cleanup workspace directory
            if (workspaceLocation != null && Files.exists(workspaceLocation)) {
                Files.walk(workspaceLocation)
                    .sorted(Comparator.reverseOrder())
                    .forEach(path -> {
                        try {
                            Files.delete(path);
                        } catch (Exception e) {
                            // Ignore
                        }
                    });
            }

            initialized = false;
            logger.info("Eclipse platform shutdown complete");

        } catch (Exception e) {
            logger.error("Error during shutdown: {}", e.getMessage());
        }
    }
}