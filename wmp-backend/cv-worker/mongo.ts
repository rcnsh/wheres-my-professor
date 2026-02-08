import type { Collection, Db, Document } from "mongodb";
import { MongoClient } from "mongodb";
import type { Env } from "./env";

let mongoClient: MongoClient | null = null;
let database: Db | null = null;

async function ensureClient(env: Env): Promise<MongoClient> {
  if (mongoClient) return mongoClient;

  mongoClient = new MongoClient(env.MONGODB_URI);
  await mongoClient.connect();
  database = mongoClient.db(env.MONGODB_DB_NAME);
  return mongoClient;
}

export async function getDatabase(env: Env): Promise<Db> {
  if (!database) {
    await ensureClient(env);
  }

  if (!database) {
    throw new Error("Mongo database reference could not be initialised.");
  }

  return database;
}

export async function getCollection<TSchema extends Document = Document>(
  env: Env,
  name?: string
): Promise<Collection<TSchema>> {
  const db = await getDatabase(env);
  const resolvedName = name ?? env.MONGODB_DEFAULT_COLLECTION ?? "records";
  return db.collection<TSchema>(resolvedName);
}
