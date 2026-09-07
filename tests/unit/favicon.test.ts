import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

const publicRoot = new URL('../../apps/web/public/', import.meta.url);

describe('shared Uni Rocks favicon assets', () => {
  it.each([16, 32, 48, 96, 180])('derives the %ipx icon from the same Uni Rocks master', async (size) => {
    const master = new URL('brand/uni-rocks-logo.png', publicRoot);
    const icon = await readFile(new URL(size === 180 ? 'apple-touch-icon.png' : `favicon-${size}x${size}.png`, publicRoot));
    const metadata = await sharp(icon).metadata();
    expect(metadata).toMatchObject({ format: 'png', width: size, height: size });
    expect(metadata.exif).toBeUndefined();
    expect(icon.equals(await sharp(await readFile(master)).resize(size, size).png().toBuffer())).toBe(true);
  });

  it('packages the same artwork into a valid multi-size ICO', async () => {
    const ico = await readFile(new URL('favicon.ico', publicRoot));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
    for (const [index, size] of [16, 32, 48].entries()) {
      const entry = 6 + index * 16;
      expect(ico[entry]).toBe(size);
      expect(ico[entry + 1]).toBe(size);
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(ico.subarray(offset, offset + length).equals(await readFile(new URL(`favicon-${size}x${size}.png`, publicRoot)))).toBe(true);
    }
  });
});
