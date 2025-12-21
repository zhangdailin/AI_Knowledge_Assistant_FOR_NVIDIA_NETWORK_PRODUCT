/**
 * 完整的中文语言优化模块
 * 处理AI回答中的英文内容，转换为自然的中文
 */

export function optimizeChineseResponse(originalAnswer: string, references?: string[]): string {
  // 如果已经是中文为主的回答，直接返回
  if (isMostlyChinese(originalAnswer)) {
    return addChinesePolishing(originalAnswer, references);
  }
  
  // 如果包含大量英文，进行完整翻译优化
  return performCompleteChineseOptimization(originalAnswer, references);
}

/**
 * 判断文本是否主要是中文
 */
function isMostlyChinese(text: string): boolean {
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
  const totalChars = text.replace(/\s+/g, '').length;
  return (chineseChars.length / totalChars) > 0.3; // 中文字符占比超过30%
}

/**
 * 添加中文润色和优化
 */
function addChinesePolishing(text: string, references?: string[]): string {
  let polished = text;
  
  // 1. 修正明显的英文短语
  const commonCorrections = [
    { en: 'Based on the reference content', cn: '基于参考内容' },
    { en: 'According to Reference', cn: '根据参考文档' },
    { en: 'Please execute', cn: '请执行' },
    { en: 'the following commands', cn: '以下命令' },
    { en: 'the specific configuration', cn: '具体配置' },
    { en: 'If the references don\'t contain', cn: '如果参考文档不包含' },
    { en: 'Never invent or hallucinate', cn: '绝不编造或幻觉' },
    { en: 'Quote specific commands', cn: '引用具体命令' },
    { en: 'from Reference', cn: '来自参考文档' },
    { en: 'from the documentation', cn: '来自文档' },
    { en: 'in order to enable', cn: '为了启用' },
    { en: 'Here are the', cn: '以下是' },
    { en: 'configuration commands', cn: '配置命令' },
    { en: 'Please execute these commands in order', cn: '请按顺序执行这些命令' }
  ];
  
  commonCorrections.forEach(correction => {
    const regex = new RegExp(correction.en, 'gi');
    polished = polished.replace(regex, correction.cn);
  });
  
  // 2. 添加参考来源标注
  if (references && references.length > 0 && !polished.includes('信息来源')) {
    if (polished.includes('参考文档')) {
      polished += '\n\n**信息来源**：以上配置信息来自提供的参考文档，请根据实际网络环境进行调整。';
    }
  }
  
  return polished;
}

/**
 * 执行完整的中文优化
 */
function performCompleteChineseOptimization(originalAnswer: string, references?: string[]): string {
  let optimized = originalAnswer;
  
  // 1. 分段处理，保留代码块不变
  const segments = splitByCodeBlocks(optimized);
  
  const processedSegments = segments.map(segment => {
    if (segment.isCode) {
      return segment.content; // 代码块保持不变
    } else {
      return processTextSegment(segment.content);
    }
  });
  
  optimized = processedSegments.join('');
  
  // 2. 技术术语中文解释
  optimized = addTechnicalTermExplanations(optimized);
  
  // 3. 添加参考来源
  if (references && references.length > 0) {
    optimized = addReferenceAttribution(optimized);
  }
  
  return optimized;
}

/**
 * 按代码块分割文本
 */
function splitByCodeBlocks(text: string): Array<{content: string, isCode: boolean}> {
  const segments = [];
  const codeBlockRegex = /```[\s\S]*?```/g;
  let lastIndex = 0;
  let match;
  
  while ((match = codeBlockRegex.exec(text)) !== null) {
    // 添加前面的文本段
    if (match.index > lastIndex) {
      segments.push({
        content: text.substring(lastIndex, match.index),
        isCode: false
      });
    }
    
    // 添加代码块
    segments.push({
      content: match[0],
      isCode: true
    });
    
    lastIndex = match.index + match[0].length;
  }
  
  // 添加剩余的文本
  if (lastIndex < text.length) {
    segments.push({
      content: text.substring(lastIndex),
      isCode: false
    });
  }
  
  return segments;
}

/**
 * 处理文本段
 */
