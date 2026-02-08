/**
 * Face Recognition Client for Cloudflare Workers
 * Uses Weaviate GraphQL REST API via fetch (no Node.js dependencies)
 */

// --- Types ---

export interface Env {
  WEAVIATE_CLUSTER_URL: string;
  WEAVIATE_API_KEY: string;
  PYTHON_EMBEDDING_URL: string;
  HF_EMOTION_URL: string;
  HF_API_KEY: string;
}

export interface FaceMatch {
  personName: string;
  confidence: number;
  distance: number;
}

export interface SearchResult {
  found: boolean;
  topMatch: FaceMatch | null;
  allMatches: FaceMatch[];
  searchTimeMs: number;
  facesDetected: number;
}

// --- Weaviate helpers ---

async function graphql(env: Env, query: string): Promise<any> {
  const url = env.WEAVIATE_CLUSTER_URL.startsWith("http")
    ? env.WEAVIATE_CLUSTER_URL
    : `https://${env.WEAVIATE_CLUSTER_URL}`;

  const res = await fetch(`${url}/v1/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.WEAVIATE_API_KEY}`,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`Weaviate ${res.status}: ${await res.text()}`);
  }

  const json: any = await res.json();
  if (json.errors?.length) {
    throw new Error(`Weaviate GraphQL: ${json.errors[0].message}`);
  }
  return json.data;
}

// --- Embedding extraction ---

async function extractEmbedding(env: Env, imageBlob: Blob): Promise<number[]> {
  const form = new FormData();
  form.append("image", imageBlob, "image.jpg");

  const res = await fetch(`${env.PYTHON_EMBEDDING_URL}/extract-embedding`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to extract embedding");
  }

  const data: any = await res.json();
  return data.embedding;
}

// --- Public API ---

export async function searchByBase64(
  env: Env,
  base64Image: string,
  options: { topK?: number; threshold?: number } = {}
): Promise<SearchResult> {
  const startTime = Date.now();
  const { topK = 5, threshold } = options;

  try {
    // Decode base64 → Blob (Workers-safe, no Buffer)
    const binary = atob(base64Image);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "image/jpeg" });

    // Extract embedding via Python service
    const embedding = await extractEmbedding(env, blob);

    // Query Weaviate nearVector
    const vectorStr = `[${embedding.join(",")}]`;
    const data = await graphql(
      env,
      `{
        Get {
          FaceEmbedding(
            nearVector: { vector: ${vectorStr} }
            limit: ${topK * 10}
          ) {
            personName
            _additional { distance }
          }
        }
      }`
    );

    const objects: any[] = data?.Get?.FaceEmbedding ?? [];

    // Group by person — keep best (lowest distance) match per person
    const personMatches = new Map<string, FaceMatch>();

    for (const item of objects) {
      const personName: string = item.personName;
      const distance: number = item._additional?.distance ?? 1.0;

      if (threshold !== undefined && distance > threshold) continue;

      if (
        !personMatches.has(personName) ||
        distance < personMatches.get(personName)!.distance
      ) {
        personMatches.set(personName, {
          personName,
          distance,
          confidence: (1 - distance) * 100,
        });
      }
    }

    const allMatches = Array.from(personMatches.values())
      .sort((a, b) => a.distance - b.distance)
      .slice(0, topK);

    return {
      found: allMatches.length > 0,
      topMatch: allMatches[0] ?? null,
      allMatches,
      searchTimeMs: Date.now() - startTime,
      facesDetected: 1,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("No face detected")) {
      return {
        found: false,
        topMatch: null,
        allMatches: [],
        searchTimeMs: Date.now() - startTime,
        facesDetected: 0,
      };
    }
    throw error;
  }
}

export async function listPeople(
  env: Env,
  limit = 100
): Promise<Array<{ personName: string; photoCount: number }>> {
  const data = await graphql(
    env,
    `{ Get { FaceEmbedding(limit: 1000) { personName } } }`
  );

  const objects: any[] = data?.Get?.FaceEmbedding ?? [];
  const peopleMap = new Map<string, number>();

  for (const item of objects) {
    const name: string = item.personName;
    peopleMap.set(name, (peopleMap.get(name) ?? 0) + 1);
  }

  return Array.from(peopleMap.entries())
    .map(([personName, photoCount]) => ({ personName, photoCount }))
    .slice(0, limit);
}

export async function getStats(
  env: Env
): Promise<{ totalEmbeddings: number; totalPeople: number }> {
  const data = await graphql(
    env,
    `{ Aggregate { FaceEmbedding { meta { count } } } }`
  );

  const totalEmbeddings: number =
    data?.Aggregate?.FaceEmbedding?.[0]?.meta?.count ?? 0;
  const people = await listPeople(env, 10000);

  return { totalEmbeddings, totalPeople: people.length };
}
