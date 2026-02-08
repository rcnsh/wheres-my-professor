import type { Collection, Db, Document } from "mongodb";
import { MongoClient } from "mongodb";
import type { Env } from "./env";

/**
 * Cached client — persists across requests inside the same Worker isolate.
 * The Workers runtime may silently kill the underlying TCP socket between
 * requests, so we always validate before reuse.
 */
let cachedClient: MongoClient | null = null;

const MONGO_OPTIONS = {
  // Fail fast instead of hanging for the default 30 s
  serverSelectionTimeoutMS: 5_000,
  connectTimeoutMS: 5_000,
  socketTimeoutMS: 10_000,
  // Serverless — keep the pool tiny
  maxPoolSize: 1,
  minPoolSize: 0,
  maxIdleTimeMS: 10_000,
  retryWrites: true,
  retryReads: true,
};

/**
 * Returns a validated MongoClient, reconnecting if the cached one is stale.
 */
async function getClient(env: Env): Promise<MongoClient> {
  if (cachedClient) {
    try {
      // Race a quick admin ping against a 2 s timeout.
      // If the socket is dead the ping will hang — the timeout catches that.
      await Promise.race([
        cachedClient.db("admin").command({ ping: 1 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("ping timeout")), 2_000)
        ),
      ]);
      return cachedClient;
    } catch {
      // Stale connection — tear it down and fall through to reconnect
      cachedClient.close().catch(() => {});
      cachedClient = null;
    }
  }

  const client = new MongoClient(env.MONGODB_URI, MONGO_OPTIONS);
  await client.connect();
  cachedClient = client;
  return client;
}

export async function getDatabase(env: Env): Promise<Db> {
  const client = await getClient(env);
  return client.db(env.MONGODB_DB_NAME);
}

export async function getCollection<TSchema extends Document = Document>(
  env: Env,
  name?: string
): Promise<Collection<TSchema>> {
  const db = await getDatabase(env);
  const resolvedName = name ?? env.MONGODB_DEFAULT_COLLECTION ?? "records";
  return db.collection<TSchema>(resolvedName);
}
