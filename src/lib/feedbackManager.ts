/**
 * 用户反馈机制 - 收集和分析用户对答案的反馈
 */

export interface UserFeedback {
  id: string;
  messageId: string;
  conversationId: string;
  rating: number; // 1-5 stars
  comment?: string;
  timestamp: string;
  helpful?: boolean; // 是否有帮助
  accurate?: boolean; // 是否准确
  complete?: boolean; // 是否完整
}

export interface FeedbackStats {
  totalFeedback: number;
  averageRating: number;
  helpfulCount: number;
  accurateCount: number;
  completeCount: number;
  ratingDistribution: Record<number, number>;
}

class FeedbackManager {
  private feedbackList: UserFeedback[] = [];
  private readonly MAX_FEEDBACK = 1000;
  private readonly STORAGE_KEY = 'ai_assistant_feedback';

  constructor() {
    this.loadFromStorage();
  }

  /**
   * 提交反馈
   */
  submitFeedback(feedback: Omit<UserFeedback, 'id' | 'timestamp'>): UserFeedback {
    const newFeedback: UserFeedback = {
      ...feedback,
      id: `feedback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString()
    };

    this.feedbackList.push(newFeedback);
    if (this.feedbackList.length > this.MAX_FEEDBACK) {
      this.feedbackList.shift();
    }

    this.saveToStorage();
    return newFeedback;
  }

  /**
   * 获取反馈统计
   */
  getStats(): FeedbackStats {
    if (this.feedbackList.length === 0) {
      return {
        totalFeedback: 0,
        averageRating: 0,
        helpfulCount: 0,
        accurateCount: 0,
        completeCount: 0,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      };
    }

    const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalRating = 0;
    let helpfulCount = 0;
    let accurateCount = 0;
    let completeCount = 0;

    for (const feedback of this.feedbackList) {
      totalRating += feedback.rating;
      ratingDistribution[feedback.rating]++;
      if (feedback.helpful) helpfulCount++;
      if (feedback.accurate) accurateCount++;
      if (feedback.complete) completeCount++;
    }

    return {
      totalFeedback: this.feedbackList.length,
      averageRating: totalRating / this.feedbackList.length,
      helpfulCount,
      accurateCount,
      completeCount,
      ratingDistribution
    };
  }

  /**
   * 获取特定对话的反馈
   */
  getConversationFeedback(conversationId: string): UserFeedback[] {
    return this.feedbackList.filter(f => f.conversationId === conversationId);
  }

  /**
   * 获取所有反馈
   */
  getAllFeedback(): UserFeedback[] {
    return [...this.feedbackList];
  }

  /**
   * 清空反馈
   */
  clearFeedback(): void {
    this.feedbackList = [];
    this.saveToStorage();
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.feedbackList));
    } catch (error) {
      console.error('保存反馈失败:', error);
    }
  }

  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) {
        this.feedbackList = JSON.parse(data);
      }
    } catch (error) {
      console.error('加载反馈失败:', error);
      this.feedbackList = [];
    }
  }
}

export const feedbackManager = new FeedbackManager();
