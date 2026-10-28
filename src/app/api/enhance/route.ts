import sharp from "sharp";

const maximumFileSize = 25 * 1024 * 1024;
const maximumInputPixels = 100_000_000;
const maximumOutputPixels = 100_000_000;

function readNumber(formData: FormData, key: string): number | null {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function badRequest(error: string, status: number) {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return badRequest("invalidRequest", 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return badRequest("missingImage", 400);
  if (file.size === 0) return badRequest("emptyImage", 400);
  if (file.size > maximumFileSize) return badRequest("imageTooLarge", 413);
  if (file.type !== "image/png" && file.type !== "image/jpeg") {
    return badRequest("unsupportedImageType", 415);
  }

  const sharpen = readNumber(formData, "sharpen");
  const brightness = readNumber(formData, "brightness");
  const contrast = readNumber(formData, "contrast");
  const scale = readNumber(formData, "scale");
  const quality = readNumber(formData, "quality");
  const upscaleValue = formData.get("upscale");
  const upscale = upscaleValue === "true";

  if (
    sharpen === null || sharpen < 0 || sharpen > 3 ||
    brightness === null || brightness < 0.5 || brightness > 1.5 ||
    contrast === null || contrast < 0.5 || contrast > 1.5 ||
    scale === null || scale < 25 || scale > (upscale ? 200 : 100) ||
    quality === null || quality < 0.5 || quality > 1 ||
    (upscaleValue !== "true" && upscaleValue !== "false")
  ) {
    return badRequest("invalidSettings", 400);
  }

  try {
    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, { limitInputPixels: maximumInputPixels });
    const metadata = await image.metadata();

    if (metadata.format !== "jpeg" && metadata.format !== "png") {
      return badRequest("unsupportedImageType", 415);
    }
    if (!metadata.width || !metadata.height) {
      return badRequest("invalidImage", 422);
    }

    const swapsDimensions = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
    const width = swapsDimensions ? metadata.height : metadata.width;
    const height = swapsDimensions ? metadata.width : metadata.height;
    const outputWidth = Math.max(1, Math.round(width * scale / 100));
    const outputHeight = Math.max(1, Math.round(height * scale / 100));
    if (outputWidth * outputHeight > maximumOutputPixels) {
      return badRequest("outputTooLarge", 413);
    }

    let pipeline = sharp(input, { limitInputPixels: maximumInputPixels })
      .rotate()
      .modulate({ brightness })
      .linear(contrast, 128 * (1 - contrast));

    if (sharpen > 0) pipeline = pipeline.sharpen({ sigma: 0.3 + sharpen });

    const output = await pipeline
      .resize(outputWidth, outputHeight)
      .webp({ quality: Math.round(quality * 100) })
      .toBuffer();

    return new Response(new Uint8Array(output), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return badRequest("imageProcessingFailed", 422);
  }
}
