# Topology API Refactoring Analysis

**Date**: January 10, 2026
**Status**: Analysis Complete - Ready for Implementation
**Estimated Impact**: ~200-250 lines of duplicate code elimination

---

## Executive Summary

Analysis of 4 topology API endpoints reveals significant code duplication (~200-250 lines) that can be eliminated through refactoring. A design document already exists in `server/utils/topologyHandler.mjs` providing the blueprint for consolidation.

**Key Metrics**:
- **Endpoints Analyzed**: 4
- **Total Lines**: ~360 lines
- **Duplicate Code**: ~200-250 lines (55-70%)
- **Potential Reduction**: Similar to SearchPipeline (50% reduction achieved)

---

## Analyzed Endpoints

### 1. `/api/topology-restore` (lines 2289-2346, 58 lines)
**Purpose**: Basic topology restoration from uploaded files
**Network Types**: IB (InfiniBand), RoCE (RDMA over Converged Ethernet)

### 2. `/api/topology-restore-v2` (lines 2349-2522, 174 lines)
**Purpose**: Streaming topology restoration with NDJSON response
**Features**: Lazy loading, automatic render mode selection, chunked data transmission

### 3. `/api/topology-pod-details` (lines 2525-2585, 61 lines)
**Purpose**: Retrieve detailed information for specific POD
**Features**: POD-specific node and edge filtering

### 4. `/api/topology-search` (lines 2587-2653, 67 lines)
**Purpose**: Search topology nodes by query string
**Features**: Deep search across all layers, result limiting

---

## Duplicate Code Patterns

### Pattern 1: File Validation (4/4 endpoints)
```javascript
// Identical in all endpoints
if (!req.file) {
  return res.status(400).json({ ok: false, error: '请上传文件' });
}
// or
if (!req.file) return res.status(400).json({ ok: false, error: 'file required' });
```

**Duplication**: 4 instances
**Lines**: ~8 lines total

---

### Pattern 2: Parameter Extraction (4/4 endpoints)
```javascript
// Identical in all endpoints
const networkType = req.body.networkType || 'ib';
const configStr = req.body.config;
const config = configStr ? JSON.parse(configStr) : {};
const fileBuffer = req.file.buffer;
const fileName = req.file.originalname; // or originalName
```

**Duplication**: 4 instances
**Lines**: ~20 lines total

---

### Pattern 3: File Parsing (4/4 endpoints)
```javascript
// Identical in all endpoints
const input = parseTopologyUpload(fileBuffer, fileName);
```

**Duplication**: 4 instances
**Lines**: ~4 lines total
**Note**: `parseTopologyUpload()` function itself is defined once (lines 2663-2677, 15 lines)

---

### Pattern 4: PortMap Building (4/4 endpoints)
```javascript
// Identical logic in all endpoints
if (networkType === 'ib') {
  if (input.kind === 'csv') {
    portMap = parseCSVPortMap(input.csvContent);
  } else {
    portMap = parseExcelPortMap(input.data);
  }
} else if (networkType === 'roce') {
  if (input.kind === 'excel') {
    result = analyzeRoCETopology(input.data);
  } else {
    portMap = parseCSVPortMap(input.csvContent);
  }
}
```

**Duplication**: 4 instances
**Lines**: ~60 lines total (15 lines × 4)

---

### Pattern 5: Topology Construction (4/4 endpoints)
```javascript
// Identical in all endpoints
result = topology.buildTopologyStructure(portMap, {
  layerDetection: config.layerDetection || 'auto',
  manualLayers: config.manualLayers || null,
  podExtraction: config.podExtraction || { method: 'regex', pattern: 'POD\\d+' },
  networkType: networkType
});
```

**Duplication**: 4 instances
**Lines**: ~28 lines total (7 lines × 4)

---

### Pattern 6: Error Handling (4/4 endpoints)
```javascript
// Identical in all endpoints
if (!result || !result.success) {
  throw new Error('拓扑构建失败：' + (result?.error || '未知错误'));
}
// or
if (!result || !result.success) throw new Error('Build failed');
```

**Duplication**: 4 instances
**Lines**: ~12 lines total

---

### Pattern 7: Try-Catch Error Handling (4/4 endpoints)
```javascript
// Identical structure in all endpoints
try {
  // ... endpoint logic
} catch (error) {
  console.error('[EndpointName] Error:', error);
  res.status(500).json({ ok: false, error: error.message });
}
```

**Duplication**: 4 instances
**Lines**: ~20 lines total

---

## Total Duplication Summary

| Pattern | Instances | Lines per Instance | Total Lines |
|---------|-----------|-------------------|-------------|
| File Validation | 4 | 2 | 8 |
| Parameter Extraction | 4 | 5 | 20 |
| File Parsing | 4 | 1 | 4 |
| PortMap Building | 4 | 15 | 60 |
| Topology Construction | 4 | 7 | 28 |
| Error Handling | 4 | 3 | 12 |
| Try-Catch Structure | 4 | 5 | 20 |
| **TOTAL** | **28** | **38** | **152** |

**Additional Duplication**:
- Helper functions defined inline: ~50-100 lines
- Response formatting logic: ~20-30 lines

**Estimated Total Duplicate Code**: **200-250 lines**

---

## Existing Design Document

A design document already exists at `server/utils/topologyHandler.mjs` (136 lines) with:

