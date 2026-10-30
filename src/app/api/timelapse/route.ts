import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "fluent-ffmpeg";

const maximumFileSize = 250 * 1024 * 1024;
const ffmpegPath: string | null = createRequire(join(process.cwd(), "package.json"))("ffmpeg-static");
const allowedExtensions = new Set([
  ".3gp", ".avi", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".webm",
]);
const allowedSpeeds = new Set([2, 4, 8, 16]);

function badRequest(error: string, status: number) {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  if (!ffmpegPath) {
    console.error("FFmpeg binary path is unavailable.");
    return badRequest("processingUnavailable", 500);
  }
  const resolvedFfmpegPath = ffmpegPath;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return badRequest("invalidRequest", 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return badRequest("missingVideo", 400);
  if (file.size === 0) return badRequest("emptyVideo", 400);
  if (file.size > maximumFileSize) return badRequest("videoTooLarge", 413);

  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!allowedExtensions.has(extension) || (file.type !== "" && !file.type.startsWith("video/"))) {
    return badRequest("unsupportedVideoType", 415);
  }

  const speed = Number(formData.get("speed"));
  if (!allowedSpeeds.has(speed)) return badRequest("invalidSpeed", 400);

  let temporaryDirectory: string;
  try {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "nhloc-timelapse-"));
  } catch (error) {
    console.error("Could not create a temporary directory for video processing:", error);
    return badRequest("processingUnavailable", 500);
  }

  let keepTemporaryDirectory = false;
  try {
    const inputPath = join(temporaryDirectory, `input${extension}`);
    const outputPath = join(temporaryDirectory, "timelapse.mp4");
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .setFfmpegPath(resolvedFfmpegPath)
        .videoFilters(`setpts=PTS/${speed}`)
        .noAudio()
        .videoCodec("libx264")
        .outputOptions(["-preset", "veryfast", "-crf", "23", "-movflags", "+faststart"])
        .format("mp4")
        .on("error", reject)
        .on("end", () => resolve())
        .save(outputPath);
    });

    const outputStats = await stat(outputPath);
    if (outputStats.size === 0) throw new Error("FFmpeg produced an empty output file.");

    const outputStream = createReadStream(outputPath);
    keepTemporaryDirectory = true;
    outputStream.once("close", () => {
      void rm(temporaryDirectory, { recursive: true, force: true }).catch((error: unknown) => {
        console.error("Could not clean up temporary video files:", error);
      });
    });

    const outputIterator = outputStream[Symbol.asyncIterator]();
    const outputBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await outputIterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel() {
        outputStream.destroy();
      },
    });

    return new Response(outputBody, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(outputStats.size),
        "Content-Disposition": 'attachment; filename="timelapse.mp4"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Video time-lapse processing failed:", error);
    return badRequest("videoProcessingFailed", 422);
  } finally {
    if (!keepTemporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch((error: unknown) => {
        console.error("Could not clean up temporary video files:", error);
      });
    }
  }
}
