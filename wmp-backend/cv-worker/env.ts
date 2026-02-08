export interface Env {
  // ── CV / Face Recognition ──
  WEAVIATE_CLUSTER_URL: string;
  WEAVIATE_API_KEY: string;
  PYTHON_EMBEDDING_URL: string;
  HF_EMOTION_URL: string;
  HF_API_KEY: string;

  // ── Gemini ──
  GEMINI_API_KEY: string;

  // ── MongoDB ──
  MONGODB_URI: string;
  MONGODB_DB_NAME: string;
  MONGODB_DEFAULT_COLLECTION: string;
}
