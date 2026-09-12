import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import type { AppConfig } from '../config.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface UploadTicket { uploadUrl: string; tempKey: string; expiresAt: string; headers: Record<string, string>; }

export class StorageService {
  private s3?: S3Client;
  private localRoot = resolve(process.cwd(), '.data/uploads');
  constructor(private config: AppConfig) {
    if (config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY && config.R2_BUCKET_NAME) {
      this.s3 = new S3Client({ region: 'auto', endpoint: config.R2_ENDPOINT || `https://${config.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY }, requestChecksumCalculation: 'WHEN_REQUIRED' });
    }
  }

  async createUploadTicket(ownerId: string, listingId: string, mimeType: string, byteSize: number): Promise<UploadTicket> {
    if (!ALLOWED.has(mimeType)) throw new AppError(400, 'UNSUPPORTED_IMAGE', 'Only JPEG, PNG and WebP images are allowed');
    if (byteSize > this.config.MAX_IMAGE_SIZE_MB * 1024 * 1024) throw new AppError(413, 'IMAGE_TOO_LARGE', `Images must be ${this.config.MAX_IMAGE_SIZE_MB} MB or smaller`);
    const tempKey = `temporary/${ownerId}/${listingId}/${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    if (this.s3) {
      const ownershipHeaders = { 'x-amz-meta-owner': ownerId, 'x-amz-meta-listing': listingId };
      const command = new PutObjectCommand({ Bucket: this.config.R2_BUCKET_NAME, Key: tempKey, ContentType: mimeType, ContentLength: byteSize, Metadata: { owner: ownerId, listing: listingId } });
      return {
        uploadUrl: await getSignedUrl(this.s3, command, { expiresIn: 300, unhoistableHeaders: new Set(Object.keys(ownershipHeaders)) }),
        tempKey,
        expiresAt: expiresAt.toISOString(),
        headers: { 'content-type': mimeType, ...ownershipHeaders },
      };
    }
    if (this.config.NODE_ENV === 'production') throw new AppError(503, 'STORAGE_UNAVAILABLE', 'Image storage is not configured');
    const signature = this.sign(`${tempKey}:${expiresAt.getTime()}:${mimeType}:${byteSize}`);
    return { uploadUrl: `${this.config.API_URL}/api/uploads/local?key=${encodeURIComponent(tempKey)}&expires=${expiresAt.getTime()}&type=${encodeURIComponent(mimeType)}&size=${byteSize}&signature=${signature}`, tempKey, expiresAt: expiresAt.toISOString(), headers: { 'content-type': mimeType } };
  }

  async acceptLocalUpload(params: { key: string; expires: number; type: string; size: number; signature: string }, buffer: Buffer): Promise<void> {
    if (this.s3 || this.config.NODE_ENV === 'production') throw new AppError(404, 'NOT_FOUND', 'Upload endpoint not found');
    const expected = this.sign(`${params.key}:${params.expires}:${params.type}:${params.size}`);
    const left = Buffer.from(expected); const right = Buffer.from(params.signature);
    if (Date.now() > params.expires || left.length !== right.length || !timingSafeEqual(left, right) || !params.key.startsWith('temporary/') || params.key.includes('..')) throw new AppError(403, 'UPLOAD_EXPIRED', 'The upload link is invalid or expired');
    if (buffer.length !== params.size || buffer.length > this.config.MAX_IMAGE_SIZE_MB * 1024 * 1024) throw new AppError(400, 'UPLOAD_SIZE_MISMATCH', 'Uploaded file size did not match the request');
    const path = this.localPath(params.key); await mkdir(dirname(path), { recursive: true }); await writeFile(path, buffer, { flag: 'wx' });
  }

  async finalize(tempKey: string, ownerId: string, listingId: string, expectedByteSize: number, diagnosticId?: string): Promise<{ objectKey: string; mimeType: string; byteSize: number; width: number; height: number; sourceSha256: string; sourceProvenanceDetected: boolean }> {
    if (!tempKey.startsWith(`temporary/${ownerId}/${listingId}/`) || tempKey.includes('..')) throw new AppError(403, 'UPLOAD_FORBIDDEN', 'This upload does not belong to you');
    const startedAt = performance.now();
    const timings: Record<string, number> = {};
    const measure = (name: string, stageStartedAt: number) => { timings[name] = Math.round(performance.now() - stageStartedAt); };
    let outcome = 'succeeded';
    let cleanupPromise: Promise<void> | undefined;
    const startCleanup = () => {
      if (!cleanupPromise) {
        const cleanupStartedAt = performance.now();
        cleanupPromise = this.delete(tempKey).catch(() => undefined).finally(() => {
          measure(this.s3 ? 'r2DeleteMs' : 'localDeleteMs', cleanupStartedAt);
        });
      }
      return cleanupPromise;
    };
    let buffer: Buffer;
    try {
      if (this.s3) {
        let stageStartedAt = performance.now();
        const object = await this.s3.send(new GetObjectCommand({ Bucket: this.config.R2_BUCKET_NAME, Key: tempKey }));
        measure('r2GetHeadersMs', stageStartedAt);
        const contentLength = object.ContentLength ?? 0;
        if (object.Metadata?.owner !== ownerId || object.Metadata?.listing !== listingId || contentLength !== expectedByteSize || contentLength > this.config.MAX_IMAGE_SIZE_MB * 1024 * 1024) {
          (object.Body as { destroy?: () => void } | undefined)?.destroy?.();
          throw new AppError(400, 'INVALID_IMAGE', 'Image validation failed');
        }
        stageStartedAt = performance.now();
        buffer = Buffer.from(await object.Body!.transformToByteArray());
        measure('r2DownloadMs', stageStartedAt);
      } else {
        const stageStartedAt = performance.now();
        buffer = await readFile(this.localPath(tempKey));
        measure('localReadMs', stageStartedAt);
      }
      if (buffer.length !== expectedByteSize || buffer.length > this.config.MAX_IMAGE_SIZE_MB * 1024 * 1024) throw new AppError(400, 'UPLOAD_SIZE_MISMATCH', 'Uploaded file size did not match the request');
      let stageStartedAt = performance.now();
      const detected = await fileTypeFromBuffer(buffer);
      measure('signatureMs', stageStartedAt);
      if (!detected || !ALLOWED.has(detected.mime)) throw new AppError(400, 'INVALID_IMAGE_SIGNATURE', 'The file is not a supported image');
      const input = sharp(buffer, { failOn: 'error', limitInputPixels: false });
      stageStartedAt = performance.now();
      const metadata = await input.metadata();
      measure('metadataMs', stageStartedAt);
      if (!metadata.width || !metadata.height) throw new AppError(400, 'INVALID_IMAGE', 'Image validation failed');
      const pipeline = input.rotate().resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 });
      stageStartedAt = performance.now();
      const { data: sanitized, info: finalMeta } = await pipeline.toBuffer({ resolveWithObject: true });
      measure('transformMs', stageStartedAt);
      const objectKey = `listings/${listingId}/${randomUUID()}.webp`;
      stageStartedAt = performance.now();
      void startCleanup();
      if (this.s3) {
        await this.s3.send(new PutObjectCommand({ Bucket: this.config.R2_BUCKET_NAME, Key: objectKey, Body: sanitized, ContentType: 'image/webp', ContentLength: sanitized.length, Metadata: { owner: ownerId, listing: listingId, private: 'true' } }));
        measure('r2PutMs', stageStartedAt);
      } else {
        const path = this.localPath(objectKey); await mkdir(dirname(path), { recursive: true }); await writeFile(path, sanitized, { flag: 'wx' });
        measure('localWriteMs', stageStartedAt);
      }
      return { objectKey, mimeType: 'image/webp', byteSize: sanitized.length, width: finalMeta.width, height: finalMeta.height, sourceSha256: createHash('sha256').update(buffer).digest('hex'), sourceProvenanceDetected: Boolean(metadata.xmp || metadata.exif || metadata.iptc) };
    } catch (error) {
      outcome = error instanceof AppError ? error.code : 'failed';
      throw error;
    } finally {
      await startCleanup();
      const totalMs = Math.round(performance.now() - startedAt);
      const details = { diagnosticId, outcome, totalMs, timings };
      if (totalMs >= 1_000) logger.warn(details, 'slow listing image finalize');
      else logger.debug(details, 'listing image finalize');
    }
  }

  async signedReadUrl(objectKey: string): Promise<string> {
    if (!objectKey.startsWith('listings/') || objectKey.includes('..')) throw new AppError(400, 'INVALID_OBJECT_KEY', 'Invalid image key');
    if (this.s3) return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.config.R2_BUCKET_NAME, Key: objectKey }), { expiresIn: 300 });
    const expires = Date.now() + 5 * 60_000; const signature = this.sign(`${objectKey}:${expires}`);
    return `${this.config.API_URL}/api/uploads/local-read?key=${encodeURIComponent(objectKey)}&expires=${expires}&signature=${signature}`;
  }

  async readLocal(key: string, expires: number, signature: string): Promise<Buffer> {
    const expected = this.sign(`${key}:${expires}`); const left = Buffer.from(expected); const right = Buffer.from(signature);
    if (this.s3 || Date.now() > expires || left.length !== right.length || !timingSafeEqual(left, right) || !key.startsWith('listings/') || key.includes('..')) throw new AppError(403, 'IMAGE_URL_EXPIRED', 'Image link is invalid or expired');
    return readFile(this.localPath(key));
  }

  async delete(key: string): Promise<void> {
    if (key.includes('..') || (!key.startsWith('temporary/') && !key.startsWith('listings/'))) return;
    if (this.s3) await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.R2_BUCKET_NAME, Key: key }));
    else await rm(this.localPath(key), { force: true });
  }

  private sign(value: string): string { return createHmac('sha256', this.config.SESSION_SECRET).update(value).digest('base64url'); }
  private localPath(key: string): string { return resolve(this.localRoot, key); }
}
