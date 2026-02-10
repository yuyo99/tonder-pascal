import { MongoClient, Db, Collection, Document } from "mongodb";
import { config } from "../config";
import { logger } from "../utils/logger";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(): Promise<void> {
  if (db) return;
  client = new MongoClient(config.mongodb.uri, {
    maxPoolSize: 10,
    minPoolSize: 2,
    maxIdleTimeMS: 30000,
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  db = client.db(config.mongodb.dbName);
  logger.info("MongoDB connected");
}

export function getDatabase(): Db {
  if (!db) throw new Error("MongoDB not connected. Call connectMongo() first.");
  return db;
}

export function getCollection(name: string): Collection<Document> {
  return getDatabase().collection(name);
}

export async function disconnectMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info("MongoDB disconnected");
  }
}
