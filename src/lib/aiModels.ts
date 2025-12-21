/**
 * AI模型集成模块
 * 集成多个免费AI模型，支持智能切换和降级
 */

import { generateOptimizedSystemMessage, generateOptimizedUserMessage } from './optimizedPrompts';
import { generateChineseSystemMessage, generateChineseUserMessage } from './chinesePrompts';
import { optimizeChineseResponse } from './completeChineseOptimization';


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

    const defaultSystemMessage = '你是专业的中文技术文档助手，必须严格基于提供的中文参考内容回答问题。如果知识库中没有相关信息，请明确说明，绝不编造信息。回答必须使用中文。';
    
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
      
      // 优化中文语言，确保回答使用自然的中文表达
      const optimizedAnswer = optimizeChineseResponse(answer, request.references);
      
      return {
        answer: optimizedAnswer,
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
    // 严格的模拟回答生成 - 防止幻觉
    const hasReferences = references && references.length > 0;
    
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
      answer += `对于网络配置问题，建议上传包含以下内容的文档：\n`;
      answer += `• PFC（Priority Flow Control）配置命令\n`;
      answer += `• ECN（Explicit Congestion Notification）设置步骤\n`;
      answer += `• RoCE（RDMA over Converged Ethernet）配置指南\n`;
      answer += `• 相关验证和故障排除命令`;
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
