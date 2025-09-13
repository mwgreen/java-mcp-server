# Instructions for Claude Code: Java MCP Server Project

Please create a complete Java MCP (Model Context Protocol) server that integrates with Eclipse JDT to provide Java code analysis capabilities. This server will run locally and provide IDE-like features through MCP tools.

## Project Structure to Create

```
java-mcp-server/
├── pom.xml
├── src/
│   └── main/
│       └── java/
│           └── com/
│               └── example/
│                   ├── JavaMCPServer.java
│                   ├── JavaProjectAnalyzer.java
│                   ├── CallHierarchyAnalyzer.java
│                   ├── TypeHierarchyAnalyzer.java
│                   ├── ReferencesFinder.java
│                   └── RefactoringEngine.java
├── scripts/
│   ├── launch-server.sh
│   └── launch-server.bat
└── README.md
```

## Requirements

### 1. Maven Configuration (pom.xml)
Create a Maven project with these key dependencies:
- **Jackson** for JSON processing (version 2.15.2+)
- **Eclipse JDT Core** (version 3.34.0+)
- **Eclipse Platform Runtime** (version 3.27.0+)
- **Eclipse Core Resources** (version 3.18.100+)
- **Eclipse M2E** for Maven support (version 2.0.4+)
- **SLF4J** for logging (version 2.0.9+)

Configuration requirements:
- Java 17+ target
- Maven Shade plugin for creating executable JAR
- Main class: `com.example.JavaMCPServer`

### 2. Core MCP Server (JavaMCPServer.java)

Create the main server class that:

**Communication:**
- Reads JSON-RPC requests from stdin
- Writes JSON-RPC responses to stdout
- Implements MCP protocol for tool communication

**Capabilities Advertisement:**
- Advertise these MCP tools on startup:
  - `initialize_project` - Initialize Java project analysis
  - `get_call_hierarchy` - Get method call hierarchy (callers/callees)
  - `get_type_hierarchy` - Get class inheritance hierarchy
  - `find_references` - Find all references to symbols
  - `get_class_info` - Get detailed class information
  - `list_classes` - List all classes in project
  - `get_method_info` - Get method details and signatures
  - `refactor_rename` - Rename symbols across project

**Request Handling:**
- Parse incoming JSON-RPC method calls
- Route to appropriate handler methods
- Return structured JSON responses
- Handle errors gracefully with proper error responses

### 3. Project Analysis (JavaProjectAnalyzer.java)

Create a helper class that:
- Initializes Eclipse workspace programmatically
- Creates IJavaProject from file system path
- Detects and configures Maven/Gradle projects automatically
- Sets up proper classpath including:
  - Source folders (src/main/java, src/test/java)
  - JRE container
  - Maven/Gradle dependency containers
- Indexes all compilation units in the project
- Provides utility methods for finding types, methods, fields

### 4. Call Hierarchy Analysis (CallHierarchyAnalyzer.java)

Implement call hierarchy functionality:
- **Callers:** Use Eclipse SearchEngine to find all references to a method
- **Callees:** Parse method AST to find all method invocations
- Support both directions (who calls this method / what does this method call)
- Return structured data with:
  - Method signature
  - Declaring class
  - File location (path, line number)
  - Call context

### 5. Type Hierarchy Analysis (TypeHierarchyAnalyzer.java)

Implement inheritance hierarchy:
- **Supertypes:** Use IType.newSupertypeHierarchy()
- **Subtypes:** Use IType.newTypeHierarchy() and getAllSubtypes()
- Include interfaces and classes
- Return structured data with:
  - Fully qualified names
  - Type kind (class/interface/enum)
  - Package information
  - Source file locations

### 6. References Finder (ReferencesFinder.java)

Implement symbol reference searching:
- Use Eclipse SearchEngine with different search patterns:
  - Method references
  - Field references  
  - Type references
  - Constructor references
- Search scope: entire project or specific packages
- Return results with:
  - Reference location
  - Reference type (read/write for fields, call for methods)
  - Surrounding context

### 7. Refactoring Engine (RefactoringEngine.java)

Implement basic refactoring operations:
- **Rename refactoring:**
  - Use Eclipse refactoring API
  - Support renaming: classes, methods, fields, local variables
  - Validate rename operation before execution
  - Return preview of changes or apply changes
- **Extract method:** (optional advanced feature)
- **Move class:** (optional advanced feature)

## Implementation Details

### Error Handling
- Wrap all operations in try-catch blocks
- Return proper JSON-RPC error responses
- Log errors appropriately
- Handle missing classes/methods gracefully

### Performance Considerations
- Cache IJavaProject instances
- Reuse SearchEngine instances
- Implement lazy loading of compilation units
- Add progress monitoring for long operations

### JSON Response Format
Structure all responses as:
```json
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "result": {
    // Tool-specific result data
  }
}
```

### Tool Parameter Validation
Validate all incoming parameters:
- Required vs optional parameters
- Parameter types and formats
- Project initialization status

## Launch Scripts

### Unix/Linux (launch-server.sh)
Create a bash script that:
- Checks for Java 17+ availability
- Builds project if JAR doesn't exist (mvn clean package)
- Launches server with proper JVM args:
  - `-Xmx2G` for heap space
  - Eclipse-specific system properties
- Handles command line arguments

### Windows (launch-server.bat)
Create equivalent Windows batch script

## Documentation (README.md)

Create comprehensive documentation including:
- Project overview and purpose
- Prerequisites (Java 17+, Maven)
- Build instructions
- Usage examples for each MCP tool
- Configuration for Claude Desktop
- Troubleshooting guide

## Testing Strategy

Include example test cases for:
- Project initialization with Maven/Gradle projects
- Call hierarchy analysis on sample methods
- Type hierarchy for inheritance chains
- Reference finding across multiple files
- Basic rename refactoring

## Configuration Integration

Provide example Claude Desktop configuration:
```json
{
  "mcpServers": {
    "java-analyzer": {
      "command": "/path/to/java-mcp-server/scripts/launch-server.sh",
      "args": []
    }
  }
}
```

## Advanced Features (Optional)

If time permits, consider adding:
- **Dependency analysis** - Find unused imports, circular dependencies
- **Code metrics** - Complexity, coupling, cohesion metrics
- **Quick fixes** - Common code fixes and suggestions
- **Symbol completion** - Auto-completion for partial symbol names
- **Project templates** - Generate boilerplate code structures

## Success Criteria

The completed project should:
1. Successfully start as an MCP server
2. Initialize analysis for real Java projects (Maven/Gradle)
3. Provide accurate call and type hierarchies
4. Find references across project files
5. Handle errors gracefully without crashing
6. Integrate smoothly with Claude Desktop
7. Process requests within reasonable time limits (<5 seconds for most operations)

Please implement this step by step, ensuring each component works before moving to the next. Test with a real Java project to validate functionality.
