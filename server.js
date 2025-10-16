import path from "path";
import express from "express";
import dotenv from "dotenv";
import Replicate from "replicate";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_MODEL_KEY = (process.env.REPLICATE_DEFAULT_MODEL_KEY || "seedream").toLowerCase();
const REFINE_MODEL_VERSION = process.env.REPLICATE_REFINE_MODEL_VERSION;

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const MODEL_CONFIG = {
  seedream: {
    envKey: "REPLICATE_SEEDREAM_VERSION",
    version: process.env.REPLICATE_SEEDREAM_VERSION || process.env.REPLICATE_MODEL_VERSION,
  },
  "nano-banana": {
    envKey: "REPLICATE_NANO_BANANA_VERSION",
    version: process.env.REPLICATE_NANO_BANANA_VERSION,
  },
};

const DIMENSION_LIMITS = { min: 1024, max: 4096 };
const MAX_IMAGES_LIMITS = { min: 1, max: 15 };

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeText = (value) =>
  typeof value === "string" ? value.trim() : "";

const extractTextOutput = (prediction) => {
  if (!prediction) return "";

  const candidates = [];

  if (typeof prediction.output === "string") {
    candidates.push(prediction.output);
  }

  if (Array.isArray(prediction.output)) {
    for (const item of prediction.output) {
      if (typeof item === "string") {
        candidates.push(item);
      } else if (item && typeof item === "object") {
        if (typeof item.text === "string") {
          candidates.push(item.text);
        }
        if (typeof item.message === "string") {
          candidates.push(item.message);
        }
        if (Array.isArray(item.content)) {
          for (const piece of item.content) {
            if (typeof piece === "string") {
              candidates.push(piece);
            } else if (piece && typeof piece === "object" && typeof piece.text === "string") {
              candidates.push(piece.text);
            }
          }
        }
      }
    }
  }

  if (typeof prediction.output_text === "string") {
    candidates.push(prediction.output_text);
  }

  if (typeof prediction.logs === "string") {
    candidates.push(prediction.logs.split("\n").slice(-5).join(" "));
  }

  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (text) return text;
  }

  return "";
};

const normalizeRunOutput = async (value) => {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => normalizeRunOutput(item)));
  }

  if (typeof value === "object") {
    if (typeof value.url === "function") {
      try {
        return await value.url();
      } catch (error) {
        console.warn("Failed to resolve file output URL", error);
      }
    }

    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      return value;
    }

    const entries = await Promise.all(
      Object.entries(value).map(async ([key, subValue]) => [key, await normalizeRunOutput(subValue)]),
    );
    return Object.fromEntries(entries);
  }

  return value;
};

