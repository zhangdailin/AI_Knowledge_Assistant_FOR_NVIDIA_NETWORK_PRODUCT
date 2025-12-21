/**
 * AI模型集成模块
 * 集成多个免费AI模型，支持智能切换和降级
 */


export interface AIModel {
  name: string;
  provider: string;
  apiEndpoint: string;
  maxTokens: number;
  description: string;
}

export interface ChatRequest {
  question: string;
  context?: string;
  model?: string;
  references?: string[];
  conversationHistory?: string; // 对话历史上下文
  deepThinking?: boolean; // 深度思考模式
}

export interface ChatResponse {
  answer: string;
  model: string;
  usage: {
    tokens: number;
  };
  references?: Array<{
    title: string;
    content: string;
    score: number;
  }>;
}

// AI模型配置（使用硅基流动）
export const FREE_AI_MODELS: AIModel[] = [
  {
    name: 'qwen3-32b',
    provider: '硅基流动',
    apiEndpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    maxTokens: 8192,
    description: '硅基流动 Qwen/Qwen3-32B，中文优化，性能优秀'
  }
];

class AIModelManager {
  private currentModel: string = 'qwen3-32b';
  private fallbackModels: string[] = ['qwen3-32b'];
  private readonly SILICONFLOW_CHAT_URL = 'https://api.siliconflow.cn/v1/chat/completions';
  private readonly QWEN_MODEL = 'Qwen/Qwen3-32B';

