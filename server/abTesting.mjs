/**
 * A/B 测试框架
 * 支持多种检索策略和模型配置的对比实验
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as storage from './storage.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPERIMENTS_FILE = path.join(__dirname, '..', 'data', 'ab_experiments.json');
const RESULTS_FILE = path.join(__dirname, '..', 'data', 'ab_results.json');

// 默认实验配置
const DEFAULT_EXPERIMENTS = {
    version: '1.0.0',
    experiments: [],
    activeExperiment: null
};

/**
 * 加载实验配置
 */
async function loadExperiments() {
    try {
        const content = await fs.readFile(EXPERIMENTS_FILE, 'utf-8');
        return JSON.parse(content);
    } catch (e) {
        return { ...DEFAULT_EXPERIMENTS };
    }
}

/**
 * 保存实验配置
 */
async function saveExperiments(data) {
    await fs.writeFile(EXPERIMENTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 加载实验结果
 */
async function loadResults() {
    try {
        const content = await fs.readFile(RESULTS_FILE, 'utf-8');
        return JSON.parse(content);
    } catch (e) {
        return { results: [] };
    }
}

/**
 * 保存实验结果
 */
async function saveResults(data) {
    await fs.writeFile(RESULTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 创建新实验
 * @param {Object} config - 实验配置
 * @returns {Object} 创建的实验
 */
export async function createExperiment(config) {
    const {
        name,
        description = '',
        variants = [],
        trafficAllocation = null, // 流量分配百分比 [50, 50] 或 [33, 33, 34]
        metrics = ['responseTime', 'relevanceScore', 'userSatisfaction'],
        startDate = new Date().toISOString(),
        endDate = null
    } = config;

    if (!name || variants.length < 2) {
        throw new Error('实验需要名称和至少 2 个变体');
    }

    // 默认均匀分配流量
    const allocation = trafficAllocation ||
        variants.map(() => Math.floor(100 / variants.length));

    const experiment = {
        id: `exp-${Date.now()}`,
        name,
        description,
        variants: variants.map((v, i) => ({
            id: `var-${i}`,
            name: v.name || `变体 ${i + 1}`,
            config: v.config || {},
            trafficPercent: allocation[i]
        })),
        metrics,
        status: 'created', // created | running | paused | completed
        startDate,
        endDate,
        createdAt: new Date().toISOString()
    };

    const data = await loadExperiments();
    data.experiments.push(experiment);
    await saveExperiments(data);

    console.log(`[A/B Testing] 创建实验: ${name} (${variants.length} 个变体)`);
    return experiment;
}

/**
 * 启动实验
 */
export async function startExperiment(experimentId) {
    const data = await loadExperiments();
    const experiment = data.experiments.find(e => e.id === experimentId);

    if (!experiment) {
        throw new Error(`实验 ${experimentId} 不存在`);
    }

    experiment.status = 'running';
    experiment.startDate = new Date().toISOString();
    data.activeExperiment = experimentId;

    await saveExperiments(data);
    console.log(`[A/B Testing] 启动实验: ${experiment.name}`);
    return experiment;
}

/**
 * 停止实验
 */
export async function stopExperiment(experimentId) {
    const data = await loadExperiments();
    const experiment = data.experiments.find(e => e.id === experimentId);

    if (!experiment) {
        throw new Error(`实验 ${experimentId} 不存在`);
    }

    experiment.status = 'completed';
    experiment.endDate = new Date().toISOString();

    if (data.activeExperiment === experimentId) {
        data.activeExperiment = null;
    }

    await saveExperiments(data);
    console.log(`[A/B Testing] 停止实验: ${experiment.name}`);
    return experiment;
}

/**
 * 流量分流 - 确定用户应该使用哪个变体
 * @param {string} userId - 用户标识（可用 sessionId 或随机数）
 * @returns {Object|null} 分配的变体，null 表示无活跃实验
 */
export async function assignVariant(userId = null) {
    const data = await loadExperiments();

    if (!data.activeExperiment) {
        return null;
    }

    const experiment = data.experiments.find(e => e.id === data.activeExperiment);
    if (!experiment || experiment.status !== 'running') {
        return null;
    }

    // 基于用户 ID 的确定性分流（同一用户始终获得相同变体）
    const hash = userId ? hashCode(userId) : Math.random() * 100;
    const bucket = Math.abs(hash) % 100;

    let cumulative = 0;
    for (const variant of experiment.variants) {
        cumulative += variant.trafficPercent;
        if (bucket < cumulative) {
            return {
                experimentId: experiment.id,
                experimentName: experiment.name,
                variantId: variant.id,
                variantName: variant.name,
                config: variant.config
            };
        }
    }

    // 默认返回第一个变体
    return {
        experimentId: experiment.id,
        experimentName: experiment.name,
        variantId: experiment.variants[0].id,
        variantName: experiment.variants[0].name,
        config: experiment.variants[0].config
    };
}

/**
 * 简单的字符串哈希函数
 */
function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash;
}

/**
 * 记录实验结果
 * @param {Object} result - 实验结果数据
 */
export async function recordResult(result) {
    const {
        experimentId,
        variantId,
        query,
        metrics = {},
        timestamp = new Date().toISOString()
    } = result;

    const data = await loadResults();
    data.results.push({
        experimentId,
        variantId,
        query: query?.substring(0, 100), // 截断查询
        metrics,
        timestamp
    });

    // 限制结果数量（保留最近 10000 条）
    if (data.results.length > 10000) {
        data.results = data.results.slice(-10000);
    }

    await saveResults(data);
}

/**
 * 分析实验结果
 * @param {string} experimentId - 实验 ID
 * @returns {Object} 分析结果
 */
export async function analyzeExperiment(experimentId) {
    const expData = await loadExperiments();
    const experiment = expData.experiments.find(e => e.id === experimentId);

    if (!experiment) {
        throw new Error(`实验 ${experimentId} 不存在`);
    }

    const resultsData = await loadResults();
    const expResults = resultsData.results.filter(r => r.experimentId === experimentId);

    // 按变体分组
    const byVariant = {};
    for (const variant of experiment.variants) {
        byVariant[variant.id] = {
            name: variant.name,
            samples: 0,
            metrics: {}
        };
    }

    // 聚合指标
    for (const result of expResults) {
        const variantData = byVariant[result.variantId];
        if (!variantData) continue;

        variantData.samples++;

        for (const [metricName, value] of Object.entries(result.metrics || {})) {
            if (typeof value !== 'number') continue;

            if (!variantData.metrics[metricName]) {
                variantData.metrics[metricName] = { sum: 0, count: 0, values: [] };
            }

            variantData.metrics[metricName].sum += value;
            variantData.metrics[metricName].count++;
            variantData.metrics[metricName].values.push(value);
        }
    }

    // 计算统计值
    const analysis = {
        experimentId,
        experimentName: experiment.name,
        status: experiment.status,
        totalSamples: expResults.length,
        variants: {}
    };

    for (const [variantId, data] of Object.entries(byVariant)) {
        const variantAnalysis = {
            name: data.name,
            samples: data.samples,
            metrics: {}
        };

        for (const [metricName, metricData] of Object.entries(data.metrics)) {
            const values = metricData.values;
            const mean = values.length > 0 ? metricData.sum / metricData.count : 0;

            // 计算标准差
            const variance = values.length > 0
                ? values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
                : 0;
            const stdDev = Math.sqrt(variance);

            variantAnalysis.metrics[metricName] = {
                mean: mean.toFixed(3),
                stdDev: stdDev.toFixed(3),
                min: values.length > 0 ? Math.min(...values).toFixed(3) : 0,
                max: values.length > 0 ? Math.max(...values).toFixed(3) : 0,
                sampleSize: metricData.count
            };
        }

        analysis.variants[variantId] = variantAnalysis;
    }

    // 确定获胜者（按主要指标）
    const primaryMetric = experiment.metrics[0] || 'responseTime';
    let winner = null;
    let bestValue = primaryMetric.includes('Time') ? Infinity : -Infinity;

    for (const [variantId, data] of Object.entries(analysis.variants)) {
        const metricValue = parseFloat(data.metrics[primaryMetric]?.mean || 0);
        const isBetter = primaryMetric.includes('Time')
            ? metricValue < bestValue
            : metricValue > bestValue;

        if (isBetter && data.samples >= 10) { // 至少 10 个样本
            bestValue = metricValue;
            winner = variantId;
        }
    }

    analysis.winner = winner;
    analysis.primaryMetric = primaryMetric;

    return analysis;
}

/**
 * 获取所有实验
 */
export async function listExperiments() {
    const data = await loadExperiments();
    return {
        experiments: data.experiments,
        activeExperiment: data.activeExperiment
    };
}

/**
 * 获取当前活跃实验
 */
export async function getActiveExperiment() {
    const data = await loadExperiments();
    if (!data.activeExperiment) return null;
    return data.experiments.find(e => e.id === data.activeExperiment) || null;
}

// 预置实验模板
export const EXPERIMENT_TEMPLATES = {
    // 检索策略对比
    retrievalStrategy: {
        name: '检索策略对比',
        variants: [
            { name: 'Local Only', config: { mode: 'local', enableKnowledgeGraph: true } },
            { name: 'GraphRAG Hybrid', config: { mode: 'hybrid', enableKnowledgeGraph: true } },
            { name: 'Vector Only', config: { mode: 'local', enableKnowledgeGraph: false } }
        ],
        metrics: ['responseTime', 'relevanceScore', 'kgHitRate']
    },

    // NER 方式对比
    nerMethod: {
        name: 'NER 方式对比',
        variants: [
            { name: 'Regex Only', config: { useLLM: 'never' } },
            { name: 'LLM Only', config: { useLLM: 'always' } },
            { name: 'Hybrid', config: { useLLM: 'hybrid' } }
        ],
        metrics: ['extractionTime', 'entityCount', 'accuracy']
    },

    // 动态权重对比
    dynamicWeight: {
        name: '动态权重对比',
        variants: [
            { name: '固定权重 0.3', config: { useDynamicWeight: false, kgWeight: 0.3 } },
            { name: '动态权重', config: { useDynamicWeight: true } }
        ],
        metrics: ['relevanceScore', 'responseTime']
    }
};