function processTextSegment(text: string): string {
  let processed = text;
  
  // 1. 完整的句子级别翻译
  const sentenceTranslations = [
    {
      pattern: /Based on the reference content, here are the configuration commands:/gi,
      replacement: '基于参考内容，以下是配置命令：'
    },
    {
      pattern: /Based on the reference content, here is the (\w+) configuration:/gi,
      replacement: '基于参考内容，以下是$1配置：'
    },
    {
      pattern: /Based on the reference content/gi,
      replacement: '基于参考内容'
    },
    {
      pattern: /According to Reference (\d+), here are the/gi,
      replacement: '根据参考文档$1，以下是'
    },
    {
      pattern: /According to Reference (\d+),/gi,
      replacement: '根据参考文档$1，'
    },
    {
      pattern: /Please execute the following commands to enable (\w+)/gi,
      replacement: '请执行以下命令来启用$1'
    },
    {
      pattern: /Please execute the following commands/gi,
      replacement: '请执行以下命令'
    },
    {
      pattern: /Here are the (\w+) configuration commands/gi,
      replacement: '以下是$1配置命令'
    },
    {
      pattern: /Here is the (\w+) configuration/gi,
      replacement: '以下是$1配置'
    },
    {
      pattern: /The specific configuration is as follows/gi,
      replacement: '具体配置如下'
    },
    {
      pattern: /If the references don't contain complete information/gi,
      replacement: '如果参考文档不包含完整信息'
    },
    {
      pattern: /Never invent or hallucinate additional technical details/gi,
      replacement: '绝不编造或幻觉额外的技术细节'
    },
    {
      pattern: /Quote specific commands from the documentation/gi,
      replacement: '从文档中引用具体命令'
    },
    {
      pattern: /Please execute these commands in order/gi,
      replacement: '请按顺序执行这些命令'
    },
    {
      pattern: /from Reference (\d+)/gi,
      replacement: '来自参考文档$1'
    },
    {
      pattern: /from the documentation/gi,
      replacement: '来自文档'
    },
    {
      pattern: /in order to enable (\w+)/gi,
      replacement: '为了启用$1'
    },
    {
      pattern: /according to your actual environment/gi,
      replacement: '根据您的实际环境'
    },
    {
      pattern: /adjust these parameters accordingly/gi,
      replacement: '相应地调整这些参数'
    }
  ];
  
  sentenceTranslations.forEach(translation => {
    processed = processed.replace(translation.pattern, translation.replacement);
  });
  
  // 2. 词汇级别翻译
  const wordTranslations = [
    { en: 'configuration', cn: '配置' },
    { en: 'commands', cn: '命令' },
    { en: 'reference', cn: '参考' },
    { en: 'documentation', cn: '文档' },
    { en: 'execute', cn: '执行' },
    { en: 'enable', cn: '启用' },
    { en: 'specific', cn: '具体' },
    { en: 'according', cn: '根据' },
    { en: 'content', cn: '内容' },
    { en: 'additional', cn: '额外' },
    { en: 'technical', cn: '技术' },
    { en: 'details', cn: '细节' },
    { en: 'accordingly', cn: '相应地' }
  ];
  
  wordTranslations.forEach(translation => {
    const regex = new RegExp(`\\b${translation.en}\\b`, 'gi');
    processed = processed.replace(regex, translation.cn);
  });
  
  return processed;
}

/**
 * 添加技术术语中文解释
 */
function addTechnicalTermExplanations(text: string): string {
  let explained = text;
  
  const techTerms = [
    {
      pattern: /PFC configuration/gi,
      replacement: 'PFC（Priority Flow Control，优先级流控制）配置'
    },
    {
      pattern: /ECN configuration/gi,
      replacement: 'ECN（Explicit Congestion Notification，显式拥塞通知）配置'
    },
    {
      pattern: /QoS configuration/gi,
      replacement: 'QoS（Quality of Service，服务质量）配置'
    },
    {
      pattern: /RoCE configuration/gi,
      replacement: 'RoCE（RDMA over Converged Ethernet）配置'
    },
    {
      pattern: /traffic-class/gi,
      replacement: '流量类别（traffic-class）'
    },
    {
      pattern: /min-threshold/gi,
      replacement: '最小阈值（min-threshold）'
    },
    {
      pattern: /max-threshold/gi,
      replacement: '最大阈值（max-threshold）'
    },
    {
      pattern: /congestion-control/gi,
      replacement: '拥塞控制（congestion-control）'
    },
    {
      pattern: /switch-priority/gi,
      replacement: '交换机优先级（switch-priority）'
    }
  ];
  
  techTerms.forEach(term => {
    explained = explained.replace(term.pattern, term.replacement);
  });
  
  return explained;
}

/**
 * 添加参考来源标注
 */
function addReferenceAttribution(text: string): string {
  if (text.includes('参考文档') || text.includes('参考内容')) {
    return text + '\n\n**信息来源**：以上配置信息来自提供的参考文档，请根据实际网络环境进行调整。';
  }
  return text;
}