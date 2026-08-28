import { confidenceBand, requiresReview, type ConfidenceBand } from '../models';

export { confidenceBand, requiresReview };

export function scoreExtraction(signals: {
  hasSpecialty: boolean;
  hasExaminer: boolean;
  hasCase: boolean;
  hasQuestion: boolean;
  hasAnswer: boolean;
  structuredMarkers: number;
}): { confidence: number; band: ConfidenceBand; reviewRequired: boolean } {
  let score = 0;
  if (signals.hasSpecialty) score += 0.18;
  if (signals.hasExaminer) score += 0.22;
  if (signals.hasCase) score += 0.18;
  if (signals.hasQuestion) score += 0.22;
  if (signals.hasAnswer) score += 0.12;
  score += Math.min(0.12, signals.structuredMarkers * 0.04);
  const confidence = Math.max(0, Math.min(0.99, score));
  return {
    confidence,
    band: confidenceBand(confidence),
    reviewRequired: requiresReview(confidence),
  };
}
