# Java MCP Server Usage Examples

This document provides practical examples of using the Java MCP Server tools with Claude Desktop.

## Basic Usage

### 1. Getting Class Information

Ask Claude to analyze a specific class:
```
"Can you show me the structure of the StockPosition class?"
```

Claude will use `get_class_info` to retrieve:
- Class modifiers and annotations
- Fields with types and annotations
- Methods with signatures
- Inheritance hierarchy

### 2. Finding All Classes in a Project

```
"List all the entity classes in this project"
```

Claude will use `list_classes` to enumerate all classes, then filter for entities.

### 3. Understanding Call Hierarchies

```
"What methods call the calculateTotal() method?"
```

Claude will use `get_call_hierarchy` with direction "incoming" to find all callers.

```
"What methods does processOrder() call?"
```

Claude will use `get_call_hierarchy` with direction "outgoing" to trace the call flow.

## Advanced Analysis

### 4. Type Hierarchy Exploration

```
"Show me all classes that extend BaseEntity"
```

Claude will use `get_type_hierarchy` to map inheritance relationships.

### 5. Finding Symbol References

```
"Where is the userId field used in the codebase?"
```

Claude will use `find_references` to locate all usages across the project.

### 6. Code Intelligence

```
"What does the @Transactional annotation do on this method?"
```

Claude will use `get_hover_info` to provide detailed documentation.

## Refactoring Operations

### 7. Renaming Symbols

```
"Rename the calculateTotal method to computeTotalAmount across the entire project"
```

Claude will use `rename_symbol` to perform project-wide renaming with:
- All references updated
- Import statements adjusted
- Documentation comments updated

### 8. Code Formatting

```
"Format the PaymentService class according to project standards"
```

Claude will use `format_code` to apply consistent formatting.

## Code Quality

### 9. Diagnostics and Issues

```
"Check for any issues in the OrderController class"
```

Claude will use `get_diagnostics` to identify:
- Compilation errors
- Warning conditions
- Code quality issues

### 10. Code Completion

```
"What methods are available on the userRepository object?"
```

Claude will use `get_completion` to suggest available methods and properties.

## Complex Workflows

### 11. Comprehensive Class Analysis

```
"Analyze the security implications of the UserController class"
```

Claude will combine multiple tools:
1. `get_class_info` - understand the class structure
2. `get_call_hierarchy` - trace data flow
3. `find_references` - locate all usages
4. `get_diagnostics` - check for issues

### 12. Refactoring with Validation

```
"Refactor the Payment class to use BigDecimal instead of double for amounts"
```

Claude will:
1. Use `get_class_info` to understand current structure
2. Use `find_references` to locate all usages
3. Apply changes systematically
4. Use `get_diagnostics` to verify no issues introduced

### 13. Project-Wide Analysis

```
"Find all REST endpoints in the application"
```

Claude will:
1. Use `list_classes` to find all controllers
2. Use `get_class_info` on each to identify @RequestMapping annotations
3. Compile a comprehensive endpoint list

## Working with Large Projects

### 14. Gradle Multi-Module Projects

For projects with multiple modules:
```
"Analyze the dependencies between the service and repository modules"
```

The server automatically detects the project root via `settings.gradle` and indexes all modules.

### 15. Performance Considerations

For large projects (10,000+ classes):
- Initial indexing may take 30-60 seconds
- Subsequent operations are fast due to caching
- The server handles indexing asynchronously to prevent timeouts

## Error Handling

### 16. Handling Compilation Errors

```
"The project has compilation errors. Can you identify and fix them?"
```

Claude will:
1. Use `get_diagnostics` to identify all errors
2. Analyze error messages and locations
3. Suggest or implement fixes
4. Re-validate with `get_diagnostics`

## Tips for Best Results

1. **Be Specific**: Provide class names, method names, or package names when possible
2. **Context Matters**: Mention the project type (Spring Boot, Android, etc.) for better analysis
3. **Iterative Refinement**: Start with broad queries, then narrow down
4. **Combine Tools**: Complex tasks often benefit from multiple tool invocations

## Integration with Development Workflow

The Java MCP Server integrates seamlessly with your development workflow:

1. **Code Review**: Analyze code changes before committing
2. **Refactoring**: Safely rename and restructure code
3. **Documentation**: Generate documentation from code analysis
4. **Bug Investigation**: Trace issues through call hierarchies
5. **Learning**: Understand unfamiliar codebases quickly

## Example Conversation

```
User: "I need to add a new field 'discount' to all order-related classes"

Claude: Let me help you add a discount field to order-related classes.
[Uses list_classes to find order-related classes]
[Uses get_class_info on each to understand structure]
[Suggests where to add the field]
[Uses find_references to ensure all usages are updated]

User: "Can you also update the calculateTotal method to account for the discount?"

Claude: I'll update the calculateTotal method to include discount calculation.
[Uses get_call_hierarchy to understand the calculation flow]
[Modifies the implementation]
[Uses get_diagnostics to verify no issues]
```

This natural interaction demonstrates how the MCP server enables Claude to perform complex Java development tasks efficiently.