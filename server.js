import path from "path";
import express from "express";
import dotenv from "dotenv";
import Replicate from "replicate";
import { GoogleGenAI } from "@google/genai";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_MODEL_KEY = (process.env.REPLICATE_DEFAULT_MODEL_KEY || "nano-banana").toLowerCase();
const REFINE_MODEL_VERSION = process.env.REPLICATE_REFINE_MODEL_VERSION;

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Initialize GoogleGenAI only if API key is available
let genAI = null;
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} else {
  console.warn("⚠️ GEMINI_API_KEY not set - nano-banana model will not work");
}

// In-memory store for async predictions
const predictions = new Map();

const MODEL_CONFIG = {
  seedream: {
    envKey: "REPLICATE_SEEDREAM_VERSION",
    version: process.env.REPLICATE_SEEDREAM_VERSION || process.env.REPLICATE_MODEL_VERSION,
  },
  "nano-banana": {
    envKey: "REPLICATE_NANO_BANANA_VERSION",
    version: "google/nano-banana-pro",
  },
  "remove-bg": {
    envKey: "REPLICATE_REMOVE_BG_VERSION",
    version: "cjwbw/rembg:fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003",
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
    const logSections = prediction.logs
      .split(/\n\s*\n/)
      .map((section) => section.trim())
      .filter(Boolean);
    for (const section of logSections) {
      const cleanedSection = section.replace(/^output:\s*/i, "").trim();
      const hashedMatch = cleanedSection.match(/hash=[a-f0-9]+\s+output="([^"]+)"/i);
      if (hashedMatch?.[1]) {
        candidates.push(hashedMatch[1]);
        continue;
      }
      if (cleanedSection) {
        candidates.push(cleanedSection);
      }
    }
  }

  const combined = normalizeText(candidates.join("\n\n"));
  if (combined) {
    return combined;
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

const collectTextSegments = (value, acc) => {
  if (typeof value === "string") {
    const text = value.trim();
    if (text) acc.push(text);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectTextSegments(item, acc));
    return;
  }

  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => collectTextSegments(entry, acc));
  }
};

