/**
 * 答案一致性与命令验证工具
 * 通过文本分析和模糊匹配检测回答中是否包含参考文档没有的命令
 */

function normalizeText(text = '') {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function extractCodeBlocks(answer = '') {
  const blocks = [];
  const regex = /```[\s\S]*?```/g;
  let match;
  while ((match = regex.exec(answer)) !== null) {
    const content = match[0]
      .replace(/```[\s\S]*?\n?/, '')
      .replace(/```$/, '');
    blocks.push(content.trim());
  }
  return blocks;
}

function prepareReferenceEntry(ref, index) {
  if (!ref) {
    return {
      id: `ref-${index}`,
      title: `参考文档 #${index + 1}`,
      index,
      content: '',
      lowerContent: ''
    };
  }

  if (typeof ref === 'string') {
    const clean = ref.replace(/\r/g, '');
    return {
      id: `ref-${index}`,
      title: `参考文档 #${index + 1}`,
      index,
      content: clean,
      lowerContent: clean.toLowerCase()
    };
  }

  const content = (ref.content || ref.text || '').replace(/\r/g, '');
  return {
    id: ref.id ? String(ref.id) : `ref-${index}`,
    title: ref.title || `参考文档 #${index + 1}`,
    index,
    content,
    lowerContent: content.toLowerCase()
  };
}

function createExcerpt(content, startIndex, length) {
  if (!content) return '';
  const radius = 80;
  const start = Math.max(0, startIndex - radius);
  const end = Math.min(content.length, startIndex + (length || 0) + radius);
  return content.slice(start, end).trim();
}

function matchCommandAgainstReferences(command, referencesMeta) {
  const normalizedCmd = command.toLowerCase().trim();
  if (!normalizedCmd) {
    return { matched: false, confidence: 0, reference: null, excerpt: '' };
  }

  const cmdParts = normalizedCmd.split(/\s+/).filter(Boolean);
  const mainCmd = cmdParts[0] || '';
  const prefix = cmdParts.length >= 2 ? `${cmdParts[0]} ${cmdParts[1]}` : '';

  // 检测是否是英伟达命令
  const isNvidiaCmd = /^nv\s+(show|set|unset|config|apply)/i.test(normalizedCmd);

  // 对于英伟达命令，提取命令模式（不包括具体参数值）
  let cmdPattern = normalizedCmd;
  if (isNvidiaCmd && cmdParts.length >= 3) {
    // 例如: "nv show interface swp1" -> "nv show interface"
    // 保留前3个词作为命令模式
    cmdPattern = cmdParts.slice(0, 3).join(' ');
  }

  let bestMatch = { matched: false, confidence: 0, reference: null, excerpt: '' };

  for (const ref of referencesMeta) {
    const { lowerContent, content } = ref;
    if (!lowerContent) continue;

    // 1. 完全匹配（最高优先级）
    const exactIdx = lowerContent.indexOf(normalizedCmd);
    if (exactIdx !== -1) {
      return {
        matched: true,
        confidence: 1,
        reference: ref,
        excerpt: createExcerpt(content, exactIdx, normalizedCmd.length)
      };
    }

    // 2. 对于英伟达命令，匹配命令模式（不要求参数完全一致）
    if (isNvidiaCmd && cmdPattern !== normalizedCmd) {
      const patternIdx = lowerContent.indexOf(cmdPattern);
      if (patternIdx !== -1 && bestMatch.confidence < 0.95) {
        bestMatch = {
          matched: true,
          confidence: 0.95, // 高置信度：命令结构匹配
          reference: ref,
          excerpt: createExcerpt(content, patternIdx, cmdPattern.length)
        };
      }
    }

    // 3. 前缀匹配（命令 + 第一个参数）
    if (prefix && cmdParts.length >= 2) {
      const prefixIdx = lowerContent.indexOf(prefix);
      if (prefixIdx !== -1 && bestMatch.confidence < 0.85) {
        bestMatch = {
          matched: true,
          confidence: 0.85,
          reference: ref,
          excerpt: createExcerpt(content, prefixIdx, prefix.length)
        };
      }
    }

    // 4. 主命令匹配（只匹配第一个词）
    if (mainCmd && mainCmd.length > 1) {
      const mainIdx = lowerContent.indexOf(mainCmd);
      if (mainIdx !== -1 && bestMatch.confidence < 0.7) {
        bestMatch = {
          matched: true,
          confidence: 0.7,
          reference: ref,
          excerpt: createExcerpt(content, mainIdx, mainCmd.length)
        };
      }
    }
  }

  return bestMatch;
}

// 命令模式定义 - 支持更多网络设备和系统命令
const COMMAND_PATTERNS = [
  // 英伟达网络设备命令（优先匹配）
  /^nv\s+(show|set|unset|config|apply)/i,
  // 其他网络设备命令
  /^(nv-|netq|cumulus|show\s+|ip\s+|ping\s+|traceroute\s+|mtr\s+)/i,
  // 配置命令（必须有空格或参数）
  /^(conf\s+|config\s+|set\s+|delete\s+|remove\s+|enable\s+|disable\s+|shutdown|no\s+shutdown)/i,
  // Linux系统命令
  /^(sudo\s+|apt\s+|yum\s+|systemctl\s+|service\s+|docker\s+|kubectl\s+|git\s+)/i,
  // 网络工具
  /^(curl\s+|wget\s+|ssh\s+|scp\s+|rsync\s+|nc\s+|telnet\s+)/i,
  // 文件操作
  /^(cat\s+|grep\s+|awk\s+|sed\s+|find\s+|ls\s+|cd\s+|mkdir\s+|rm\s+|cp\s+|mv\s+)/i
];

// 排除模式 - 这些不是命令
const EXCLUDE_PATTERNS = [
  /^(system|config|interface|router|switch|vlan|port|network|device|server|host|node|cluster|pod|namespace|service|deployment|container|image|volume|secret|configmap):?\s*$/i,
  /^(注意|说明|示例|例如|提示|警告|重要|备注|参考|步骤|方法|配置|设置|选项|参数|说明|描述)[:：]/i,
  /^\d+[\.\)]\s+/,  // 列表项编号
  /^[-*]\s+/,       // 列表项标记
];

