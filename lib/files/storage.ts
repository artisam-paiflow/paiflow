import "server-only";
import { createReadStream, createWriteStream, existsSync, mkdirSync } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type StoredObject = {
  key: string;
  size: number;
  contentType: string;
};

export interface FileStorage {
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<{ stream: NodeJS.ReadableStream; size: number }>;
  remove(key: string): Promise<void>;
}

class VolumeStorage implements FileStorage {
  constructor(private root: string) {
    mkdirSync(root, { recursive: true });
  }
  private path(key: string) {
    if (!/^[a-zA-Z0-9._/-]+$/.test(key)) throw new Error("Invalid storage key");
    const p = resolve(this.root, key);
    if (!p.startsWith(resolve(this.root))) throw new Error("Path traversal");
    mkdirSync(resolve(p, ".."), { recursive: true });
    return p;
  }
  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const p = this.path(key);
    await pipeline(Readable.from(body), createWriteStream(p));
    return { key, size: body.byteLength, contentType };
  }
  async get(key: string) {
    const p = this.path(key);
    if (!existsSync(p)) throw new Error("Not found");
    const s = await stat(p);
    return { stream: createReadStream(p), size: s.size };
  }
  async remove(key: string) {
    const p = this.path(key);
    if (existsSync(p)) await unlink(p);
  }
}

class MinioStorage implements FileStorage {
  private clientPromise: Promise<import("minio").Client>;
  constructor(
    private bucket: string,
    endpointUrl: string,
    accessKey: string,
    secretKey: string,
  ) {
    this.clientPromise = (async () => {
      const { Client } = await import("minio");
      const u = new URL(endpointUrl);
      const client = new Client({
        endPoint: u.hostname,
        port: u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80,
        useSSL: u.protocol === "https:",
        accessKey,
        secretKey,
      });
      const exists = await client.bucketExists(bucket).catch(() => false);
      if (!exists) await client.makeBucket(bucket, "us-east-1");
      return client;
    })();
  }
  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const client = await this.clientPromise;
    await client.putObject(this.bucket, key, body, body.byteLength, {
      "Content-Type": contentType,
    });
    return { key, size: body.byteLength, contentType };
  }
  async get(key: string) {
    const client = await this.clientPromise;
    const stream = await client.getObject(this.bucket, key);
    const stat = await client.statObject(this.bucket, key);
    return { stream, size: stat.size };
  }
  async remove(key: string) {
    const client = await this.clientPromise;
    await client.removeObject(this.bucket, key);
  }
}

let cached: FileStorage | null = null;
export function storage(): FileStorage {
  if (cached) return cached;
  const driver = process.env.FILE_STORAGE_DRIVER ?? "volume";
  if (driver === "minio") {
    cached = new MinioStorage(
      process.env.MINIO_BUCKET ?? "pinkraft",
      process.env.MINIO_ENDPOINT ?? "http://localhost:9000",
      process.env.MINIO_ACCESS_KEY ?? "",
      process.env.MINIO_SECRET_KEY ?? "",
    );
  } else {
    const root = process.env.FILE_STORAGE_PATH ?? join(process.cwd(), ".docker", "files");
    cached = new VolumeStorage(root);
  }
  return cached;
}
