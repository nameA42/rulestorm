import type { FieldImage } from '../rules/field/NoiseFieldRules';

/**
 * Turn a user's picture into a small, blurred RGB grid the noise field can
 * sample. Small on purpose: it travels to every peer in multiplayer.
 */
export async function fileToFieldImage(file: Blob, size = 64): Promise<FieldImage> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // Cover-fit the centre square.
  const s = Math.min(bmp.width, bmp.height);
  ctx.filter = 'blur(1.5px)';
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  bmp.close();
  const px = ctx.getImageData(0, 0, size, size).data;
  const data: number[] = new Array(size * size * 3);
  for (let i = 0, o = 0; i < px.length; i += 4) {
    data[o++] = px[i];
    data[o++] = px[i + 1];
    data[o++] = px[i + 2];
  }
  return { w: size, h: size, data: boxBlur(data, size, size, 2) };
}

function boxBlur(src: number[], w: number, h: number, r: number): number[] {
  const out = src.slice();
  for (let pass = 0; pass < 2; pass++) {
    const tmp = out.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let ch = 0; ch < 3; ch++) {
          let sum = 0, n = 0;
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const xx = x + dx, yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              sum += tmp[(yy * w + xx) * 3 + ch];
              n++;
            }
          }
          out[(y * w + x) * 3 + ch] = Math.round(sum / n);
        }
      }
    }
  }
  return out;
}
