import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import sharp from 'sharp';

// Shared Uni Rocks artwork, not a separate Marketplace logo. Import the
// supplied square artwork once, then regenerate from the checked-in source.
// The artwork is preserved exactly and clipped to an app-icon silhouette;
// browsers do not apply CSS border radii to favicon images.
const publicRoot = new URL('../public/', import.meta.url);
const master = new URL('brand/uni-rocks-logo.png', publicRoot);
await mkdir(new URL('brand/', publicRoot), { recursive: true });
const input = process.argv[2] ?? fileURLToPath(master);
const source = await sharp(input).rotate().png().toBuffer(); // Strip source metadata.
const metadata = await sharp(source).metadata();
if (!metadata.width || metadata.width !== metadata.height) throw new Error('The Uni Rocks logo must be square');
if (process.argv[2]) await writeFile(master, source);

const iconSizes = [16, 32, 48, 96, 180, 192, 512];
const cornerRadiusRatio = 0.25;

async function renderRoundedIcon(size) {
  const radius = Math.max(1, Math.round(size * cornerRadiusRatio));
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
  );
  return sharp(source)
    .resize(size, size, { fit: 'fill' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

const icons = new Map(await Promise.all(iconSizes.map(async (size) => [size, await renderRoundedIcon(size)])));
await Promise.all([...icons].map(([size, data]) => writeFile(new URL(size === 180 ? 'apple-touch-icon.png' : `favicon-${size}x${size}.png`, publicRoot), data)));

// Standard ICO container with lossless PNG entries for browser compatibility.
const icoSizes = [16, 32, 48];
const header = Buffer.alloc(6 + icoSizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoSizes.forEach((size, index) => {
  const data = icons.get(size);
  const entry = 6 + index * 16;
  header[entry] = size;
  header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(data.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += data.length;
});
await writeFile(new URL('favicon.ico', publicRoot), Buffer.concat([header, ...icoSizes.map((size) => icons.get(size))]));
console.log('Generated rounded-square Uni Rocks PNG, Apple touch and ICO favicons.');
