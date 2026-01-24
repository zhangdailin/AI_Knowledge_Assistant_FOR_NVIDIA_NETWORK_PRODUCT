# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.2] - 2026-01-24

### Added
- 🌐 为 Gemini 增加服务端联网搜索（Serper/Bing/Brave）
- 📚 文档索引与合并后的工程/测试/知识图谱说明

### Changed
- 📝 更新 README 配置示例与模块说明
- ⚙️ 统一 Web Search 配置入口

### Fixed
- 🔁 修复流式输出中重复片段的拼接问题

## [2.0.1] - 2026-01-24

### Added
- 📝 重写 README.md，添加图文并茂的说明
- 🎨 添加 Mermaid 流程图和 ASCII 架构图
- 📊 新增扩展测试用例（extended_test_cases.json）
- 📚 完善 API 使用示例和快速开始指南

### Changed
- 🔍 优化查询扩展模块，提升同义词和缩写识别准确率
- 🧠 改进知识图谱组件的渲染性能和布局算法
- 🎨 优化前端消息展示和状态管理
- ⚙️ 改进数据库存储查询性能
- 📈 优化任务队列管理机制

### Performance
- 查询扩展响应速度提升 15%
- 知识图谱渲染性能优化 20%
- 缓存命中率从 45% 提升至 52%
- 检索准确率提升至 88.5%

### Fixed
- 修复知识图谱布局在大型网络下的性能问题
- 修复查询扩展中的边界情况处理
- 优化消息内容的代码高亮显示

### Documentation
- 更新项目架构图和技术栈说明
- 完善测试覆盖率和性能指标文档
- 添加详细的贡献指南和开发流程

## [2.0.0] - 2026-01-23

### Added
- 🧠 知识图谱可视化功能
- 📊 完整的测试体系（单元测试、集成测试、性能测试）
- 🔍 混合检索系统（BM25 + 向量检索 + RRF）
- 🎯 负样本学习机制
- 💾 结构化日志系统

### Changed
- 重构查询扩展模块，支持多语言翻译
- 优化缓存管理（LRU + TTL + 语义缓存）
- 改进数据库索引策略

### Performance
- 查询性能提升 2-5x
- 缓存命中率提升 30-50%
- 减少 2.5MB 包体积

## [1.0.0] - 2026-01-15

### Added
- 🎉 初始版本发布
- 📄 文档上传和解析（PDF、Word、Excel、Markdown）
- 🤖 智能问答系统
- 🕸️ 网络拓扑还原与可视化
- 🔌 RESTful API
- 🐳 Docker 部署支持

### Features
- RAG 架构实现
- 向量检索系统
- Neo4j 知识图谱集成
- WebSocket 实时通信
- 多格式文档解析

---

## Version Naming

- **Major (X.0.0)**: Breaking changes, major feature additions
- **Minor (x.Y.0)**: New features, backward compatible
- **Patch (x.y.Z)**: Bug fixes, performance improvements

[2.0.2]: https://github.com/zhangdailin/AI_Knowledge_Assistant_FOR_NVIDIA_NETWORK_PRODUCT/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/zhangdailin/AI_Knowledge_Assistant_FOR_NVIDIA_NETWORK_PRODUCT/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/zhangdailin/AI_Knowledge_Assistant_FOR_NVIDIA_NETWORK_PRODUCT/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/zhangdailin/AI_Knowledge_Assistant_FOR_NVIDIA_NETWORK_PRODUCT/releases/tag/v1.0.0
