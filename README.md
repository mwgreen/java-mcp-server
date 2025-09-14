# Java MCP Server with Eclipse JDT Language Server

A Model Context Protocol (MCP) server that provides comprehensive Java code analysis capabilities through Eclipse JDT Language Server integration. This server enables AI assistants like Claude to perform advanced Java code operations including call hierarchies, type hierarchies, refactoring, and more.

## Features

The server provides 11 powerful tools for Java code analysis:

### Code Navigation
- **get_class_info**: Retrieve detailed information about Java classes
- **list_classes**: List all classes in the project
- **find_references**: Find all references to a symbol
- **get_call_hierarchy**: Analyze incoming and outgoing method calls
- **get_type_hierarchy**: Explore class inheritance relationships

### Code Intelligence
- **get_hover_info**: Get detailed information about symbols
- **get_completion**: Get code completion suggestions
- **get_definition**: Navigate to symbol definitions

### Refactoring
- **rename_symbol**: Rename classes, methods, and variables across the project
- **format_code**: Format Java code according to project standards

### Diagnostics
- **get_diagnostics**: Analyze code for errors and warnings

## Installation

### Prerequisites
- Node.js 18 or higher
- Java 17 or higher
- Git

### Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/java-mcp-server.git
cd java-mcp-server
```

2. Install Eclipse JDT Language Server:
```bash
./setup-jdtls.sh
```
This downloads and extracts the Eclipse JDT.LS (approximately 44MB).

3. Build the Java components:
```bash
mvn clean package
```

## Usage

### With Claude Desktop

1. Add the server to your Claude configuration:
```bash
claude mcp add java-analyzer -s local -- /path/to/java-mcp-server/java-mcp-jdtls.js
```

2. Restart Claude Desktop to load the server.

3. The server will automatically initialize when you start analyzing Java projects.

### Direct Usage

Run the server directly for testing:
```bash
./java-mcp-jdtls.js
```

The server communicates via JSON-RPC over stdin/stdout following the MCP protocol.

## Architecture

The server consists of three main components:

### 1. Node.js Bridge (`java-mcp-jdtls.js`)
- Implements the MCP protocol
- Manages Eclipse JDT.LS lifecycle
- Translates between MCP and Language Server Protocol (LSP)

### 2. Eclipse JDT Language Server
- Provides full Java language intelligence
- Handles project indexing and analysis
- Supports Gradle and Maven projects

### 3. Java MCP Server (`src/main/java/com/example/JavaMCPServer.java`)
- Fallback implementation for standalone operation
- Direct AST analysis capabilities
- Lightweight alternative for simple operations

## Project Structure

```
java-mcp-server/
├── java-mcp-jdtls.js       # Main MCP bridge to JDT.LS
├── java-mcp-server         # Executable wrapper script
├── setup-jdtls.sh          # JDT.LS installation script
├── src/                    # Java source code
│   └── main/
│       └── java/
│           └── com/example/
│               ├── JavaMCPServer.java         # Standalone Java server
│               ├── JavaProjectAnalyzer.java   # Project analysis utilities
│               └── CallHierarchyAnalyzer.java # Call hierarchy analysis
├── pom.xml                 # Maven configuration
└── archive/                # Test files and old implementations
```

## How It Works

1. **Initialization**: When the server starts, it launches Eclipse JDT.LS as a subprocess and establishes LSP communication.

2. **Project Detection**: The server automatically detects the project root by looking for:
   - `settings.gradle` or `settings.gradle.kts` (for multi-module Gradle projects)
   - `build.gradle` or `build.gradle.kts` (for single-module Gradle projects)
   - `pom.xml` (for Maven projects)

3. **Project Indexing**: JDT.LS indexes the project, which may take 30-60 seconds for large projects. The server handles this asynchronously to prevent timeouts.

4. **Tool Execution**: When tools are called via MCP, the bridge translates requests to LSP calls and formats responses according to MCP specifications.

## Configuration

The server uses sensible defaults but can be configured through environment variables:

- `JAVA_HOME`: Path to Java installation (auto-detected if not set)
- `JDTLS_HOME`: Path to JDT.LS installation (defaults to `./jdtls`)

## Troubleshooting

### Server fails to start
- Ensure Java 17+ is installed: `java -version`
- Verify JDT.LS is installed: `ls -la jdtls/`
- Check Node.js version: `node --version` (should be 18+)

### Project not fully indexed
- Large projects may take 30-60 seconds to index
- Check for `settings.gradle` in multi-module projects
- Ensure Gradle wrapper is present (`gradlew` file)

### Tools return empty results
- Wait for indexing to complete after initialization
- Verify the project compiles successfully
- Check that source paths are correctly configured

## Development

### Running Tests
```bash
# Run Java tests
mvn test

# Test the MCP server
node java-mcp-jdtls.js < test-requests.json
```

### Adding New Tools
1. Implement the LSP call in `java-mcp-jdtls.js`
2. Add tool definition to the `tools` array
3. Handle the tool in the `callTool` function

## License

MIT License - See LICENSE file for details

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- Eclipse JDT Language Server team for the excellent Java LSP implementation
- Anthropic for the Model Context Protocol specification
- The open-source Java community