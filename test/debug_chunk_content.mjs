
import { enhancedParentChildChunking } from '../server/chunking.mjs';

const testMarkdown = `
# Chapter 1
This is some content.

## Section 1.1
More content here.

\`\`\`python
print("hello")
\`\`\`
`;

console.log('Testing Chunk Content Generation...');
const chunks = enhancedParentChildChunking(testMarkdown);

console.log(`Generated ${chunks.length} chunks.`);

let emptyChunks = 0;
chunks.forEach((c, i) => {
    console.log(`\nChunk ${i} [${c.chunkType}]:`);
    console.log(`Content Length: ${c.content ? c.content.length : 0}`);
    console.log(`Content Preview: ${c.content ? c.content.substring(0, 50).replace(/\n/g, '\\n') : 'NULL'}`);
    
    if (!c.content || c.content.trim().length === 0) {
        emptyChunks++;
        console.error('WARNING: Empty content detected!');
    }
});

if (emptyChunks > 0) {
    console.error(`\nFAILURE: Found ${emptyChunks} empty chunks.`);
} else {
    console.log('\nSUCCESS: All chunks have content.');
}
