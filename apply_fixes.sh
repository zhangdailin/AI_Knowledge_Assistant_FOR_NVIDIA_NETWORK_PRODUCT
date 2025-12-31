#!/bin/bash

# Function to fix a file
fix_file() {
    local file=$1
    local import_path=$2
    
    echo "Fixing $file..."
    
    # Create a temporary file
    temp_file=$(mktemp)
    
    # Read the file and apply fixes
    awk -v import_path="$import_path" '
    BEGIN { in_function = 0; skip_lines = 0; import_added = 0 }
    
    # Detect start of getApiServerUrl function
    /^function getApiServerUrl\(\): string \{$/ {
        in_function = 1
        skip_lines = 1
        next
    }
    
    # Skip lines inside the function
    in_function == 1 {
        if (/^\}$/) {
            in_function = 0
            skip_lines = 0
            next
        }
        next
    }
    
    # Add import after other imports
    /^import.*from/ && import_added == 0 {
        print
        if (getline next_line > 0) {
            if (next_line !~ /^import/) {
                print "import { getApiServerUrl } from \"" import_path "\";"
                print next_line
                import_added = 1
            } else {
                print next_line
            }
        }
        next
    }
    
    # Print all other lines
    skip_lines == 0 { print }
    ' "$file" > "$temp_file"
    
    # Replace original file
    mv "$temp_file" "$file"
    echo "✓ Fixed $file"
}

# Fix each file
fix_file "src/components/Dashboard.tsx" "../utils/apiUtils"
fix_file "src/components/RetrievalSettings.tsx" "../utils/apiUtils"
fix_file "src/lib/serverStorage.ts" "../utils/apiUtils"
fix_file "src/stores/chatStore.ts" "../utils/apiUtils"
fix_file "src/plugins/nvidia-doc-pdf/index.tsx" "../../utils/apiUtils"
fix_file "src/plugins/sn-address/index.tsx" "../../utils/apiUtils"
fix_file "src/plugins/sn-iblf/index.tsx" "../../utils/apiUtils"
fix_file "src/plugins/sn-topology/index.tsx" "../../utils/apiUtils"
fix_file "src/plugins/topology-restore/index.tsx" "../../utils/apiUtils"

echo ""
echo "All fixes applied!"
