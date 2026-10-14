/**
 * Re-draws any uploaded logo (SVG without a size, huge PNG, JPEG) as a 512px
 * square PNG with padding, and picks a patch color that contrasts with it.
 */
export async function prepareLogo(dataUrl: string): Promise<{ png: string; patch: string }> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { png: dataUrl, patch: "#ffffff" };
  // SVGs without width/height report 0 or 150; treat them as square.
  const w = image.naturalWidth || size;
  const h = image.naturalHeight || size;
  const scale = (size * 0.88) / Math.max(w, h);
  context.drawImage(image, (size - w * scale) / 2, (size - h * scale) / 2, w * scale, h * scale);

  const { data } = context.getImageData(0, 0, size, size);
  let lum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 16) {
    if (data[i + 3] < 128) continue;
    lum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    count += 1;
  }
  // A mostly light logo (white wordmark) goes on a dark patch; everything else on white.
  const patch = count && lum / count > 0.72 ? "#1a1a1a" : "#ffffff";
  return { png: canvas.toDataURL("image/png"), patch };
}

/**
 * Reads the two strongest colors from an uploaded logo: the most common
 * non-neutral color becomes the outfit, the next distinct one the accent.
 */
export async function brandColorsFromImage(dataUrl: string): Promise<{ primary?: string; accent?: string }> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();

  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return {};
  context.drawImage(image, 0, 0, size, size);
  const { data } = context.getImageData(0, 0, size, size);

  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 160) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // Skip near-white, near-black and grey pixels: backgrounds and outlines, not brand color.
    if (max > 235 && min > 225) continue;
    if (max - min < 28) continue;
    const key = `${r >> 5},${g >> 5},${b >> 5}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }

  const ranked = [...buckets.values()]
    .sort((x, y) => y.count - x.count)
    .map(({ count, r, g, b }) => [r / count, g / count, b / count] as const);
  const [first, ...rest] = ranked;
  if (!first) return {};
  const second = rest.find((color) => distance(color, first) > 90);
  return { primary: toHex(first), accent: second ? toHex(second) : undefined };
}

function distance(a: readonly number[], b: readonly number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function toHex([r, g, b]: readonly number[]) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}
