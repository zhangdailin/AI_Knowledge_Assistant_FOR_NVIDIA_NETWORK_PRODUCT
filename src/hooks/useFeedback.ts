/**
 * 反馈数据访问钩子
 */

import { feedbackManager, FeedbackStats } from '../lib/feedbackManager';

export function useFeedbackStats(): FeedbackStats {
  return feedbackManager.getStats();
}

export function getConversationFeedback(conversationId: string) {
  return feedbackManager.getConversationFeedback(conversationId);
}

export function getAllFeedback() {
  return feedbackManager.getAllFeedback();
}

export function clearAllFeedback() {
  feedbackManager.clearFeedback();
}
