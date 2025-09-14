#!/bin/bash

# Download and setup Eclipse JDT Language Server
# This provides FULL Eclipse Java analysis capabilities

JDTLS_VERSION="1.31.0"
JDTLS_DIR="./eclipse-jdtls"

echo "Setting up Eclipse JDT Language Server v${JDTLS_VERSION}..."

# Create directory
mkdir -p "$JDTLS_DIR"
cd "$JDTLS_DIR"

# Download URL for latest JDT.LS
DOWNLOAD_URL="https://download.eclipse.org/jdtls/milestones/${JDTLS_VERSION}/jdt-language-server-${JDTLS_VERSION}-202401111522.tar.gz"

# Alternative: Latest snapshot
# DOWNLOAD_URL="https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz"

if [ ! -f "plugins/org.eclipse.equinox.launcher_*.jar" ]; then
    echo "Downloading Eclipse JDT.LS..."
    curl -L "$DOWNLOAD_URL" -o jdtls.tar.gz

    echo "Extracting..."
    tar -xzf jdtls.tar.gz
    rm jdtls.tar.gz

    echo "Eclipse JDT.LS installed successfully!"
else
    echo "Eclipse JDT.LS already installed"
fi

# Create launcher script
cat > ../launch-jdtls.sh << 'EOF'
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
EOF

chmod +x ../launch-jdtls.sh

echo ""
echo "Setup complete! Eclipse JDT.LS is ready."
echo ""
echo "This provides:"
echo "  ✅ Full type hierarchy analysis"
echo "  ✅ Find all references across project"
echo "  ✅ Advanced refactoring (rename, extract, etc.)"
echo "  ✅ Code completion and suggestions"
echo "  ✅ Semantic analysis"
echo "  ✅ Call hierarchy with full depth"
echo ""
echo "To use: ./launch-jdtls.sh [workspace_path] [project_path]"