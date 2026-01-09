# Release Notes - v2.0.0

## 🎉 AI Knowledge Assistant v2.0.0 - Major Code Refactoring and Bug Fixes

**Release Date**: January 10, 2026

This is a major release featuring comprehensive code refactoring, critical bug fixes, and architectural improvements that significantly enhance code quality, maintainability, and security.

---

## 🌟 Highlights

- 🐛 **Fixed 7 critical bugs** including memory leaks, security vulnerabilities, and stability issues
- 🛠️ **Created 6 new utility classes** for better code organization and reusability
- 📦 **Added 1,210 lines** of high-quality, maintainable code
- 🔥 **Removed ~300 lines** of duplicate code
- 🔒 **Enhanced security** with input validation and CORS improvements
- ⚡ **Improved performance** with better caching and timeout controls

---

## 🐛 Critical Bug Fixes

### 1. Memory Leak - Pending Searches
**Severity**: 🔴 Critical

Fixed infinite growth of `pendingSearches` Map that could cause memory exhaustion over time.

**Solution**:
- Added maximum limit of 1,000 concurrent searches
- Implemented 30-second timeout cleanup mechanism
- Automatic cleanup of stale search requests

### 2. Regular Expression Injection
**Severity**: 🔴 Critical

Fixed vulnerability where user-supplied SN values were directly interpolated into regex patterns without escaping.

**Solution**:
- Added `escapeRegexString` utility function
- All user inputs are now properly escaped before regex usage
- Prevents potential regex DoS attacks

### 3. Uncaught Async Errors
**Severity**: 🔴 Critical

File upload background processing failures were not properly handled, leaving documents in "processing" state indefinitely.

**Solution**:
- Improved error handling with defensive state updates
- Frontend notification of processing failures
- Proper error recovery mechanisms

### 4. File Size Overflow
**Severity**: 🟠 High

No limit on text extraction size could cause memory overflow with very large files.

**Solution**:
- Added 100MB text size limit
- Clear error messages for oversized files
- Prevents server memory exhaustion

### 5. CSV Parsing Boundary Issues
**Severity**: 🟠 High

CSV parsing could access undefined array indices causing crashes.

**Solution**:
- Added column count validation
- Safe access using optional chaining
- Graceful handling of malformed CSV data

### 6. WebSocket Connection Leak
**Severity**: 🟠 High

Zombie WebSocket connections were never cleaned up, accumulating over time.

**Solution**:
- Implemented heartbeat detection (30-second interval)
- Automatic termination of unresponsive connections
- Connection count monitoring

### 7. CORS Security
**Severity**: 🟠 High

CORS configuration allowed requests without Origin header and had hardcoded IP addresses.

**Solution**:
- Stricter CORS policy requiring explicit configuration
- Removed hardcoded IP addresses
- Environment variable control for security settings

---

## ✨ New Features

### Configuration Management (`server/constants.mjs`)

Centralized configuration for all magic numbers and constants:

```javascript
export const LIMITS = {
  MAX_CHUNK_SIZE: 4000,
  MAX_TEXT_SIZE: 100 * 1024 * 1024,
  SEARCH_TIMEOUT_MS: 30000,
  // ...
};

export const CACHE = {
  SEARCH_CACHE_SIZE: 200,
  SEMANTIC_CACHE_SIZE: 100,
  SEMANTIC_CACHE_THRESHOLD: 0.95
};

export const SCORING = {
  RRF_K: 60,
  RERANK_TOPN: 10,
  // ...
};
```

### API Response Utilities (`server/utils/apiResponse.mjs`)

Standardized API response handling:

```javascript
// Success response
ApiResponse.success(res, { data: results });

// Error responses
ApiResponse.badRequest(res, 'query parameter');
ApiResponse.notFound(res, 'Document');
ApiResponse.internalError(res, 'Processing failed');

// Async error handling
app.get('/api/example', asyncHandler(async (req, res) => {
  // Errors automatically caught and handled
}));
```

