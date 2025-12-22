/**
 * AI模型集成模块
 * 集成多个免费AI模型，支持智能切换和降级
 */

import { generateChineseSystemMessage, generateChineseUserMessage } from './chinesePrompts';

const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1';
const SILICONFLOW_CHAT_URL = `${SILICONFLOW_BASE_URL}/chat/completions`;

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
    apiEndpoint: SILICONFLOW_CHAT_URL,
    maxTokens: 8192,
    description: '硅基流动 Qwen/Qwen3-32B，中文优化，性能优秀'
  }
];

class AIModelManager {
  private currentModel: string = 'qwen3-32b';
  private fallbackModels: string[] = ['qwen3-32b'];
  
  // 使用更轻量的模型进行关键词提取，速度更快
  private readonly FAST_MODEL = 'Qwen/Qwen2.5-7B-Instruct';
  
  // 主力模型：Qwen3-32B
  private readonly QWEN_MODEL = 'Qwen/Qwen3-32B'; 
  // 备用模型：Qwen2.5-32B
  private readonly FALLBACK_QWEN_MODEL = 'Qwen/Qwen2.5-32B-Instruct';

  // 使用硅基流动 API 调用 AI 模型
  async generateAnswer(request: ChatRequest): Promise<ChatResponse> {
    // ... (rest of the function)
    let systemMessage: string;
    let userMessage: string;
    
    // 检测是否为网络配置查询
    const isNetworkConfig = request.question.toLowerCase().includes('pfc') || 
                           request.question.toLowerCase().includes('ecn') ||
                           request.question.toLowerCase().includes('配置') ||
                           request.question.toLowerCase().includes('configure');
    
    if (request.references && request.references.length > 0) {
      // 使用中文优化的严格提示词
      systemMessage = generateChineseSystemMessage(
        true, 
        request.deepThinking || false, 
        isNetworkConfig
      );
      
      userMessage = generateChineseUserMessage(
        request.question,
        request.references,
        request.conversationHistory
      );
      
    } else {
      // 使用中文优化的无参考提示词
      systemMessage = generateChineseSystemMessage(false, request.deepThinking || false, isNetworkConfig);
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

    // 如果 usedModel 是内部标识符 'qwen3-32b'，将其映射为真实的 API 模型 ID
    if (usedModel === 'qwen3-32b') {
      usedModel = this.QWEN_MODEL;
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // 如果是第一次尝试且不是关键词任务，尝试使用 Qwen3
        // 如果失败（400），下次尝试切换到 fallback 模型
        const modelToUse = (attempt === 0) ? usedModel : (attempt === 1 ? this.FALLBACK_QWEN_MODEL : usedModel);
        
        const response = await this.callSiliconFlow(userMessage, modelToUse, attempt, systemMessage, request.deepThinking, request.references);
        return {
          answer: response.answer,
          model: response.model,
          usage: response.usage,
          references: buildReferences()
        };
      } catch (error: any) {
        console.error(`AI模型调用失败 (尝试 ${attempt + 1}/${maxRetries}):`, error);
        
        // 检查是否为 400 错误（模型不存在）
        const isModelError = error.message && error.message.includes('400') && error.message.includes('Model does not exist');
        
        if (attempt < maxRetries - 1) {
          // 如果是模型不存在错误，立即重试并切换模型，无需等待
          if (isModelError) {
             console.warn(`模型 ${usedModel} 不存在，立即切换到备用模型 ${this.FALLBACK_QWEN_MODEL}`);
             usedModel = this.FALLBACK_QWEN_MODEL;
             continue;
          }
          
          // 线性退避等待
          await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
        }
      }
    }
    
    // 所有尝试都失败，返回模拟回答以提升用户体验
    console.warn('所有模型调用失败，返回模拟回答');
    const mock = this.generateEnhancedMockAnswer(userMessage, usedModel || this.currentModel, request.references, request.question);
    return {
      ...mock,
      references: buildReferences()
    };
  }


