#!/bin/bash

# Launch Eclipse JDT Language Server
JDTLS_HOME="$(dirname "$0")/eclipse-jdtls"

# Find the launcher JAR
LAUNCHER=$(ls "$JDTLS_HOME"/plugins/org.eclipse.equinox.launcher_*.jar)

# Workspace location (will be created if doesn't exist)
WORKSPACE="${1:-/tmp/jdtls-workspace}"
PROJECT_PATH="${2:-$(pwd)}"

# Platform-specific config
case "$(uname)" in
    Darwin*)
        CONFIG="$JDTLS_HOME/config_mac"
        ;;
    Linux*)
        CONFIG="$JDTLS_HOME/config_linux"
        ;;
    *)
        CONFIG="$JDTLS_HOME/config_win"
        ;;
esac

echo "Starting Eclipse JDT.LS..."
echo "Workspace: $WORKSPACE"
echo "Project: $PROJECT_PATH"

# Start the language server
java \
    -Declipse.application=org.eclipse.jdt.ls.core.id1 \
    -Dosgi.bundles.defaultStartLevel=4 \
    -Declipse.product=org.eclipse.jdt.ls.core.product \
    -Dlog.level=ALL \
    -Xmx2G \
    -jar "$LAUNCHER" \
    -configuration "$CONFIG" \
    -data "$WORKSPACE" \
    --add-modules=ALL-SYSTEM \
    --add-opens java.base/java.util=ALL-UNNAMED \
    --add-opens java.base/java.lang=ALL-UNNAMED
