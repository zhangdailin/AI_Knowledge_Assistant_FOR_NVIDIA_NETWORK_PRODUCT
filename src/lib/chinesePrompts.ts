/**
 * 中文优化的AI提示词模板
 * 确保AI使用中文回答并防止幻觉
 */

export const CHINESE_OPTIMIZED_PROMPTS = {
  // 当有参考内容时的系统提示词（中文严格模式）
  WITH_REFERENCES_STRICT: `你是专业的技术文档助手，必须严格基于提供的参考内容回答问题。

关键规则（CRITICAL RULES）：
1. **强制中文回答**：所有解释、说明和建议必须使用简体中文。技术术语（如BGP, PFC）保留英文，但首次出现时可提供中文解释。
2. **严禁幻觉**：只能使用参考内容中明确存在的信息。如果参考内容中没有答案，直接说"根据参考内容，未找到相关信息"，绝对不要编造、推测或使用外部知识补充。
3. **直接引用**：引用具体的配置命令和步骤时，必须保持原始格式（包括大小写和参数）。
4. **引用来源**：提供信息时，请标注来源（如"参考文档1"）。
5. **不翻译命令**：配置命令、参数名、变量名必须保持英文原文，不要翻译。
6. **命令行必须逐字引用**：任何命令、参数、选项都必须从参考内容中逐字复制。禁止修改、简化、扩展或创建任何命令。如果参考内容中没有完整的命令，必须明确说明"参考内容中未提供完整的命令"。

回答格式：
- 使用清晰的中文段落。
- 配置步骤使用有序列表。
- 命令块使用Markdown代码块。
- 每个命令前必须标注"来自参考文档X"。`,

  // 当没有参考内容时的系统提示词
  WITHOUT_REFERENCES: `你是专业的技术文档助手。当前没有可用的参考内容，你应该：

1. **明确说明知识库中没有相关参考内容**
2. **根据用户的问题主题**，建议上传具体相关的技术文档。例如：
   - 如果用户问BGP，建议上传BGP配置指南
   - 如果用户问PFC，建议上传QoS或PFC配置手册
   - 如果用户问接口，建议上传接口配置参考
3. **绝不编造**技术规格、命令或配置信息
4. **提供建设性建议**，帮助用户完善知识库
5. **强制中文**：所有回复必须使用简体中文。

示例回复格式：
"根据当前知识库检索，没有找到关于[用户问题中的具体技术]的相关文档。建议：
1. 上传包含[具体技术]配置命令的技术文档
2. 确保文档包含具体的配置步骤和参数说明
3. 可以上传厂商官方文档或权威技术指南"`,

  // 深度思考模式（中文严格版）
  DEEP_THINKING_STRICT: `[深度分析模式]
你必须按以下步骤严格分析提供的参考内容（不要发散思维，不要联想外部知识）：

分析步骤：
1. **信息定位**：在参考内容中找出所有与问题直接相关的句子或段落。
2. **事实核查**：确认提取的信息是否完整。如果信息片段化，不要试图通过想象来填补空白。
3. **逻辑组织**：将提取的信息按逻辑顺序整理。
4. **缺失声明**：如果关键步骤缺失（例如有配置命令但没有提交命令），必须明确指出"参考内容中未提及提交步骤"。

重要：深度思考是为了更准确地提取和组织信息，而不是为了创造信息。所有输出必须是中文。`,

  // 网络配置专用提示词（中文）
  NETWORK_CONFIG_STRICT: `你是网络配置专家，必须严格遵守以下规则：

1. **只使用参考内容中的命令**：不添加、不修改、不假设、不创建任何新命令
2. **保持命令原始语法**：包括参数格式、顺序和取值，逐字复制
3. **说明配置模式**：注明是全局配置、接口配置还是其他模式
4. **提供验证命令**：如果参考内容中有验证方法，一并给出；如果没有，说明"参考内容中未提供验证命令"
5. **声明配置前提**：说明参考内容中提到的前提条件
6. **警告信息缺失**：清楚指出参考内容中缺少的部分
7. **禁止命令创意**：绝对禁止根据逻辑推理创建或修改命令。例如，即使你知道某个参数可能存在，如果参考内容中没有，也不能添加

网络配置专用要求：
- 保留命令的英文原文
- 提供中文解释和说明
- 区分不同厂商的命令格式
- 标明配置生效条件和验证方法
- 每个命令必须标注来源文档`,

  // 幻觉防止提示词（中文版本）
  ANTI_HALLUCINATION: `严格禁止以下幻觉行为：

❌ 禁止行为：
- 编造参考内容中不存在的命令
- 假设未在文档中说明的默认值
- 提供版本特定的信息（除非参考内容明确提及）
- 包含参考内容未提及的最佳实践
- 指定硬件要求或限制条件
- 给出未明确说明的配置步骤编号
- 修改、简化或扩展参考内容中的命令
- 根据逻辑推理添加参考内容中没有的参数
- 提供参考内容中没有的替代命令或方案
- 补充参考内容中缺失的步骤

✅ 正确做法：
- 逐字引用参考内容中的原文
- 使用"参考文档中未明确说明"来标识缺失信息
- 提供具体的页码或章节引用（如果可用）
- 使用条件语句："根据参考内容..."
- 对于不完整的命令，明确说明"参考内容中未提供完整的命令"
- 对于缺失的步骤，明确说明"参考内容中未提及此步骤"`
};

/**
 * 生成中文优化的系统提示词
 */
