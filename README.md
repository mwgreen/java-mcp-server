# Java MCP Server

A Model Context Protocol (MCP) server that provides Java code analysis capabilities through Eclipse JDT integration for Claude Code and Claude Desktop. This server enables IDE-like features for Java projects including call hierarchy analysis, type hierarchy exploration, reference finding, and refactoring operations.

## Features

- **Project Analysis**: Initialize and analyze Maven/Gradle Java projects
- **Call Hierarchy**: Find method callers and callees across the project
- **Type Hierarchy**: Explore class inheritance and interface implementations
- **Reference Finding**: Locate all references to classes, methods, and fields
- **Code Information**: Get detailed information about classes and methods
- **Refactoring**: Rename classes, methods, and fields with preview support
- **JSON-RPC Interface**: Standard MCP protocol for integration with Claude Desktop

## Prerequisites

- **Java 17+**: Required for running the server
- **Maven 3.6+**: For building the project
- **Eclipse JDT**: Included as dependencies for code analysis

## Installation

### Prerequisites

- **Java 17+**: Required for running the server
- **Maven 3.6+**: For building the project
- **Node.js 16+**: For the Claude Code bridge

### Quick Start

1. Clone this repository:
```bash
git clone https://github.com/yourusername/java-mcp-server.git
cd java-mcp-server
```

2. Build the project:
```bash
mvn clean package
```

3. Add to Claude Code:

**For current project only (local):**
```bash
claude mcp add java-analyzer -s local -- /path/to/java-mcp-server/eclipse-jdt-mcp
```

**For all projects (global):**
```bash
claude mcp add java-analyzer -s global -- /path/to/java-mcp-server/eclipse-jdt-mcp
```

4. Verify installation:
```bash
claude mcp list
```

You should see: `java-analyzer: /path/to/java-mcp-server/eclipse-jdt-mcp - ✓ Connected`

## MCP Tools

The server provides the following MCP tools:

### 1. initialize_project

Initialize Java project analysis for a directory.

**Parameters:**
- `project_path` (string, required): Absolute path to the Java project directory

**Example:**
```json
{
  "name": "initialize_project",
  "arguments": {
    "project_path": "/path/to/your/java/project"
  }
}
```

### 2. get_call_hierarchy

Analyze method call relationships (who calls this method / what does this method call).

**Parameters:**
- `class_name` (string, required): Fully qualified class name
- `method_name` (string, required): Method name
- `parameter_types` (array, optional): Method parameter types for overloaded methods
- `include_callers` (boolean, optional): Include callers in result (default: true)
- `include_callees` (boolean, optional): Include callees in result (default: true)

**Example:**
```json
{
  "name": "get_call_hierarchy",
  "arguments": {
    "class_name": "com.example.MyClass",
    "method_name": "processData",
    "include_callers": true,
    "include_callees": true
  }
}
```

### 3. get_type_hierarchy

Explore class inheritance and interface relationships.

**Parameters:**
- `type_name` (string, required): Fully qualified type name

**Example:**
```json
{
  "name": "get_type_hierarchy",
  "arguments": {
    "type_name": "com.example.MyClass"
  }
}
```

### 4. find_references

Find all references to classes, methods, or fields.

**Parameters:**
- `class_name` (string, required): Fully qualified class name
- `member_name` (string, optional): Member name (method/field)
- `parameter_types` (array, optional): Method parameter types
- `element_type` (string, optional): Element type (method/field/type/constructor)

**Example:**
```json
{
  "name": "find_references",
  "arguments": {
    "class_name": "com.example.MyClass",
    "member_name": "myMethod",
    "element_type": "method"
  }
}
```

### 5. get_class_info

Get detailed information about a class including methods and fields.

**Parameters:**
- `class_name` (string, required): Fully qualified class name

**Example:**
```json
{
  "name": "get_class_info",
  "arguments": {
    "class_name": "com.example.MyClass"
  }
}
```

### 6. list_classes

List all classes in the project.

**Parameters:** None

**Example:**
```json
{
  "name": "list_classes",
  "arguments": {}
}
```

### 7. get_method_info

Get detailed information about a specific method.

**Parameters:**
- `class_name` (string, required): Fully qualified class name
- `method_name` (string, required): Method name
- `parameter_types` (array, optional): Method parameter types

**Example:**
```json
{
  "name": "get_method_info",
  "arguments": {
    "class_name": "com.example.MyClass",
    "method_name": "processData"
  }
}
```

### 8. refactor_rename

Rename symbols across the project with preview support.

**Parameters:**
- `element_type` (string, required): Element type (class/method/field)
- `class_name` (string, required): Fully qualified class name
- `member_name` (string, optional): Member name (for methods/fields)
- `parameter_types` (array, optional): Method parameter types
- `new_name` (string, required): New name for the element
- `preview` (boolean, optional): Preview changes only (default: false)

**Example:**
```json
{
  "name": "refactor_rename",
  "arguments": {
    "element_type": "method",
    "class_name": "com.example.MyClass",
    "member_name": "oldMethodName",
    "new_name": "newMethodName",
    "preview": true
  }
}
```

## How It Works

### Architecture

The server uses a **bridge architecture** to work around Claude Code's strict timeout requirements:

```
Claude Code → Node.js Bridge (eclipse-jdt-mcp) → Java Backend (TCP port 9876)
     ↓              ↓                            ↓
  stdio         instant response          Eclipse JDT analysis
```

