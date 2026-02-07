import type { EmotionLabel, VitalsEvent } from './ExpoPresageEmotion.types';

/**
 * Infer a simple emotion label from Presage SmartSpectra vitals.
 * Presage provides physiological metrics (pulse, breathing); we map them to
 * stressed / calm / neutral using heuristic thresholds.
 */
export function inferEmotionFromVitals(vitals: VitalsEvent): EmotionLabel {
  const { pulseRate, breathingRate } = vitals;
  if (pulseRate <= 0 && breathingRate <= 0) return 'neutral';

  // Resting adult: HR ~60–100 bpm, breathing ~12–20/min
  const highPulse = pulseRate > 95;
  const lowPulse = pulseRate > 0 && pulseRate < 55;
  const highBreathing = breathingRate > 22;
  const lowBreathing = breathingRate > 0 && breathingRate < 10;

  if (highPulse || highBreathing) return 'stressed';
  if ((lowPulse || lowBreathing) && !highPulse && !highBreathing) return 'calm';
  return 'neutral';
}