function isLikelyCommand(line) {
  const trimmed = line.trim();

  // 基本过滤
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return false;

  // 排除明显不是命令的内容
  if (EXCLUDE_PATTERNS.some(pattern => pattern.test(trimmed))) return false;

  // 排除只有一个单词且以冒号结尾的（标签）
  if (/^[a-z]+:$/i.test(trimmed)) return false;

  // 排除太短的内容（少于3个字符）
  if (trimmed.length < 3) return false;

  // 匹配命令模式
  return COMMAND_PATTERNS.some(pattern => pattern.test(trimmed));
}

function extractCommandLines(answer = '') {
  const commands = new Set();
  const codeBlocks = extractCodeBlocks(answer);

  // 从代码块中提取命令
  codeBlocks.forEach(block => {
    block.split('\n').forEach(line => {
      if (isLikelyCommand(line)) {
        commands.add(line.trim());
      }
    });
  });

  // 从行内代码中提取命令
  answer.split('\n').forEach(line => {
    const inlineMatches = line.match(/`([^`]+)`/g) || [];
    inlineMatches.forEach(item => {
      const cmd = item.replace(/`/g, '').trim();
      if (cmd && isLikelyCommand(cmd)) {
        commands.add(cmd);
      }
    });
  });

  return Array.from(commands);
}

