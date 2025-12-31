#!/bin/bash

# Add import to Dashboard.tsx
sed -i '10a import { getApiServerUrl } from '"'"'../utils/apiUtils'"'"';' src/components/Dashboard.tsx

# Add import to RetrievalSettings.tsx  
sed -i '3a import { getApiServerUrl } from '"'"'../utils/apiUtils'"'"';' src/components/RetrievalSettings.tsx

# Add import to serverStorage.ts
sed -i '6a import { getApiServerUrl } from '"'"'../utils/apiUtils'"'"';' src/lib/serverStorage.ts

# Add import to chatStore.ts
sed -i '4a import { getApiServerUrl } from '"'"'../utils/apiUtils'"'"';' src/stores/chatStore.ts

# Add import to nvidia-doc-pdf
sed -i '3a import { getApiServerUrl } from '"'"'../../utils/apiUtils'"'"';' src/plugins/nvidia-doc-pdf/index.tsx

# Add import to sn-address
sed -i '3a import { getApiServerUrl } from '"'"'../../utils/apiUtils'"'"';' src/plugins/sn-address/index.tsx

# Add import to sn-iblf
sed -i '3a import { getApiServerUrl } from '"'"'../../utils/apiUtils'"'"';' src/plugins/sn-iblf/index.tsx

# Add import to sn-topology
sed -i '14a import { getApiServerUrl } from '"'"'../../utils/apiUtils'"'"';' src/plugins/sn-topology/index.tsx

# Add import to topology-restore
sed -i '18a import { getApiServerUrl } from '"'"'../../utils/apiUtils'"'"';' src/plugins/topology-restore/index.tsx

echo "Imports added!"
