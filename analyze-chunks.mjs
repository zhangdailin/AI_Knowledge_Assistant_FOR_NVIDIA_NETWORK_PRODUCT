import fs from 'fs';

const data = JSON.parse(fs.readFileSync('data/chunks/doc-1766481503268.json', 'utf-8'));

// 统计 chunk 类型
const stats = { parent: 0, child: 0, window: 0, other: 0 };
data.forEach(c => {
    if (c.chunkType === 'parent') stats.parent++;
    else if (c.chunkType === 'child') stats.child++;
    else if (c.chunkType === 'window') stats.window++;
    else stats.other++;
});
console.log('Chunk 统计:', stats);
console.log('总数:', data.length);

// 查看父子关系是否正确
const parentIds = new Set(data.filter(c => c.chunkType === 'parent').map(c => c.id));
const orphanChildren = data.filter(c => c.chunkType === 'child' && c.parentId && !parentIds.has(c.parentId));
console.log('孤儿子块数量:', orphanChildren.length);

// 看看 parent chunk 的内容长度分布
const parentLengths = data.filter(c => c.chunkType === 'parent').map(c => c.content?.length || 0);
console.log('Parent 内容长度: min=%d, max=%d, avg=%d',
    Math.min(...parentLengths),
    Math.max(...parentLengths),
    Math.round(parentLengths.reduce((a,b)=>a+b,0)/parentLengths.length));

// 看看 child chunk 的内容长度分布
const childLengths = data.filter(c => c.chunkType === 'child').map(c => c.content?.length || 0);
if (childLengths.length > 0) {
    console.log('Child 内容长度: min=%d, max=%d, avg=%d',
        Math.min(...childLengths),
        Math.max(...childLengths),
        Math.round(childLengths.reduce((a,b)=>a+b,0)/childLengths.length));
}

// 检查代码块是否被切断
const brokenCodeBlocks = data.filter(c => {
    const content = c.content || '';
    const openCount = (content.match(/```/g) || []).length;
    return openCount % 2 !== 0; // 奇数个 ``` 说明代码块被切断
});
console.log('代码块被切断的 chunk 数量:', brokenCodeBlocks.length);

// 显示几个被切断的代码块示例
if (brokenCodeBlocks.length > 0) {
    console.log('\n--- 代码块被切断的示例 ---');
    brokenCodeBlocks.slice(0, 2).forEach((c, i) => {
        console.log(`\n[${i}] Type: ${c.chunkType}, Length: ${c.content.length}`);
        console.log('Content preview:', c.content.substring(0, 300));
    });
}

// 检查内容重复问题
const contentHashes = {};
data.forEach(c => {
    const hash = c.content?.substring(0, 200) || '';
    contentHashes[hash] = (contentHashes[hash] || 0) + 1;
});
const duplicates = Object.values(contentHashes).filter(v => v > 1).length;
console.log('\n内容重复的 chunk 数量:', duplicates);