app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Health check endpoint for Cloudflare and load balancers
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/api/predictions", async (req, res) => {
  try {
    const body = req.body || {};
    const rawModelKey = typeof body.model_key === "string" ? body.model_key : undefined;
    const modelKey = (rawModelKey || DEFAULT_MODEL_KEY).toLowerCase();

    // Handle nano-banana with Gemini API (async processing)
    if (modelKey === "nano-banana") {
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        return res
          .status(500)
          .json({ error: "Missing GEMINI_API_KEY in environment." });
      }

      const promptValue = typeof body.prompt === "string" ? body.prompt : "";
      const trimmedPrompt = promptValue.trim();

      if (!trimmedPrompt) {
        return res.status(400).json({ error: 'Field "prompt" is required.' });
      }

      // Create prediction ID
      const predictionId = `gemini-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const createdAt = new Date().toISOString();

      // Initialize prediction in store
      const prediction = {
        id: predictionId,
        status: "processing",
        output: null,
        created_at: createdAt,
        completed_at: null,
        elapsed_seconds: null,
      };

      predictions.set(predictionId, prediction);

      // Start async processing
      // wrap in setImmediate to return response first
      setImmediate(async () => {
        try {
          // Parse parameters
          const aspectRatio = typeof body.aspect_ratio === "string" ? body.aspect_ratio : "4:3";
          const imageSize = typeof body.image_size === "string" ? body.image_size : "1K";
          const candidateCount = typeof body.candidateCount === "number" ? body.candidateCount : 1;

          // Parse image input
          const imageInput = Array.isArray(body.image_input)
            ? body.image_input.filter((item) => typeof item === "string" && item.trim())
            : [];

          // Build contents
          const parts = [{ text: trimmedPrompt }];

          if (imageInput.length > 0) {
            for (const imageData of imageInput) {
              const match = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
              if (match) {
                const [, mimeType, base64Data] = match;
                parts.push({
                  inlineData: {
                    mimeType: `image/${mimeType}`,
                    data: base64Data
                  }
                });
              }
            }
          }

          const contents = [{ role: 'user', parts }];

          // Configure model
          const config = {
            responseModalities: ['IMAGE'],
            imageConfig: {
              imageSize: imageSize,
              aspectRatio: aspectRatio,
            },
          };

          console.log(`[${predictionId}] Starting Gemini API call...`);

          const response = await genAI.models.generateContentStream({
            model: "gemini-3-pro-image-preview",
            config: config,
            contents: contents,
          });

          // Extract image data from stream response
          let imageUrls = [];
          for await (const chunk of response) {
            // Force yield to event loop to allow polling requests to be answered
            await new Promise((resolve) => setTimeout(resolve, 0));

            if (chunk.candidates && chunk.candidates[0].content && chunk.candidates[0].content.parts) {
              for (const part of chunk.candidates[0].content.parts) {
                if (part.inlineData) {
                  const mimeType = part.inlineData.mimeType || "image/png";
                  const data = part.inlineData.data;
                  imageUrls.push(`data:${mimeType};base64,${data}`);
                }
              }
            }
          }

          const elapsedSeconds = Number(((Date.now() - startTime) / 1000).toFixed(2));

          // Update prediction with success
          const storedPrediction = predictions.get(predictionId);
          if (storedPrediction) {
            storedPrediction.status = "succeeded";
            storedPrediction.output = imageUrls.length > 0 ? imageUrls : null;
            storedPrediction.completed_at = new Date().toISOString();
            storedPrediction.elapsed_seconds = elapsedSeconds;
            console.log(`[${predictionId}] Generation completed successfully`);
          }
        } catch (geminiError) {
          console.error(`[${predictionId}] Gemini API error:`);
          console.error("Error type:", typeof geminiError);
          console.error("Error:", geminiError);
          console.error("Error message:", geminiError?.message);

          // Update prediction with error
          const storedPrediction = predictions.get(predictionId);
          if (storedPrediction) {
            storedPrediction.status = "failed";
            storedPrediction.error = geminiError instanceof Error ? geminiError.message : String(geminiError);
            storedPrediction.completed_at = new Date().toISOString();
            storedPrediction.elapsed_seconds = Number(((Date.now() - startTime) / 1000).toFixed(2));
          }
        }
      });

      // Return immediately with processing status
      return res.status(201).json({ prediction });
    }

    // Handle other models with Replicate API
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      return res
        .status(500)
        .json({ error: "Missing REPLICATE_API_TOKEN in environment." });
    }

    const config = MODEL_CONFIG[modelKey];

    if (!config) {
      return res.status(400).json({
        error: `Unsupported model key "${modelKey}".`,
      });
    }

    const promptValue = typeof body.prompt === "string" ? body.prompt : "";
    const trimmedPrompt = promptValue.trim();

    if (modelKey !== "remove-bg" && !trimmedPrompt) {
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
    } else if (modelKey === "remove-bg") {
      const imageInput = body.image ? body.image : body.image_url;
      const contentModeration = body.content_moderation === true;
      const preservePartialAlpha = body.preserve_partial_alpha === true;

      inputPayload = {
        image: imageInput,
        content_moderation: contentModeration,
        preserve_partial_alpha: preservePartialAlpha,
      };
    } else {
      const aspectRatio = typeof body.aspect_ratio === "string" ? body.aspect_ratio : "4:3";
      const resolution = typeof body.resolution === "string" ? body.resolution : "2K";
      const outputFormat = typeof body.output_format === "string" ? body.output_format : "png";
      const safetyFilterLevel = typeof body.safety_filter_level === "string" ? body.safety_filter_level : "block_only_high";

      inputPayload = {
        prompt: trimmedPrompt,
        aspect_ratio: aspectRatio,
        resolution: resolution,
        output_format: outputFormat,
        safety_filter_level: safetyFilterLevel,
      };

      if (imageInput.length > 0) {
        inputPayload.image_input = imageInput;
      }
    }

    const prediction = await replicate.predictions.create({
      version: config.version,
      input: inputPayload,
    });

    return res.status(201).json({ prediction });
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

app.get("/api/predictions/:id", async (req, res) => {
  try {
    const predictionId = req.params.id;

    // Check if it's a Gemini prediction (in-memory)
    if (predictionId.startsWith("gemini-")) {
      const prediction = predictions.get(predictionId);
      if (prediction) {
        return res.json({ prediction });
      } else {
        return res.status(404).json({ error: "Prediction not found" });
      }
    }

    // Otherwise, fetch from Replicate
    const prediction = await replicate.predictions.get(predictionId);

    if (prediction.status === "succeeded") {
      const output = await normalizeRunOutput(prediction.output);
      return res.json({
        prediction: {
          ...prediction,
          output,
        },
      });
    }

    return res.json({ prediction });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      return res.status(error.status || 500).json({
        error: error.message || "Replicate request failed.",
        details: error.details,
      });
    }
    console.error(`[/api/predictions/${req.params.id}] unexpected error:`, error);
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
      prompt: trimmedPrompt,
      system_instruction: "You are an expert prompt engineer for text-to-image diffusion models. Refine prompts for clarity, vivid detail, and photo-realism while preserving the original intent. Respond with the improved prompt only.",
      max_output_tokens: 65535,
      thinking: "low",
    };

    const startedAt = Date.now();
    const chunks = [];

    // Using google/gemini-3-pro
    for await (const event of replicate.stream("google/gemini-3-pro", {
      input: refineInput,
    })) {
      if (typeof event === "string") {
        chunks.push(event);
      } else if (event && typeof event === "object") {
        const candidate =
          typeof event.output === "string"
            ? event.output
            : typeof event.data === "string"
              ? event.data
              : typeof event.delta === "string"
                ? event.delta
                : "";
        if (candidate) {
          chunks.push(candidate);
        }
      }
    }

    const elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(2));
    const rawText = chunks.join("").replace(/\s+/g, " ").trim();
    const refinedPrompt = rawText || trimmedPrompt;

    return res.json({
      refined_prompt: refinedPrompt,
      elapsed_seconds: elapsedSeconds,
      prediction: {
        status: "succeeded",
        output: chunks,
      },
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