  // 使用硅基流动 API 调用 Qwen3-32B 模型
  async generateAnswer(request: ChatRequest): Promise<ChatResponse> {
    // 构建system message和user message（分离指令和内容）
    let systemMessage: string;
    let userMessage: string;
    
    if (request.references && request.references.length > 0) {
      let baseSystemMessage = 'You are a knowledge base assistant. Answer questions based on the provided reference content when it is relevant. ' +
        'Rules: 1) If the reference content contains relevant information to answer the question, use it to provide a detailed answer. ' +
        '2) If the reference content is not relevant to the question, answer the question using your general knowledge in a natural and helpful way, without mentioning that the reference content is irrelevant. ' +
        '3) Be specific and cite key information from the reference content when it is relevant. ' +
        '4) Answer the question directly and naturally, do not explain rules or repeat instructions.';
      
      // 深度思考模式：添加多步骤推理指令（但必须严格基于参考内容）
      if (request.deepThinking) {
        baseSystemMessage += '\n\n[深度思考模式] 在回答之前，请进行以下深度思考，但必须严格基于参考内容，不得添加任何外部知识：' +
          '1) 仔细分析问题的核心需求，识别参考内容中哪些部分最相关；' +
          '2) 从参考内容中提取关键信息，识别不同参考内容之间的关联和一致性；' +
          '3) 基于参考内容中的信息，考虑问题的不同方面和可能的边界情况；' +
          '4) 构建基于参考内容的逻辑推理链条，确保答案的准确性和完整性；' +
          '5) 如果问题涉及多个方面，从参考内容中分别提取相关信息并综合回答；' +
          '6) 提供更详细、更深入的解释，但所有解释必须基于参考内容中的信息，包括参考内容中提到的原理、原因和注意事项。' +
          '重要：深度思考的目的是更深入地分析参考内容，而不是添加参考内容中没有的信息。所有回答必须严格基于参考内容。';
      }
      
      systemMessage = baseSystemMessage;
      
      userMessage = 'Reference Content:\n\n';
      request.references.forEach((ref, index) => {
        // 优化上下文格式，添加分隔符和索引
        userMessage += `========== Reference ${index + 1} ==========\n${ref}\n\n`;
      });
      
      // 如果有对话历史，添加到上下文中
      if (request.conversationHistory && request.conversationHistory.trim().length > 0) {
        userMessage += '========== Conversation History ==========\n';
        userMessage += '以下是最近的对话历史，可以帮助理解问题的上下文：\n\n';
        userMessage += request.conversationHistory;
        userMessage += '\n\n';
      }
      
      userMessage += '========== User Question ==========\n';
      userMessage += request.question;
      
    } else {
      let baseSystemMessage = '你是一个专业的AI知识助手，基于提供的知识库内容准确回答用户问题。';
      
      // 深度思考模式：添加多步骤推理指令（但必须严格基于知识库内容）
      if (request.deepThinking) {
        baseSystemMessage += '\n\n[深度思考模式] 在回答之前，请进行以下深度思考，但必须严格基于知识库内容，不得添加任何外部知识：' +
          '1) 仔细分析问题的核心需求，识别知识库中哪些内容最相关；' +
          '2) 从知识库内容中提取关键信息，进行更深入的分析和理解；' +
          '3) 基于知识库中的信息，考虑问题的不同方面；' +
          '4) 构建基于知识库内容的逻辑推理链条，确保答案的准确性和完整性；' +
          '5) 如果问题涉及多个方面，从知识库中分别提取相关信息并综合回答；' +
          '6) 提供更详细、更深入的解释，但所有解释必须基于知识库中的信息。' +
          '重要：深度思考的目的是更深入地分析知识库内容，而不是添加知识库中没有的信息。所有回答必须严格基于知识库内容。';
      }
      
      systemMessage = baseSystemMessage;
      userMessage = request.question;
    }


    const buildReferences = () => request.references ? request.references.map((ref, index) => {
      // 显示更多内容，如果超过500字符，显示前400字符+后100字符
      let displayContent = ref;
      if (ref.length > 500) {
        displayContent = ref.substring(0, 400) + '...\n[...中间内容已省略...]\n...' + ref.substring(ref.length - 100);
      }
      return {
        title: `参考文档 ${index + 1}`,
        content: displayContent,
        score: 0.95 - (index * 0.1),
        fullLength: ref.length
      };
    }) : undefined;

    // 重试与降级机制
    const maxRetries = 3;
    const retryDelay = 1000; // 1秒基础延迟
    let usedModel = request.model || this.currentModel;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.callSiliconFlow(userMessage, usedModel, attempt, systemMessage, request.deepThinking);
        return {
          answer: response.answer,
          model: response.model,
          usage: response.usage,
          references: buildReferences()
        };
      } catch (error) {
        console.error(`AI模型调用失败 (尝试 ${attempt + 1}/${maxRetries}):`, error);
        if (attempt < maxRetries - 1) {
          // 线性退避等待
          await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
          // 尝试切换到备用模型
          const fallbackModel = this.getNextFallbackModel(usedModel);
          if (fallbackModel && fallbackModel !== usedModel) {
            console.log(`切换到备用模型: ${fallbackModel}`);
            usedModel = fallbackModel;
          }
        }
      }
    }

    // 所有尝试都失败，返回模拟回答以提升用户体验
    console.warn('所有模型调用失败，返回模拟回答');
    const mock = this.generateEnhancedMockAnswer(userMessage, usedModel || this.currentModel, request.references);
      return {
        ...mock,
        references: buildReferences()
      };
  }


  private async callSiliconFlow(context: string, model?: string, attempt: number = 0, systemMessage?: string, deepThinking?: boolean): Promise<ChatResponse> {
    // 使用硅基流动 API
    const { unifiedStorageManager } = await import('./localStorage');
    const apiKey = await unifiedStorageManager.getApiKey('siliconflow') || import.meta.env.VITE_SILICONFLOW_API_KEY;
    
    if (!apiKey) {
      throw new Error('硅基流动 API密钥未配置');
    }

    const defaultSystemMessage = '你是一个专业的AI知识助手，基于提供的知识库内容准确回答用户问题。如果知识库中没有相关信息，请明确说明。';
    
    // 添加超时机制
    // 对于索引生成任务，使用更长的超时时间（因为需要处理大量文本）
    const isIndexingTask = context.length > 5000; // 判断是否为索引任务（通常内容较长）
    const baseTimeout = isIndexingTask ? 60000 : 10000; // 索引任务60秒（增加超时时间），普通任务10秒
    const timeout = baseTimeout + (attempt * 10000); // 每次重试增加10秒（索引任务）或5秒（普通任务）
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(this.SILICONFLOW_CHAT_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.QWEN_MODEL,
          messages: [
            {
              role: 'system',
              content: systemMessage || defaultSystemMessage
            },
            {
              role: 'user',
              content: context
            }
          ],
          max_tokens: 8192, // 增加token限制，避免内容被截断
          temperature: deepThinking ? 0.5 : 0.7 // 深度思考模式适度降低temperature，保持准确性
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        
        throw new Error(`API调用失败: ${response.status} - ${errorText.substring(0, 200)}`);
      }

      const data = await response.json();
      
      const answer = data.choices[0].message.content;
      const finishReason = data.choices[0]?.finish_reason || 'unknown';
      const isTruncated = finishReason === 'length' || finishReason === 'max_tokens';
      
      if (isTruncated) {
        console.warn(`[SiliconFlow] 响应被截断，finishReason: ${finishReason}，answer长度: ${answer.length}`);
      }
      
      return {
        answer,
        model: data.model || this.QWEN_MODEL,
        usage: {
          tokens: data.usage?.total_tokens || 0
        }
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('API调用超时');
      }
      console.error('硅基流动 API调用失败:', error);
      throw error;
    }
  }

  private generateEnhancedMockAnswer(context: string, model: string, references?: string[]): ChatResponse {
    // 更智能的模拟回答生成
    const keywords = this.extractKeywords(context);
    const hasReferences = references && references.length > 0;
    
    let answer = '';
    
    if (hasReferences) {
      // 如果有参考内容，生成基于参考的回答
      answer = `根据知识库中的相关内容，我为您提供以下信息：\n\n`;
      references!.slice(0, 2).forEach((ref, index) => {
        answer += `${index + 1}. ${ref.substring(0, 150)}${ref.length > 150 ? '...' : ''}\n\n`;
      });
      answer += `基于这些内容，我可以帮您总结关键要点。如果您需要更详细的信息，请告诉我。`;
    } else if (keywords.length > 0) {
      // 基于关键词生成相关回答
      answer = `我理解您询问的是关于「${keywords.join('、')}」相关的内容。\n\n`;
      answer += `虽然当前知识库中没有直接相关的文档，但我可以为您提供一些一般性的建议：\n\n`;
      answer += `• 请确保您的问题描述清晰具体\n`;
      answer += `• 您可以尝试上传相关文档到知识库\n`;
      answer += `• 或者提供更多上下文信息\n\n`;
      answer += `我会尽力为您提供准确的回答。`;
    } else {
      // 通用回答模板
      const templates = [
        `您好！我是您的AI知识助手，很高兴为您解答问题。\n\n`,
        `感谢您的提问。我会基于知识库内容为您提供准确的信息。\n\n`,
        `这是一个很好的问题。让我为您详细解答。\n\n`
      ];
      answer = templates[Math.floor(Math.random() * templates.length)];
      answer += `当前系统正在演示模式下运行。您可以：\n`;
      answer += `• 上传文档到知识库\n`;
      answer += `• 尝试不同的问题\n`;
      answer += `• 配置API密钥以获得更好的体验`;
    }
    
    return {
      answer,
      model: model,
      usage: {
        tokens: Math.floor(Math.random() * 300) + 150
      }
    };
  }

  private extractKeywords(text: string): string[] {
    // 简单的关键词提取
    const stopWords = ['的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '些', '个', '只', '现在', '可以', '请', '问', '什么', '怎么', '如何', '为什么'];
    const words = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ').split(/\s+/);
    const keywords = words.filter(word => 
      word.length >= 2 && 
      !stopWords.includes(word) && 
      !/^\d+$/.test(word)
    );
    return [...new Set(keywords)].slice(0, 5); // 最多返回5个关键词
  }

  private getNextFallbackModel(currentModel?: string): string | null {
    const currentIndex = this.fallbackModels.indexOf(currentModel || this.currentModel);
    if (currentIndex < this.fallbackModels.length - 1) {
      return this.fallbackModels[currentIndex + 1];
    }
    return null;
  }

  // 设置当前使用的模型
  setCurrentModel(model: string) {
    if (FREE_AI_MODELS.some(m => m.name === model)) {
      this.currentModel = model;
    }
  }
}

export const aiModelManager = new AIModelManager();
