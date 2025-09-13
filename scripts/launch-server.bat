@echo off
REM Java MCP Server Launch Script for Windows
REM This script launches the Java MCP Server with proper configuration

setlocal enabledelayedexpansion

REM Get the directory of this script
set SCRIPT_DIR=%~dp0
set PROJECT_DIR=%SCRIPT_DIR:~0,-9%

REM Colors for output (Windows 10+ with ANSI support)
set "RED=[91m"
set "GREEN=[92m"
set "YELLOW=[93m"
set "NC=[0m"

echo %GREEN%[INFO]%NC% Java MCP Server Launcher
echo %GREEN%[INFO]%NC% Project directory: %PROJECT_DIR%

REM Check Java version
java -version >nul 2>&1
if errorlevel 1 (
    echo %RED%[ERROR]%NC% Java is not installed or not in PATH
    exit /b 1
)

REM Get Java version
for /f tokens^=3 %%i in ('java -version 2^>^&1 ^| findstr /i version') do (
    set JAVA_VERSION=%%i
    set JAVA_VERSION=!JAVA_VERSION:"=!
)

REM Extract major version
for /f "tokens=1 delims=." %%a in ("%JAVA_VERSION%") do set JAVA_MAJOR=%%a
if %JAVA_MAJOR% LSS 17 (
    echo %RED%[ERROR]%NC% Java 17 or higher is required. Current version: %JAVA_VERSION%
    exit /b 1
)

echo %GREEN%[INFO]%NC% Using Java version: %JAVA_VERSION%

REM Check Maven
mvn -version >nul 2>&1
if errorlevel 1 (
    echo %RED%[ERROR]%NC% Maven is not installed or not in PATH
    exit /b 1
)

for /f "tokens=3" %%i in ('mvn -version 2^>^&1 ^| findstr "Apache Maven"') do (
    set MAVEN_VERSION=%%i
)
echo %GREEN%[INFO]%NC% Using Maven version: %MAVEN_VERSION%

REM Define JAR file path
set JAR_FILE=%PROJECT_DIR%target\java-mcp-server-1.0.0.jar

REM Build if needed
if not exist "%JAR_FILE%" (
    echo %GREEN%[INFO]%NC% JAR file not found. Building project...
    call :build_project
) else (
    echo %GREEN%[INFO]%NC% JAR file found.
)

REM Launch the server
if not exist "%JAR_FILE%" (
    echo %RED%[ERROR]%NC% JAR file not found: %JAR_FILE%
    exit /b 1
)

echo %GREEN%[INFO]%NC% Starting Java MCP Server...

REM Set Eclipse-specific system properties
set ECLIPSE_PROPS=-Dosgi.requiredJavaVersion=17 -Dosgi.instance.area.default=@user.home/eclipse-workspace -Dfile.encoding=UTF-8 -Declipse.p2.max.threads=10 -Declipse.p2.force.threading=true

REM JVM options
set JVM_OPTS=-Xmx2G -Xms512M -XX:+UseG1GC -XX:+UseStringDeduplication -Djava.awt.headless=true

REM Launch the server with all options
java %JVM_OPTS% %ECLIPSE_PROPS% -jar "%JAR_FILE%" %*

goto :eof

:build_project
echo %GREEN%[INFO]%NC% Building Java MCP Server...
cd /d "%PROJECT_DIR%"

call mvn clean package -q
if errorlevel 1 (
    echo %RED%[ERROR]%NC% Build failed. Please check the error messages above.
    exit /b 1
)

echo %GREEN%[INFO]%NC% Build completed successfully.
goto :eof