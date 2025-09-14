import java.nio.file.*;
import java.util.*;

public class TestBasicMode {
    public static void main(String[] args) throws Exception {
        String projectPath = "/Users/mwgreen/git-repos/frazier-life-sciences";
        Path root = Paths.get(projectPath);
        
        System.out.println("Scanning for .java files in: " + projectPath);
        
        List<Path> javaFiles = new ArrayList<>();
        Files.walk(root)
            .filter(path -> path.toString().endsWith(".java"))
            .forEach(javaFiles::add);
        
        System.out.println("Found " + javaFiles.size() + " Java files");
        
        // Check for StockPosition
        for (Path p : javaFiles) {
            if (p.toString().contains("StockPosition")) {
                System.out.println("Found StockPosition at: " + p);
                
                // Check if we can read it
                String content = new String(Files.readAllBytes(p));
                if (content.contains("package com.frazierlifesciences.entity")) {
                    System.out.println("  - Package is correct");
                }
                if (content.contains("public class StockPosition")) {
                    System.out.println("  - Class declaration found");
                }
            }
        }
    }
}
