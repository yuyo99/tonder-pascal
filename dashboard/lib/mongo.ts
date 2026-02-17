import { MongoClient, Db, Collection, Document } from "mongodb";

let client: MongoClient | null = null;
let db: Db | null = null;

function getUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing MONGODB_URI env var");
  return uri;
}

function getDbName(): string {
  return process.env.DB_NAME || "pdn";
}

export async function connectMongo(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(getUri(), {
    maxPoolSize: 5,
    minPoolSize: 1,
    maxIdleTimeMS: 30_000,
    serverSelectionTimeoutMS: 5_000,
  });
  await client.connect();
  db = client.db(getDbName());
  return db;
}

export function getDatabase(): Db {
  if (!db) throw new Error("MongoDB not connected. Call connectMongo() first.");
  return db;
}

export function getCollection(name: string): Collection<Document> {
  return getDatabase().collection(name);
}
