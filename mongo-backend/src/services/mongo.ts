import type { Collection, Db, Document } from 'mongodb';
import { MongoClient } from 'mongodb';

let mongoClient: MongoClient | null = null;
let database: Db | null = null;

async function ensureClient(): Promise<MongoClient> {
  if (mongoClient) return mongoClient;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('Missing MONGODB_URI environment variable.');
  }

  console.log(uri);

  mongoClient = new MongoClient(uri);
  await mongoClient.connect();

  const dbName = process.env.MONGODB_DB_NAME;
  if (!dbName) {
    throw new Error('Missing MONGODB_DB_NAME environment variable.');
  }

  database = mongoClient.db(dbName);
  return mongoClient;
}

export async function getDatabase(): Promise<Db> {
  if (!database) {
    await ensureClient();
  }

  if (!database) {
    throw new Error('Mongo database reference could not be initialised.');
  }

  return database;
}

export async function getCollection<TSchema extends Document = Document>(name?: string): Promise<Collection<TSchema>> {
  const db = await getDatabase();
  const resolvedName = name ?? process.env.MONGODB_DEFAULT_COLLECTION ?? 'records';
  return db.collection<TSchema>(resolvedName);
}

export async function closeMongo(): Promise<void> {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
    database = null;
  }
}