1. **Node.js Bridge** (`eclipse-jdt-mcp`): Responds instantly to Claude Code's health checks
2. **Java Backend**: Runs as a persistent TCP server providing the actual analysis
3. **Automatic Management**: The bridge starts/stops the Java backend as needed

### Why the Bridge?

- Claude Code has a ~500ms timeout for MCP server responses
- JVM startup takes 200-500ms minimum
- The Node.js bridge responds instantly while the Java backend starts in the background

## Usage Examples

### Basic Project Analysis

1. **Initialize a project:**
   ```
   Use the initialize_project tool with your Java project path
   ```

2. **Explore a class:**
   ```
   Use get_class_info to see all methods and fields
   Use get_type_hierarchy to see inheritance relationships
   ```

3. **Analyze method calls:**
   ```
   Use get_call_hierarchy to see who calls a method and what it calls
   ```

4. **Find usages:**
   ```
   Use find_references to locate all references to a class or method
   ```

5. **Refactor safely:**
   ```
   Use refactor_rename with preview=true first, then execute the rename
   ```

### Working with Different Project Types

**Maven Projects:**
- Projects with `pom.xml` are automatically detected
- Maven dependencies are included in analysis
- Standard Maven directory structure is supported

**Gradle Projects:**
- Projects with `build.gradle` or `build.gradle.kts` are detected
- Gradle dependencies are included in analysis

**Plain Java Projects:**
- Projects with standard `src/` directory structure
- Manual classpath configuration

## Troubleshooting

### Common Issues

1. **"Java 17+ required" error:**
   - Install Java 17 or higher
   - Ensure `java` command is in your PATH
   - Check version with `java -version`

2. **"Maven not found" error:**
   - Install Apache Maven
   - Ensure `mvn` command is in your PATH
   - Check version with `mvn -version`

3. **"Project not initialized" error:**
   - Run `initialize_project` tool first with your project path
   - Ensure the project path exists and contains Java source files

4. **"Type/Method not found" errors:**
   - Verify the fully qualified class name is correct
   - Ensure the project has been compiled at least once
   - Check that the class is in the source path (not just in dependencies)

5. **Memory issues with large projects:**
   - The launcher script allocates 2GB heap by default
   - For larger projects, modify the `-Xmx` setting in the launch scripts
   - Consider increasing to `-Xmx4G` or `-Xmx8G` as needed

### Debug Mode

To enable debug logging, set the following environment variable before running:

```bash
export JAVA_OPTS="$JAVA_OPTS -Dorg.slf4j.simpleLogger.defaultLogLevel=debug"
./scripts/launch-server.sh
```

### Performance Tips

1. **Project Size**: The server works best with projects under 100,000 lines of code
2. **Incremental Analysis**: Restart the server when project structure changes significantly
3. **Memory**: Allocate more memory for larger projects using the launcher script settings

## Architecture

The server consists of several key components:

- **JavaMCPServer**: Main JSON-RPC handler and MCP protocol implementation
- **JavaProjectAnalyzer**: Eclipse workspace initialization and project setup
- **CallHierarchyAnalyzer**: Method call relationship analysis
- **TypeHierarchyAnalyzer**: Class inheritance and interface analysis
- **ReferencesFinder**: Symbol reference location across project files
- **RefactoringEngine**: Safe renaming operations with preview support

## Supported Java Versions

- **Target Projects**: Java 8+ projects (source and target compatibility)
- **Runtime**: Java 17+ required to run the server
- **Build**: Maven 3.6+ for building the server

## Managing the Backend

The Java backend runs automatically when needed. If you need to manage it manually:

**Stop the backend:**
```bash
./scripts/stop-backend.sh
```

**Check if backend is running:**
```bash
ps aux | grep java-mcp-server
```

The backend runs on TCP port 9876 by default.

## Limitations

1. **Eclipse Workspace Complexity**: Full Eclipse JDT analysis requires complex OSGi/workspace setup that may not work in all environments
2. **Standalone JDT Challenges**: Running Eclipse JDT outside of Eclipse IDE has inherent limitations
3. **Binary Dependencies**: Analysis limited to source code; binary JARs provide limited information  
4. **Dynamic Code**: Runtime reflection and dynamic proxy usage not fully analyzed
5. **Annotation Processing**: Generated code may not be fully indexed

## Contributing

This is a reference implementation. To extend functionality:

1. Add new analyzer classes following the existing patterns
2. Register new MCP tools in `JavaMCPServer.java`
3. Update the tool list and documentation
4. Test with various Java project types

## License

This project is provided as-is for educational and development purposes. Please review the Eclipse JDT license terms for the underlying analysis components.

## Development

### Building from Source

```bash
mvn clean package
```

### Running Tests

```bash
mvn test
```

### Project Structure

```
java-mcp-server/
├── src/main/java/com/example/
│   ├── JavaMCPServer.java       # Main server & TCP mode
│   ├── JavaProjectAnalyzer.java # Project initialization
│   ├── CallHierarchyAnalyzer.java
│   ├── TypeHierarchyAnalyzer.java
│   ├── ReferencesFinder.java
│   └── RefactoringEngine.java
├── eclipse-jdt-mcp               # Node.js bridge for Claude Code
├── scripts/
│   ├── stop-backend.sh          # Stop Java backend
│   └── launch-server.bat        # Windows launcher
└── pom.xml                      # Maven configuration
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - See LICENSE file for details