### File Processing Utilities (`server/utils/fileExtractor.mjs`)

Unified file content extraction:

```javascript
// Single interface for all file types
const text = await extractFileContent(
  buffer,
  'pdf',  // or 'word', 'excel', 'text'
  { pdfParseModule }
);

// Eliminates 200+ lines of duplicate code
```

### Tree Traversal Utilities (`server/utils/treeUtils.mjs`)

Generic tree operations:

```javascript
// Find nodes
const node = findById(tree, 'node-id');
const node = findByName(tree, 'Node Name');
const nodes = findAllInTree(tree, node => node.active);

// Traverse and transform
traverseTree(tree, (node, depth, parent) => {
  console.log(`${node.name} at depth ${depth}`);
});

const flat = flattenTree(tree);
const path = getNodePath(tree, node => node.id === 'target');
```

### Search Pipeline (`server/utils/searchPipeline.mjs`)

Modular search architecture:

```javascript
const pipeline = new SearchPipeline({
  storage,
  embedText,
  rerankDocuments,
  // ...
});

const result = await pipeline.execute(query, {
  cacheKey,
  searchLimit: 30,
  categoryIds: ['cat1', 'cat2']
});

// Returns: { results, cached, duration, variantCount }
```

---

## 📊 Statistics

| Metric | Value |
|--------|-------|
| **Commits** | 5 |
| **Files Added** | 8 |
| **Lines Added** | 1,210 |
| **Lines Optimized** | 263 |
| **Duplicate Code Removed** | ~300 lines |
| **Bugs Fixed** | 7 critical issues |
| **New Utility Classes** | 6 |

---

## 🔧 Technical Improvements

### Code Quality
- ✅ Centralized configuration management
- ✅ Standardized API response formats
- ✅ Eliminated duplicate code
- ✅ Improved code readability
- ✅ Better separation of concerns

### Performance
- ✅ Optimized cache mechanisms
- ✅ Request deduplication
- ✅ Timeout controls
- ✅ Memory leak prevention

### Security
- ✅ Input validation and sanitization
- ✅ Regex injection prevention
- ✅ Stricter CORS configuration
- ✅ Better error handling

### Maintainability
- ✅ Modular architecture
- ✅ Reusable utility classes
- ✅ Clear code organization
- ✅ Comprehensive documentation

---

## 🚀 Upgrade Guide

This release is **backward compatible**. No migration steps required.

### Installation

```bash
git pull origin main
npm install  # If dependencies changed
npm start
```

### Optional: Use New Utilities

You can optionally refactor your custom code to use the new utilities:

```javascript
// Before
const maxSize = 4000;
if (text.length > 100 * 1024 * 1024) { ... }

// After
import { LIMITS } from './server/constants.mjs';
if (text.length > LIMITS.MAX_TEXT_SIZE) { ... }
```

---

## 📝 Breaking Changes

**None** - This release is fully backward compatible.

---

## 🔮 Future Roadmap

### Planned for v2.1.0
- ⏳ Apply SearchPipeline to search endpoints
- ⏳ Merge 4 topology API endpoints (reduce 1,000+ lines)
- ⏳ Create frontend API client
- ⏳ Enable TypeScript strict mode

---

## 📚 Documentation

- [CHANGELOG.md](./CHANGELOG.md) - Detailed change log
- [README.md](./README.md) - Project documentation

---

## 🙏 Acknowledgments

Special thanks to the comprehensive code analysis and systematic refactoring that made this release possible.

---

## 📦 Full Changelog

See [CHANGELOG.md](./CHANGELOG.md) for complete details.

---

**Download**: [v2.0.0](https://github.com/zhangdailin/AI_Knowledge_Assistant_FOR_NVIDIA_NETWORK_PRODUCT/releases/tag/v2.0.0)

**Questions?** Open an issue on [GitHub](https://github.com/zhangdailin/AI_Knowledge_Assistant_FOR_NVIDIA_NETWORK_PRODUCT/issues)
