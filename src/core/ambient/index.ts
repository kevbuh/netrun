import { PageInsightPipeline } from './pipeline.js';

export const insightPipeline = new PageInsightPipeline();

export function initInsight(): void {
  console.log('[insight] Page insight pipeline initialized');
}
