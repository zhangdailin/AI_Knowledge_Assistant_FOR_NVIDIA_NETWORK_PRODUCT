# AI Knowledge Assistant (Gemini context)

This project is a sophisticated **RAG (Retrieval-Augmented Generation)** system tailored for network infrastructure management, specifically focused on NVIDIA/Cumulus Linux environments. It integrates a React-based frontend with a Node.js backend to provide an intelligent Q&A interface, document management, and specialized network tools.

## 🚀 Project Overview

- **Purpose**: To assist network engineers in querying technical documentation, managing device inventory, and visualizing network topology.
- **Core Architecture**:
  - **Frontend**: React 18 SPA built with Vite and TypeScript. Uses Tailwind CSS for styling and Zustand for state management.
  - **Backend**: Node.js Express server handling file processing, embedding generation, and vector search.
  - **Search Engine**: Hybrid retrieval combining keyword matching (with synonym expansion) and vector search (using cosine similarity), fused via Reciprocal Rank Fusion (RRF).
  - **AI Integration**: Supports multiple LLM providers, primarily SiliconFlow (Qwen models) and Gemini (with Google Search grounding).

## 🛠 Tech Stack

### Frontend
- **Framework**: React 18 + TypeScript
- **Styling**: Tailwind CSS + Radix UI + Lucide React
- **Visualization**: 
  - **React Flow**: For network topology diagrams.
  - **Recharts**: For dashboard analytics.
- **State Management**: Zustand
- **Routing**: React Router DOM v7

### Backend
- **Runtime**: Node.js (ESM)
- **Framework**: Express
- **Document Parsing**: 
  - `pdf-parse`: PDF processing.
  - `mammoth`: Word document extraction.
  - `xlsx`: Excel data parsing.
- **Storage**: Local filesystem-based JSON storage (optimized with document-specific chunking to prevent OOM).

## 📂 Key Directory Structure

- `/src`: Frontend source code.
  - `/components`: UI components (Chat, Admin, Knowledge Base, Tools).
  - `/lib`: Core business logic, intent detection, and retrieval enhancements.
  - `/stores`: Zustand stores for auth, chat, and tools.
- `/server`: Backend source code.
  - `index.mjs`: Main Express server.
  - `storage.mjs`: File-based data persistence logic.
  - `chunking.mjs`: Advanced parent-child text splitting.
  - `embedding.mjs`: Interface for text embedding generation.
- `/data`: Persistent data storage (JSON format).
- `/test`: Comprehensive test suite for retrieval accuracy and system integration.
- `/doc`: Project documentation, improvement logs, and quick start guides.

## ⚙️ Building and Running

### Development
```bash
# Install dependencies
npm install

# Start both frontend and backend concurrently
npm run server

# Start backend only
npm run server:backend
```

### Production
```bash
# Build the frontend
npm run build

# Preview the build
npm run preview
```

### Testing & Quality
```bash
# Run unit tests
npm run test

# Run retrieval precision benchmarks
npm run test:benchmark

# Linting
npm run lint
```

## 📝 Development Conventions

- **Module System**: Strictly uses ESM (`.mjs` files or `"type": "module"`).
- **Retrieval Strategy**: Employs a "Parent-Child" chunking strategy where small child chunks are used for vector matching while larger parent chunks provide context for the LLM.
- **Intent Awareness**: The system detects user intent (Command vs. Question vs. Troubleshooting) to adjust search weights and reranking logic.
- **Data Persistence**: Data is stored in `data/` using a flat JSON structure. Large `chunks.json` is split into per-document files (`data/chunks/doc-xxx.json`) for performance.
- **Network Specifics**: Contains specialized logic for NVIDIA/Cumulus commands (NVUE), SN-to-IBLF mapping, and topology discovery.

## 🔍 Key Files for Investigation

- `server/index.mjs`: Primary API definitions and search fusion logic.
- `server/storage.mjs`: Data access layer and search implementation.
- `src/lib/retrievalEnhancements.ts`: Logic for query expansion and intent detection.
- `src/App.tsx`: Main routing and application structure.
- `package.json`: Dependency map and scripts.
