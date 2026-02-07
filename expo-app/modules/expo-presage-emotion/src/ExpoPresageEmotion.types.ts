export type VitalsEvent = {
  pulseRate: number;
  breathingRate: number;
};

export type EmotionLabel = 'stressed' | 'calm' | 'neutral';

export type PresageEmotionViewProps = {
  apiKey?: string;
  onVitals?: (event: { nativeEvent: VitalsEvent }) => void;
};
