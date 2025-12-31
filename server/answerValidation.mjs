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

// 命令模式定义 - 支持更多网络设备和系统命令
const COMMAND_PATTERNS = [
  // 网络设备命令
  /^(nv-|netq|cumulus|show|ip|system|ping|traceroute|mtr)/i,
  // 配置命令
  /^(conf|config|set|delete|remove|enable|disable|shutdown|no shutdown)/i,
  // Linux系统命令
  /^(sudo|apt|yum|systemctl|service|docker|kubectl|git)/i,
  // 网络工具
  /^(curl|wget|ssh|scp|rsync|nc|telnet)/i,
  // 文件操作
  /^(cat|grep|awk|sed|find|ls|cd|mkdir|rm|cp|mv)/i
];

function isLikelyCommand(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return false;
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

// 模糊匹配：检查命令是否在参考文档中出现（允许参数差异）
function fuzzyMatchCommand(command, referenceCorpus) {
  const normalizedCmd = command.toLowerCase().trim();

  // 精确匹配
  if (referenceCorpus.includes(normalizedCmd)) {
    return { matched: true, confidence: 1.0 };
  }

  // 提取命令主体（去除参数）
  const cmdParts = normalizedCmd.split(/\s+/);
  const mainCmd = cmdParts[0];

  // 检查命令主体是否存在
  if (referenceCorpus.includes(mainCmd)) {
    return { matched: true, confidence: 0.8 };
  }

  // 检查命令前缀（如 netq show）
  if (cmdParts.length >= 2) {
    const prefix = `${cmdParts[0]} ${cmdParts[1]}`;
    if (referenceCorpus.includes(prefix)) {
      return { matched: true, confidence: 0.7 };
    }
  }

  return { matched: false, confidence: 0 };
}

export function validateAnswerConsistency(answer, references = [], question = '') {
  console.log('[Validation] 开始验证答案');
  console.log('[Validation] 参考文档数量:', references.length);
  console.log('[Validation] 回答长度:', answer.length);

  const normalizedReferences = references.map(ref => normalizeText(ref));
  const referenceCorpus = normalizedReferences.join('\n');
  const commandLines = extractCommandLines(answer);

  console.log('[Validation] 提取到的命令数量:', commandLines.length);
  if (commandLines.length > 0) {
    console.log('[Validation] 命令列表:', commandLines);
  }

  const hallucinations = [];
  const verifiedCommands = [];
  const partialMatches = [];
  let totalMatchConfidence = 0;

  // 使用模糊匹配验证每个命令
  commandLines.forEach(cmd => {
    const matchResult = fuzzyMatchCommand(cmd, referenceCorpus);

    if (matchResult.matched) {
      if (matchResult.confidence === 1.0) {
        verifiedCommands.push(cmd);
      } else {
        partialMatches.push({ command: cmd, confidence: matchResult.confidence });
      }
      totalMatchConfidence += matchResult.confidence;
    } else {
      hallucinations.push(cmd);
    }
  });

  const hasReferences = normalizedReferences.length > 0 && referenceCorpus.trim().length > 0;
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

    if (contentMatchRate > 0.3) {
      confidenceScore = 0.85; // 高内容匹配度
      validationMethod = 'content-match-high';
    } else if (contentMatchRate > 0.1) {
      confidenceScore = 0.7; // 中等内容匹配度
      validationMethod = 'content-match-medium';
    } else {
      confidenceScore = 0.5; // 低内容匹配度
      validationMethod = 'content-match-low';
    }
  } else {
    // 情况4: 有参考文档，有命令 - 完整验证
    const matchRate = totalMatchConfidence / commandLines.length;
    const hallucinationRatio = hallucinations.length / commandLines.length;

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
