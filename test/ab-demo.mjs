/**
 * A/B 测试首次实验示例
 * 运行: node test/ab-demo.mjs
 */

import * as abTesting from '../server/abTesting.mjs';

async function runDemo() {
    console.log('='.repeat(60));
    console.log('🧪 A/B 测试框架演示');
    console.log('='.repeat(60));

    // 1. 使用预置模板创建实验
    console.log('\n📝 Step 1: 创建实验（使用检索策略模板）');
    const template = abTesting.EXPERIMENT_TEMPLATES.retrievalStrategy;

    const experiment = await abTesting.createExperiment({
        name: template.name,
        description: '对比 Local、Hybrid、Vector-only 三种检索策略的效果',
        variants: template.variants,
        metrics: template.metrics,
        trafficAllocation: [34, 33, 33] // 流量均分
    });

    console.log(`   ✅ 实验已创建: ${experiment.id}`);
    console.log(`   变体: ${experiment.variants.map(v => v.name).join(', ')}`);

    // 2. 启动实验
    console.log('\n🚀 Step 2: 启动实验');
    await abTesting.startExperiment(experiment.id);
    console.log('   ✅ 实验已启动');

    // 3. 模拟用户分流
    console.log('\n👥 Step 3: 模拟用户分流');
    const users = ['user-001', 'user-002', 'user-003', 'user-004', 'user-005'];

    for (const userId of users) {
        const variant = await abTesting.assignVariant(userId);
        console.log(`   ${userId} → ${variant.variantName}`);
    }

    // 4. 模拟记录实验结果
    console.log('\n📊 Step 4: 模拟记录实验指标');

    const mockResults = [
        // Local Only 变体
        { variantId: 'var-0', responseTime: 120, relevanceScore: 0.82, kgHitRate: 0.7 },
        { variantId: 'var-0', responseTime: 115, relevanceScore: 0.85, kgHitRate: 0.8 },
        { variantId: 'var-0', responseTime: 130, relevanceScore: 0.78, kgHitRate: 0.6 },
        // GraphRAG Hybrid 变体
        { variantId: 'var-1', responseTime: 180, relevanceScore: 0.92, kgHitRate: 0.9 },
        { variantId: 'var-1', responseTime: 175, relevanceScore: 0.88, kgHitRate: 0.85 },
        { variantId: 'var-1', responseTime: 190, relevanceScore: 0.95, kgHitRate: 0.95 },
        // Vector Only 变体  
        { variantId: 'var-2', responseTime: 80, relevanceScore: 0.72, kgHitRate: 0 },
        { variantId: 'var-2', responseTime: 75, relevanceScore: 0.68, kgHitRate: 0 },
        { variantId: 'var-2', responseTime: 85, relevanceScore: 0.75, kgHitRate: 0 }
    ];

    for (const result of mockResults) {
        await abTesting.recordResult({
            experimentId: experiment.id,
            variantId: result.variantId,
            query: '测试查询',
            metrics: {
                responseTime: result.responseTime,
                relevanceScore: result.relevanceScore,
                kgHitRate: result.kgHitRate
            }
        });
    }
    console.log(`   ✅ 已记录 ${mockResults.length} 条结果`);

    // 5. 分析实验结果
    console.log('\n📈 Step 5: 分析实验结果');
    const analysis = await abTesting.analyzeExperiment(experiment.id);

    console.log(`   实验: ${analysis.experimentName}`);
    console.log(`   样本总数: ${analysis.totalSamples}`);
    console.log(`   主要指标: ${analysis.primaryMetric}`);
    console.log('\n   各变体表现:');

    for (const [variantId, data] of Object.entries(analysis.variants)) {
        console.log(`   📌 ${data.name} (${data.samples} 样本)`);
        for (const [metric, stats] of Object.entries(data.metrics)) {
            console.log(`      ${metric}: 均值=${stats.mean}, 标准差=${stats.stdDev}`);
        }
    }

    if (analysis.winner) {
        const winner = analysis.variants[analysis.winner];
        console.log(`\n   🏆 获胜者: ${winner.name}`);
    }

    // 6. 停止实验
    console.log('\n⏹️  Step 6: 停止实验');
    await abTesting.stopExperiment(experiment.id);
    console.log('   ✅ 实验已停止');

    console.log('\n' + '='.repeat(60));
    console.log('🎉 演示完成！');
    console.log('='.repeat(60));

    console.log('\n💡 在实际使用中:');
    console.log('   1. 在前端调用 GET /api/ab/variant 获取用户分组');
    console.log('   2. 根据返回的 config 选择检索策略');
    console.log('   3. 查询完成后调用 POST /api/ab/record 记录指标');
    console.log('   4. 定期调用 GET /api/ab/experiments/:id/analyze 查看结果');
}

runDemo().catch(console.error);
