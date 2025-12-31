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
  const normalizedReferences = references.map(ref => normalizeText(ref));
  const referenceCorpus = normalizedReferences.join('\n');
  const commandLines = extractCommandLines(answer);

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

  const hasReferences = normalizedReferences.length > 0;
  const hasCommands = commandLines.length > 0;

  // 改进的置信度计算
  let confidenceScore;
  if (!hasReferences) {
    confidenceScore = 0.3; // 无参考文档，低置信度
  } else if (!hasCommands) {
    confidenceScore = 0.7; // 无命令但有参考，中等置信度
  } else {
    // 基于命令匹配率和匹配质量计算
    const matchRate = totalMatchConfidence / commandLines.length;
    const hallucinationPenalty = hallucinations.length > 0 ? 0.2 : 0;
    confidenceScore = Math.max(0, Math.min(1, matchRate - hallucinationPenalty));
  }

  confidenceScore = Number(confidenceScore.toFixed(2));

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
