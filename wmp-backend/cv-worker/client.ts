/**
 * TypeScript Face Recognition Client
 * Queries Weaviate directly for face search
 */

import weaviate, { WeaviateClient, ApiKey } from 'weaviate-client';

// Types
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

/**
 * Face Recognition Client
 */
export class FaceRecognitionClient {
  private weaviateClient: WeaviateClient;
  private embeddingServiceUrl: string;
  private collectionName = 'FaceEmbedding';

  private constructor(client: WeaviateClient, embeddingServiceUrl: string) {
    this.weaviateClient = client;
    this.embeddingServiceUrl = embeddingServiceUrl;
  }

  static async create(
    embeddingServiceUrl: string = process.env.PYTHON_EMBEDDING_URL || "localhost:8000"
  ): Promise<FaceRecognitionClient> {
    const clusterUrl = process.env.WEAVIATE_CLUSTER_URL;
    const apiKey = process.env.WEAVIATE_API_KEY;

    if (!clusterUrl || !apiKey) {
      throw new Error('WEAVIATE_CLUSTER_URL and WEAVIATE_API_KEY environment variables must be set');
    }

    const client = await weaviate.connectToWeaviateCloud(clusterUrl, {
      authCredentials: new ApiKey(apiKey),
      skipInitChecks: true,
    });

    return new FaceRecognitionClient(client, embeddingServiceUrl);
  }

  /**
   * Extract embedding from image using Python service
   */
  private async extractEmbedding(imageFile: File | Buffer): Promise<number[]> {
    const formData = new FormData();
    
    if (imageFile instanceof Buffer) {
      // Node.js — convert Buffer to Uint8Array to satisfy BlobPart
      const blob = new Blob([new Uint8Array(imageFile)]);
      formData.append('image', blob, 'image.jpg');
    } else {
      // Browser
      formData.append('image', imageFile as File);
    }

    const response = await fetch(`${this.embeddingServiceUrl}/extract-embedding`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to extract embedding');
    }

    const data = await response.json();
    return data.embedding;
  }

  /**
   * Search for a face by file
   */
  async searchByFile(
    imageFile: File | Buffer,
    options: {
      topK?: number;
      threshold?: number;
    } = {}
  ): Promise<SearchResult> {
    const startTime = Date.now();
    const { topK = 5, threshold } = options;

    try {
      // Step 1: Extract embedding using Python service
      const embedding = await this.extractEmbedding(imageFile);

      // Step 2: Query Weaviate directly
      const collection = this.weaviateClient.collections.get(this.collectionName);
      
      const result = await collection.query.nearVector(embedding, {
        limit: topK * 10, // Get extra to group by person
        returnMetadata: ['distance']
      });

      // Step 3: Process results - group by personName
      const personMatches = new Map<string, FaceMatch>();

      for (const item of result.objects) {
        const personName = item.properties.personName as string;
        const distance = item.metadata?.distance || 1.0;

        // Apply threshold
        if (threshold !== undefined && distance > threshold) {
          continue;
        }

        // Keep best match per person
        if (!personMatches.has(personName) || distance < personMatches.get(personName)!.distance) {
          personMatches.set(personName, {
            personName,
            distance,
            confidence: (1 - distance) * 100,
          });
        }
      }

      // Sort by distance and take topK
      const allMatches = Array.from(personMatches.values())
        .sort((a, b) => a.distance - b.distance)
        .slice(0, topK);

      const searchTimeMs = Date.now() - startTime;

      return {
        found: allMatches.length > 0,
        topMatch: allMatches[0] || null,
        allMatches,
        searchTimeMs,
        facesDetected: 1,
      };

    } catch (error) {
      const searchTimeMs = Date.now() - startTime;
      
      if (error instanceof Error && error.message.includes('No face detected')) {
        return {
          found: false,
          topMatch: null,
          allMatches: [],
          searchTimeMs,
          facesDetected: 0,
        };
      }
      
      throw error;
    }
  }

  /**
   * Search by image path (Node.js only)
   */
  async searchByPath(
    imagePath: string,
    options: {
      topK?: number;
      threshold?: number;
    } = {}
  ): Promise<SearchResult> {
    if (typeof window !== 'undefined') {
      throw new Error('searchByPath is only available in Node.js');
    }

    const fs = await import('fs');
    const imageBuffer = fs.readFileSync(imagePath);

    return this.searchByFile(imageBuffer, options);
  }

  /**
   * Get embeddings for a person by name
   */
  async getPersonByName(personName: string): Promise<FaceMatch[]> {
    const collection = this.weaviateClient.collections.get(this.collectionName);
    
    const result = await collection.query.fetchObjects({
      filters: collection.filter.byProperty('personName').equal(personName),
      limit: 100
    });

    return result.objects.map(() => ({
      personName,
      distance: 0,
      confidence: 100,
    }));
  }

  /**
   * List all registered people (unique names)
   */
  async listPeople(limit: number = 100): Promise<Array<{
    personName: string;
    photoCount: number;
  }>> {
    const collection = this.weaviateClient.collections.get(this.collectionName);
    
    const result = await collection.query.fetchObjects({
      limit: 1000
    });

    // Group by personName
    const peopleMap = new Map<string, number>();
    
    for (const item of result.objects) {
      const personName = item.properties.personName as string;
      peopleMap.set(personName, (peopleMap.get(personName) || 0) + 1);
    }

    return Array.from(peopleMap.entries())
      .map(([personName, photoCount]) => ({ personName, photoCount }))
      .slice(0, limit);
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    totalEmbeddings: number;
    totalPeople: number;
  }> {
    const collection = this.weaviateClient.collections.get(this.collectionName);
    
    const aggregate = await collection.aggregate.overAll();

    const people = await this.listPeople(10000);

    return {
      totalEmbeddings: aggregate.totalCount,
      totalPeople: people.length
    };
  }

  /**
   * Delete a person from database by name
   */
  async deletePerson(personName: string): Promise<number> {
    const collection = this.weaviateClient.collections.get(this.collectionName);
    
    const result = await collection.data.deleteMany(
      collection.filter.byProperty('personName').equal(personName)
    );

    return result.successful;
  }
}