### Proposed Architecture
```javascript
export async function handleTopologyOperation(operation, file, params = {}) {
  switch (operation) {
    case 'restore':
      return await handleTopologyRestore(file, params);
    case 'restore-v2':
      return await handleTopologyRestoreV2(file, params);
    case 'pod-details':
      return await handlePodDetails(file, params);
    case 'search':
      return await handleTopologySearch(file, params);
    default:
      throw new Error(`Unknown topology operation: ${operation}`);
  }
}
```

### Proposed Unified Endpoint
```javascript
app.post('/api/topology/:operation', upload.single('file'), async (req, res) => {
  try {
    const { operation } = req.params;
    const file = req.file;
    const params = { ...req.body, ...req.query };

    const result = await handleTopologyOperation(operation, file, params);
    ApiResponse.success(res, result);
  } catch (error) {
    console.error(`[Topology] ${operation} 失败:`, error);
    ApiResponse.internalError(res, error.message);
  }
});
```

**Benefit**: Reduces 4 endpoints (~360 lines) to 1 endpoint (~30 lines) + utility class

---

## Refactoring Strategy

### Phase 1: Extract Common Functions
1. **File Validation**: `validateTopologyFile(req.file)`
2. **Parameter Extraction**: `extractTopologyParams(req.body, req.file)`
3. **File Parsing**: Already exists as `parseTopologyUpload()`
4. **PortMap Building**: `buildPortMap(input, networkType)`
5. **Topology Construction**: `constructTopology(portMap, config, networkType)`
6. **Error Handling**: Use existing `ApiResponse` utility

### Phase 2: Implement Operation Handlers
1. `handleTopologyRestore()` - Basic restoration
2. `handleTopologyRestoreV2()` - Streaming with lazy loading
3. `handlePodDetails()` - POD-specific filtering
4. `handleTopologySearch()` - Search functionality

### Phase 3: Create Unified Endpoint
1. Replace 4 separate endpoints with single parameterized endpoint
2. Route to appropriate handler based on operation parameter
3. Maintain backward compatibility with existing API contracts

### Phase 4: Testing
1. Test each operation type independently
2. Verify all network types (IB, RoCE)
3. Test file formats (CSV, Excel)
4. Validate streaming behavior (restore-v2)
5. Test POD filtering and search functionality

### Phase 5: Documentation
1. Update CHANGELOG.md
2. Update RELEASE_NOTES.md
3. Document API changes (if any)
4. Update code comments

---

## Expected Benefits

### Code Quality
- ✅ Eliminate 200-250 lines of duplicate code
- ✅ Centralize topology processing logic
- ✅ Improve maintainability
- ✅ Reduce bug surface area

### Performance
- ✅ No performance impact (same logic, better organization)
- ✅ Easier to optimize common paths

### Maintainability
- ✅ Single source of truth for topology processing
- ✅ Easier to add new operations
- ✅ Consistent error handling
- ✅ Simplified testing

---

## Comparison with SearchPipeline Refactoring

| Metric | SearchPipeline | Topology (Estimated) |
|--------|---------------|---------------------|
| Endpoints Affected | 1 | 4 |
| Original Lines | 230 | 360 |
| Duplicate Lines | 150 | 200-250 |
| Code Reduction | 50% | 55-70% |
| Testing Phases | 8 | 5 (estimated) |
| Implementation Time | Completed | Not started |

---

## Implementation Checklist

### Prerequisites
- [x] Analysis completed
- [x] Design document exists
- [x] Duplicate patterns identified
- [ ] User approval obtained

### Implementation
- [ ] Extract common functions to `topologyHandler.mjs`
- [ ] Implement operation handlers
- [ ] Create unified endpoint
- [ ] Remove old endpoints
- [ ] Update imports and dependencies

### Testing
- [ ] Unit tests for common functions
- [ ] Integration tests for each operation
- [ ] Test all network types (IB, RoCE)
- [ ] Test all file formats (CSV, Excel)
- [ ] Verify streaming behavior
- [ ] Test POD filtering
- [ ] Test search functionality

### Documentation
- [ ] Update CHANGELOG.md
- [ ] Update RELEASE_NOTES.md
- [ ] Update API documentation
- [ ] Add code comments
- [ ] Update README if needed

---

## Risks and Mitigation

### Risk 1: Breaking Changes
**Mitigation**: Maintain backward compatibility by keeping same API contracts

### Risk 2: Streaming Behavior Changes
**Mitigation**: Thoroughly test restore-v2 streaming functionality

### Risk 3: Performance Regression
**Mitigation**: Benchmark before and after refactoring

### Risk 4: Edge Cases
**Mitigation**: Comprehensive testing with various file formats and network types

---

## Next Steps

1. **Obtain User Approval**: Confirm user wants to proceed with topology refactoring
2. **Begin Implementation**: Start with Phase 1 (Extract Common Functions)
3. **Incremental Testing**: Test after each phase
4. **Documentation**: Update docs as implementation progresses
5. **Final Verification**: Comprehensive testing before marking complete

---

## References

- **Design Document**: `server/utils/topologyHandler.mjs`
- **Endpoint 1**: `server/index.mjs:2289-2346`
- **Endpoint 2**: `server/index.mjs:2349-2522`
- **Endpoint 3**: `server/index.mjs:2525-2585`
- **Endpoint 4**: `server/index.mjs:2587-2653`
- **Helper Functions**: `server/index.mjs:2655-2906`
- **SearchPipeline Example**: `server/utils/searchPipeline.mjs`

---

**Analysis Completed By**: Claude Sonnet 4.5
**Date**: January 10, 2026
**Status**: ✅ Ready for Implementation