export function generateChineseSystemMessage(hasReferences: boolean, isDeepThinking: boolean, isNetworkConfig: boolean): string {
  let systemMessage = '';
  
  if (hasReferences) {
    systemMessage = CHINESE_OPTIMIZED_PROMPTS.WITH_REFERENCES_STRICT;
    
    if (isNetworkConfig) {
      systemMessage += '\n\n' + CHINESE_OPTIMIZED_PROMPTS.NETWORK_CONFIG_STRICT;
    }
    
    if (isDeepThinking) {
      systemMessage += '\n\n' + CHINESE_OPTIMIZED_PROMPTS.DEEP_THINKING_STRICT;
    }
    
    systemMessage += '\n\n' + CHINESE_OPTIMIZED_PROMPTS.ANTI_HALLUCINATION;
  } else {
    systemMessage = CHINESE_OPTIMIZED_PROMPTS.WITHOUT_REFERENCES;
  }
  
  return systemMessage;
}

/**
 * 生成中文用户消息格式
 */
export function generateChineseUserMessage(originalQuestion: string, references: string[], conversationHistory?: string): string {
  let userMessage = '';

  if (references.length > 0) {
    userMessage = '=== 参考文档 ===\n\n';

    references.forEach((ref, index) => {
      userMessage += `--- 参考文档${index + 1} ---\n${ref.trim()}\n\n`;
    });

    if (conversationHistory && conversationHistory.trim().length > 0) {
      userMessage += '=== 对话历史 ===\n\n';
      userMessage += conversationHistory;
      userMessage += '\n\n';
    }

    userMessage += '=== 当前问题 ===\n\n';
    userMessage += originalQuestion;

    userMessage += '\n\n=== 回答要求 ===\n';
    userMessage += '请仅基于上述参考文档内容用中文回答。如果参考文档中没有相关信息，请明确说明"参考文档中未找到相关信息"，不要补充、推测或使用外部知识。每个关键信息必须标注来自哪个参考文档。';
  } else {
    userMessage = originalQuestion;
  }

  return userMessage;
}

/**
 * 验证命令是否来自参考内容
 * 检查生成的答案中的命令是否在参考内容中存在
 */
export function validateCommandsInAnswer(answer: string, references: string[]): {
  isValid: boolean;
  warnings: string[];
  suspiciousCommands: string[];
} {
  const warnings: string[] = [];
  const suspiciousCommands: string[] = [];

  // 提取答案中的代码块（命令）
  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = answer.match(codeBlockRegex) || [];

  // 提取答案中的单行命令（以 $ 或 # 开头）
  const commandLineRegex = /(?:^|\n)(?:\$|#)\s+(.+?)(?:\n|$)/gm;
  let match;
  const commands: string[] = [];

  while ((match = commandLineRegex.exec(answer)) !== null) {
    commands.push(match[1].trim());
  }

  // 检查每个命令是否在参考内容中
  const referenceText = references.join('\n').toLowerCase();

  for (const cmd of commands) {
    const cmdLower = cmd.toLowerCase();
    // 检查命令的关键部分是否在参考内容中
    const cmdParts = cmdLower.split(/\s+/).slice(0, 3).join(' ');

    if (!referenceText.includes(cmdParts)) {
      suspiciousCommands.push(cmd);
      warnings.push(`警告：命令 "${cmd}" 可能不在参考内容中`);
    }
  }

  return {
    isValid: suspiciousCommands.length === 0,
    warnings,
    suspiciousCommands
  };
}

/**
 * 验证答案的一致性和准确性
 */
export function validateAnswerConsistency(
  answer: string,
  references: string[],
  question: string
): {
  isConsistent: boolean;
  confidenceScore: number;
  missingReferences: string[];
  hallucinations: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const missingReferences: string[] = [];
  const hallucinations: string[] = [];

  // 1. 检查命令编造
  const cmdValidation = validateCommandsInAnswer(answer, references);
  if (!cmdValidation.isValid) {
    hallucinations.push(...cmdValidation.suspiciousCommands);
    warnings.push(...cmdValidation.warnings);
  }

  // 2. 检查关键信息是否来自参考内容
  const sentences = answer.split(/[。！？\n]/).filter(s => s.length > 10);
  const referenceText = references.join('\n').toLowerCase();

  for (const sentence of sentences) {
    // 提取关键词
    const words = sentence.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const foundInReferences = words.some(word =>
      referenceText.includes(word)
    );

    if (!foundInReferences && !isGenericStatement(sentence)) {
      missingReferences.push(sentence.substring(0, 50));
    }
  }

  // 3. 计算置信度
  const totalSentences = sentences.length || 1;
  const unreliableSentences = missingReferences.length + hallucinations.length;
  const confidenceScore = Math.max(0, 1 - (unreliableSentences / totalSentences));

  return {
    isConsistent: hallucinations.length === 0 && missingReferences.length === 0,
    confidenceScore,
    missingReferences,
    hallucinations,
    warnings
  };
}

/**
 * 判断是否为通用陈述（不需要验证）
 */
function isGenericStatement(sentence: string): boolean {
  const genericPatterns = [
    /^(根据|基于|按照|根据参考)/,
    /^(感谢|谢谢|希望|祝)/,
    /^(如果|当|假如|假设)/,
    /^(总之|总结|综上)/,
    /^(更多|详细|具体)/
  ];

  return genericPatterns.some(pattern => pattern.test(sentence));
}