export function validateAnswerConsistency(answer, references = [], question = '') {
  console.log('[Validation] 开始验证答案');
  console.log('[Validation] 参考文档数量:', references.length);
  console.log('[Validation] 回答长度:', answer.length);

  const referencesMeta = references.map((ref, index) => prepareReferenceEntry(ref, index));
  const referenceCorpus = referencesMeta.map(ref => ref.lowerContent).join('\n');
  const commandLines = extractCommandLines(answer);

  console.log('[Validation] 提取到的命令数量:', commandLines.length);
  if (commandLines.length > 0) {
    console.log('[Validation] 命令列表:', commandLines);
  }

  const hallucinations = [];
  const verifiedCommands = [];
  const partialMatches = [];
  const referenceUsageMap = new Map();
  let totalMatchConfidence = 0;

  const recordReferenceUsage = (payload) => {
    const key = payload.referenceId || `idx-${payload.referenceIndex ?? 'unknown'}`;
    if (!referenceUsageMap.has(key)) {
      referenceUsageMap.set(key, {
        referenceId: payload.referenceId || null,
        referenceTitle: payload.referenceTitle || null,
        referenceIndex: payload.referenceIndex ?? null,
        commands: [],
        excerpts: []
      });
    }
    const existing = referenceUsageMap.get(key);
    existing.commands.push(payload.command);
    if (payload.excerpt) {
      existing.excerpts.push(payload.excerpt);
    }
  };

  // 使用模糊匹配验证每个命令
  commandLines.forEach(cmd => {
    const matchResult = matchCommandAgainstReferences(cmd, referencesMeta);

    if (matchResult.matched && matchResult.reference) {
      const payload = {
        command: cmd,
        confidence: matchResult.confidence,
        referenceId: matchResult.reference.id,
        referenceTitle: matchResult.reference.title,
        referenceIndex: matchResult.reference.index,
        excerpt: matchResult.excerpt
      };
      // 降低阈值：置信度 >= 0.9 算已验证，< 0.9 算部分匹配
      if (matchResult.confidence >= 0.9) {
        verifiedCommands.push(payload);
      } else {
        partialMatches.push(payload);
      }
      recordReferenceUsage(payload);
      totalMatchConfidence += matchResult.confidence;
    } else if (matchResult.matched) {
      // 找到了部分匹配但缺少参考上下文
      partialMatches.push({
        command: cmd,
        confidence: matchResult.confidence,
        excerpt: matchResult.excerpt
      });
      totalMatchConfidence += matchResult.confidence;
    } else {
      hallucinations.push({ command: cmd, reason: 'not_found' });
    }
  });

  const hasReferences = referencesMeta.some(ref => ref.lowerContent.trim().length > 0);
  const hasCommands = commandLines.length > 0;

  // 改进的置信度计算
  let confidenceScore;
  let validationMethod = '';

  if (!hasReferences && !hasCommands) {
    // 情况1: 无参考文档，无命令 - 可能是纯文本回答
    // 基于回答长度���结构判断质量
    const answerLength = answer.trim().length;
    if (answerLength > 200) {
      confidenceScore = 0.6; // 较长的回答，中等置信度
      validationMethod = 'content-length';
    } else if (answerLength > 50) {
      confidenceScore = 0.5; // 中等长度，中低置信度
      validationMethod = 'content-length';
    } else {
      confidenceScore = 0.3; // 很短的回答，低置信度
      validationMethod = 'content-length';
    }
  } else if (!hasReferences && hasCommands) {
    // 情况2: 无参考文档，但有命令 - 可能是通用知识回答
    // 命令越多，风险越高
    if (commandLines.length <= 2) {
      confidenceScore = 0.5; // 少量命令，中等置信度
      validationMethod = 'no-reference-few-commands';
    } else {
      confidenceScore = 0.3; // 较多命令但无参考，低置信度
      validationMethod = 'no-reference-many-commands';
    }
  } else if (hasReferences && !hasCommands) {
    // 情况3: 有参考文档，无命令 - 纯文本回答
    // 检查回答是否包含参考文档的关键内容
    const answerNormalized = normalizeText(answer);
    const referenceWords = referenceCorpus.split(/\s+/).filter(w => w.length > 3);
    const matchedWords = referenceWords.filter(word => answerNormalized.includes(word));
    const contentMatchRate = referenceWords.length > 0 ? matchedWords.length / referenceWords.length : 0;

    // 改进：考虑回答长度，避免给予过高的置信度
    const answerLength = answer.trim().length;

    if (contentMatchRate > 0.3) {
      confidenceScore = answerLength > 200 ? 0.85 : 0.75; // 高内容匹配度
      validationMethod = 'content-match-high';
    } else if (contentMatchRate > 0.1) {
      confidenceScore = answerLength > 200 ? 0.7 : 0.6; // 中等内容匹配度
      validationMethod = 'content-match-medium';
    } else {
      // 低匹配度：可能是幻觉回答
      confidenceScore = answerLength > 200 ? 0.5 : 0.4; // 低内容匹配度
      validationMethod = 'content-match-low';
    }
  } else {
    // 情况4: 有参考文档，有命令 - 完整验证
    const matchRate = commandLines.length > 0 ? totalMatchConfidence / commandLines.length : 0;
    const hallucinationRatio = commandLines.length > 0 ? hallucinations.length / commandLines.length : 0;

    // 基于命令匹配率和幻觉比例计算
    if (hallucinationRatio === 0) {
      // 无幻觉命令
      confidenceScore = 0.7 + matchRate * 0.3; // 0.7-1.0
      validationMethod = 'full-validation-no-hallucination';
    } else if (hallucinationRatio < 0.3) {
      // 少量幻觉
      confidenceScore = 0.5 + matchRate * 0.2 - hallucinationRatio * 0.3;
      validationMethod = 'full-validation-few-hallucinations';
    } else {
      // 较多幻觉
      confidenceScore = Math.max(0.2, matchRate * 0.5 - hallucinationRatio * 0.4);
      validationMethod = 'full-validation-many-hallucinations';
    }
  }

  confidenceScore = Number(Math.max(0, Math.min(1, confidenceScore)).toFixed(2));

  console.log('[Validation] 验证方法:', validationMethod);
  console.log('[Validation] 最终置信度:', confidenceScore);
  console.log('[Validation] 已验证命令:', verifiedCommands.length);
  console.log('[Validation] 部分匹配:', partialMatches.length);
  console.log('[Validation] 幻觉命令:', hallucinations.length);

  const referenceSummaries = referencesMeta.map(ref => ({
    id: ref.id,
    title: ref.title,
    index: ref.index
  }));

  const referenceMatches = Array.from(referenceUsageMap.values());

  const warnings = [];
  if (!hasReferences) warnings.push('没有可用的参考文档');
  if (hallucinations.length > 0) warnings.push(`检测到 ${hallucinations.length} 个未验证的命令`);
  if (partialMatches.length > 0) warnings.push(`${partialMatches.length} 个命令为部分匹配`);
  if (!answer || !answer.trim()) warnings.push('回答内容为空');

  return {
    isConsistent: hallucinations.length === 0,
    confidenceScore,
    totalCommands: commandLines.length,
    verifiedCommands,
    partialMatches,
    hallucinations,
    warnings,
    question,
    validationMethod, // 添加验证方法，便于调试
    hasReferences,
    referenceSummaries,
    referenceMatches,
    analyzedAt: new Date().toISOString()
  };
}

export function summarizeValidation(validation) {
  if (!validation) return null;
  const { isConsistent, confidenceScore, hallucinations = [] } = validation;
  return {
    ok: isConsistent,
    confidenceScore,
    hallucinationCount: hallucinations.length
  };
}