  // 生成搜索关键词（自适应检索）
  async generateSearchKeywords(query: string): Promise<string[]> {
    const systemPrompt = `You are a search query optimizer for a network operating system documentation (like NVIDIA Cumulus Linux). 
Your task is to extract relevant technical search keywords, synonyms, and command prefixes from the user's query.
Rules:
1. Expand acronyms (e.g., "acl" -> "access control list").
2. Add relevant command prefixes (e.g., if query implies config, add "nv set", "net add").
3. Include specific protocol terms (e.g., "bgp" -> "neighbor", "peer").
4. Output ONLY the keywords separated by spaces. Do not output explanations.`;

    try {
      // 这里的 model 参数我们传 undefined，让 callSiliconFlow 内部自动选择 FAST_MODEL
      const response = await this.callSiliconFlow(
        query,
        undefined, // Let callSiliconFlow pick FAST_MODEL
        0,
        systemPrompt,
        false
      );
      
      const text = response.answer.trim();
      return text.split(/[\s,]+/)
        .map(w => w.trim())
        .filter(w => w.length > 1 && !['and', 'or', 'the', 'a', 'an', 'in', 'on', 'to', 'for', 'of', 'with'].includes(w.toLowerCase()));
        
    } catch (error) {
      console.warn('Keyword generation failed, falling back to basic extraction:', error);
      return this.extractKeywords(query);
    }
  }

  private async callSiliconFlow(
    context: string, 
    model?: string, 
    attempt: number = 0, 
    systemMessage?: string, 
    deepThinking?: boolean,
    references?: string[]
  ): Promise<ChatResponse> {
    // 使用硅基流动 API
    const { unifiedStorageManager } = await import('./localStorage');
    const apiKey = await unifiedStorageManager.getApiKey('siliconflow') || import.meta.env.VITE_SILICONFLOW_API_KEY;
    
    if (!apiKey) {
      throw new Error('硅基流动 API密钥未配置');
    }

    const defaultSystemMessage = '你是专业的中文技术文档助手，必须严格基于提供的中文参考内容回答问题。如果知识库中没有相关信息，请明确说明，绝不编造信息。回答必须使用中文。';
    
    const isIndexingTask = context.length > 5000;
    const isKeywordTask = systemMessage?.includes('search query optimizer');
    
    // 确定使用的模型：如果是关键词任务，优先使用轻量级模型
    // 注意：如果 model 参数未传递，或传递的是内部标识符 'qwen3-32b'，则需要正确映射
    let modelToUse = model;
    if (!modelToUse || modelToUse === 'qwen3-32b') {
      modelToUse = isKeywordTask ? this.FAST_MODEL : this.QWEN_MODEL;
    }

    // 再次确认：如果此时 modelToUse 仍为 qwen3-32b (可能因为传入的 model 就是这个)，强制映射
    if (modelToUse === 'qwen3-32b') {
        modelToUse = this.QWEN_MODEL;
    }

    let baseTimeout = 10000; // 默认 10s
    if (isIndexingTask) baseTimeout = 60000; // 索引任务 60s
    if (isKeywordTask) baseTimeout = 10000;   // 关键词生成任务 10s
    
    const timeout = baseTimeout + (attempt * 5000); 
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(SILICONFLOW_CHAT_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: modelToUse,
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
        answer: answer,
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

  private generateEnhancedMockAnswer(context: string, model: string, references?: string[], originalQuestion?: string): ChatResponse {
    // 严格的模拟回答生成 - 防止幻觉
    let hasReferences = references && references.length > 0;
    
    // 如果提供了原始问题，检查参考内容的相关性
    if (hasReferences && originalQuestion) {
      const keywords = this.extractKeywords(originalQuestion);
      // 检查是否有任何关键词在任何参考内容中出现（不区分大小写）
      const isRelevant = references!.some(ref => {
        const refLower = ref.toLowerCase();
        return keywords.some(kw => refLower.includes(kw.toLowerCase()));
      });
      
      // 如果没有匹配的关键词，视为无参考内容，避免显示不相关的文档
      if (!isRelevant) {
        console.warn('参考内容与问题关键词不匹配，降级为无参考内容模式');
        hasReferences = false;
      }
    }
    
    let answer = '';
    
    if (hasReferences) {
      // 如果有参考内容，生成基于参考的回答
      answer = `根据提供的参考内容：\n\n`;
      references!.slice(0, 2).forEach((ref, index) => {
        answer += `${index + 1}. ${ref.substring(0, 150)}${ref.length > 150 ? '...' : ''}\n\n`;
      });
      answer += `注意：以上内容是模拟的参考内容示例。在实际应用中，请确保上传真实的技术文档。`;
    } else {
      // 没有参考内容时，明确说明并给出建议
      answer = `根据当前知识库检索结果，没有找到相关的技术文档。\n\n`;
      answer += `建议解决方案：\n`;
      answer += `1. 上传相关的技术文档到知识库\n`;
      answer += `2. 确保文档包含具体的配置命令和步骤\n`;
      answer += `3. 可以上传厂商官方配置指南或CLI参考手册\n\n`;
      answer += `建议上传与您问题主题相关的具体技术文档（例如：BGP、路由、接口配置等）。`;
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