app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/predictions", async (req, res) => {
  try {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      return res
        .status(500)
        .json({ error: "Missing REPLICATE_API_TOKEN in environment." });
    }

    const body = req.body || {};
    const rawModelKey = typeof body.model_key === "string" ? body.model_key : undefined;
    const modelKey = (rawModelKey || DEFAULT_MODEL_KEY).toLowerCase();
    const config = MODEL_CONFIG[modelKey];

    if (!config) {
      return res.status(400).json({
        error: `Unsupported model key "${modelKey}".`,
      });
    }

    if (!config.version) {
      const envHint =
        modelKey === "seedream"
          ? "REPLICATE_SEEDREAM_VERSION (or legacy REPLICATE_MODEL_VERSION)"
          : config.envKey || "model version environment variable";

      return res.status(500).json({
        error: `Missing ${envHint} for model "${modelKey}".`,
      });
    }

    const promptValue = typeof body.prompt === "string" ? body.prompt : "";
    const trimmedPrompt = promptValue.trim();

    if (!trimmedPrompt) {
      return res.status(400).json({ error: 'Field "prompt" is required.' });
    }

    const imageInput = Array.isArray(body.image_input)
      ? body.image_input.filter((item) => typeof item === "string" && item.trim())
      : [];

    let inputPayload = { prompt: trimmedPrompt };

    if (modelKey === "seedream") {
      const rawSize = typeof body.size === "string" ? body.size : "2K";
      const trimmedSize = typeof rawSize === "string" ? rawSize.trim() : "";
      const lowerSize = trimmedSize.toLowerCase();
      const upperSize = trimmedSize.toUpperCase();
      const size =
        lowerSize === "custom"
          ? "custom"
          : ["1K", "2K", "4K"].includes(upperSize)
            ? upperSize
            : "2K";
      const aspectRatio =
        typeof body.aspect_ratio === "string" ? body.aspect_ratio : "match_input_image";
      const sequential =
        typeof body.sequential_image_generation === "string"
          ? body.sequential_image_generation
          : "disabled";
      const parsedMaxImages = Number.parseInt(body.max_images, 10);
      const maxImages = Number.isNaN(parsedMaxImages)
        ? 1
        : clampNumber(parsedMaxImages, MAX_IMAGES_LIMITS.min, MAX_IMAGES_LIMITS.max);

      inputPayload = {
        prompt: trimmedPrompt,
        size,
        aspect_ratio: aspectRatio,
        sequential_image_generation: sequential,
        max_images: maxImages,
      };

      if (size === "custom") {
        const parsedWidth = Number.parseInt(body.width, 10);
        const parsedHeight = Number.parseInt(body.height, 10);

        if (!Number.isNaN(parsedWidth)) {
          inputPayload.width = clampNumber(parsedWidth, DIMENSION_LIMITS.min, DIMENSION_LIMITS.max);
        }

        if (!Number.isNaN(parsedHeight)) {
          inputPayload.height = clampNumber(
            parsedHeight,
            DIMENSION_LIMITS.min,
            DIMENSION_LIMITS.max,
          );
        }
      }

      if (imageInput.length > 0) {
        inputPayload.image_input = imageInput;
      }
    } else {
      const aspectRatio = typeof body.aspect_ratio === "string" ? body.aspect_ratio : "16:9";
      const outputFormat = typeof body.output_format === "string" ? body.output_format : "jpg";

      inputPayload = {
        prompt: trimmedPrompt,
        aspect_ratio: aspectRatio,
        output_format: outputFormat,
      };

      if (imageInput.length > 0) {
        inputPayload.image_input = imageInput;
      }
    }

    const startedAt = Date.now();
    const rawOutput = await replicate.run(config.version, {
      input: inputPayload,
    });

    const output = await normalizeRunOutput(rawOutput);
    const elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(2));

    return res.json({
      elapsed_seconds: elapsedSeconds,
      prediction: {
        status: "succeeded",
        output,
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      return res.status(error.status || 500).json({
        error: error.message || "Replicate request failed.",
        details: error.details,
      });
    }
    console.error("[/api/predictions] unexpected error:", error);
    return res.status(500).json({
      error: "Unexpected server error.",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post("/api/refine", async (req, res) => {
  try {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      return res
        .status(500)
        .json({ error: "Missing REPLICATE_API_TOKEN in environment." });
    }

    if (!REFINE_MODEL_VERSION) {
      return res.status(500).json({
        error:
          "Missing REPLICATE_REFINE_MODEL_VERSION in environment. Set it to the latest version id for openai/gpt-5-mini.",
      });
    }

    const promptValue = typeof req.body?.prompt === "string" ? req.body.prompt : "";
    const trimmedPrompt = promptValue.trim();

    if (!trimmedPrompt) {
      return res.status(400).json({ error: 'Field "prompt" is required.' });
    }

    const refineInput = {
      messages: [
        {
          role: "system",
          content:
            "You are an expert prompt engineer for text-to-image diffusion models. Refine prompts for clarity, vivid detail, and photo-realism while preserving the original intent. Respond with the improved prompt only.",
        },
        {
          role: "user",
          content: trimmedPrompt,
        },
      ],
      max_output_tokens: 400,
      temperature: 0.3,
      top_p: 0.9,
      prompt: `Refine the following image-generation prompt while keeping its core intent intact. Respond with the improved prompt only.\n\n${trimmedPrompt}`,
    };

    const startedAt = Date.now();
    const rawOutput = await replicate.run(REFINE_MODEL_VERSION, {
      input: refineInput,
    });

    const output = await normalizeRunOutput(rawOutput);
    const elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(2));
    const prediction = {
      status: "succeeded",
      output,
    };

    let refinedPrompt = normalizeText(extractTextOutput(prediction));
    if (!refinedPrompt) {
      refinedPrompt = trimmedPrompt;
    }

    return res.json({
      refined_prompt: refinedPrompt,
      elapsed_seconds: elapsedSeconds,
      prediction,
    });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      return res.status(error.status || 500).json({
        error: error.message || "Replicate request failed.",
        details: error.details,
      });
    }

    console.error("[/api/refine] unexpected error:", error);
    return res.status(500).json({
      error: "Unexpected server error.",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Nano Banana playground running at http://localhost:${PORT}`);
});
