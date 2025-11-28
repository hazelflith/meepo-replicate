
const outputPreview = document.getElementById("output-preview");
const outputJson = document.getElementById("output-json");
const generatedTime = document.getElementById("generated-time");
const toast = document.getElementById("toast");
const seedreamRefineButton = document.getElementById("seedream-refine-button");
const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");
const downloadButton = document.getElementById("download-button");

const modelButtons = document.querySelectorAll("[data-model-button]");
const outputTabs = document.querySelectorAll("[data-output-tab]");

let activeModelKey = "nano-banana";
let activeOutputTab = "preview";

const defaultPreviewAspect = Object.freeze({ width: 16, height: 9 });
let currentPreviewAspect = { ...defaultPreviewAspect };

const expectedAspectResolvers = {};

const createInitialState = (downloadExtension = "png") => ({
  imageUrl: null,
  prediction: null,
  elapsedSeconds: null,
  downloadExtension,
  downloadExtension,
  defaultDownloadExtension: downloadExtension,
  aspect: { ...defaultPreviewAspect },
  isLoading: false,
});

const modelStates = {
  "nano-banana": createInitialState("png"),
  "remove-bg": createInitialState("png"),
};

const normalizePositiveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const computeGcd = (a, b) => {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    [x, y] = [y, x % y];
  }
  return x || 1;
};

const parseAspectRatioValue = (value) => {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  if (cleaned.includes(":")) {
    const [wRaw, hRaw] = cleaned.split(":");
    const width = normalizePositiveNumber(wRaw);
    const height = normalizePositiveNumber(hRaw);
    if (width && height) {
      return { width, height };
    }
  }
  return null;
};

const normalizeAspect = (aspect) => {
  if (!aspect || typeof aspect !== "object") {
    return { ...defaultPreviewAspect };
  }
  const width = normalizePositiveNumber(aspect.width);
  const height = normalizePositiveNumber(aspect.height);
  if (!width || !height) {
    return { ...defaultPreviewAspect };
  }
  const gcd = computeGcd(width, height);
  return { width: width / gcd, height: height / gcd };
};

const setPreviewAspect = (aspect) => {
  const normalized = normalizeAspect(aspect);
  outputPreview.style.setProperty(
    "--preview-aspect",
    `${normalized.width} / ${normalized.height}`,
  );
  currentPreviewAspect = normalized;
};

setPreviewAspect(defaultPreviewAspect);

const getExpectedAspectForModel = (modelKey) => {
  const resolver = expectedAspectResolvers[modelKey];
  if (typeof resolver === "function") {
    try {
      const aspect = resolver();
      if (aspect && typeof aspect === "object") {
        return aspect;
      }
    } catch (error) {
      console.warn("Failed to resolve preview aspect for model:", modelKey, error);
    }
  }
  return { ...defaultPreviewAspect };
};

const resetModelState = (modelKey, { preserveDownloadExtension = true } = {}) => {
  const state = modelStates[modelKey];
  if (!state) return;
  state.imageUrl = null;
  state.prediction = null;
  state.elapsedSeconds = null;
  state.aspect = { ...defaultPreviewAspect };
  if (!preserveDownloadExtension) {
    state.downloadExtension = state.defaultDownloadExtension;
  }
};

const applyStateToPreview = (modelKey, { fallbackAspect } = {}) => {
  if (modelKey !== activeModelKey) return;
  const state = modelStates[modelKey];
  if (!state) return;

  const previewAspect = state.imageUrl
    ? state.aspect || { ...defaultPreviewAspect }
    : fallbackAspect || getExpectedAspectForModel(modelKey);

  setPreviewAspect(previewAspect);

  if (state.isLoading) {
    outputPreview.innerHTML = `
      <div class="preview-placeholder">
        <div class="spinner"></div>
        <span>Generating...</span>
      </div>
    `;
  } else if (state.imageUrl) {
    const imageElement = document.createElement("img");
    imageElement.alt = `${modelKey} preview`;
    imageElement.decoding = "async";
    imageElement.src = state.imageUrl;
    outputPreview.innerHTML = "";
    outputPreview.appendChild(imageElement);
  } else {
    outputPreview.innerHTML = `
      <div class="preview-placeholder">
        <span>Generated image will appear here</span>
      </div>
    `;
  }

  const prediction = state.prediction ?? {};
  outputJson.textContent = JSON.stringify(prediction, null, 2);

  generatedTime.textContent =
    typeof state.elapsedSeconds === "number" && Number.isFinite(state.elapsedSeconds)
      ? `${state.elapsedSeconds}s`
      : "—";

  if (state.imageUrl) {
    if (downloadButton) {
      downloadButton.classList.remove("hidden");
      downloadButton.onclick = () => {
        const link = document.createElement("a");
        link.href = state.imageUrl;
        link.download = `generated-image.${state.downloadExtension || "png"}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      };
    }
  } else {
    if (downloadButton) {
      downloadButton.classList.add("hidden");
      downloadButton.onclick = null;
    }
  }
};

const updateStateWithImage = (modelKey, imageUrl, downloadExtension) => {
  const state = modelStates[modelKey];
  if (!state) return;

  if (downloadExtension) {
    state.downloadExtension = downloadExtension;
  }

  if (!imageUrl) {
    state.imageUrl = null;
    state.aspect = { ...defaultPreviewAspect };
    applyStateToPreview(modelKey);
    return;
  }

  state.imageUrl = imageUrl;
  state.aspect = state.aspect || { ...defaultPreviewAspect };
  applyStateToPreview(modelKey);

  const probe = new Image();
  probe.onload = () => {
    const width = normalizePositiveNumber(probe.naturalWidth);
    const height = normalizePositiveNumber(probe.naturalHeight);
    if (width && height) {
      state.aspect = normalizeAspect({ width, height });
    } else {
      state.aspect = { ...defaultPreviewAspect };
    }
    applyStateToPreview(modelKey);
  };
  probe.onerror = () => {
    state.imageUrl = null;
    state.aspect = { ...defaultPreviewAspect };
    if (modelKey === activeModelKey) {
      showToast("Failed to load generated image preview.", "error");
    }
    applyStateToPreview(modelKey);
  };
  probe.src = imageUrl;
};

function createRangeValueSync(input) {
  const badge = document.querySelector(`[data-range-value="${input.id}"]`);
  const update = () => {
    if (badge) {
      badge.textContent = input.value;
    }
  };
  input.addEventListener("input", update);
  update();
  return update;
}

import imageCompression from "https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/+esm";

function filesToBase64(filesInput, options = {}) {
  const files = Array.isArray(filesInput) ? filesInput : Array.from(filesInput?.files ?? []);
  if (!files.length) return Promise.resolve([]);
  const { skipCompression = false, onProgress } = options;

  let processedCount = 0;
  const totalFiles = files.length;

  return Promise.all(
    files.map(async (file) => {
      let fileToProcess = file;

      // Check if file size is greater than 2MB
      if (!skipCompression && file.size > 2 * 1024 * 1024) {
        try {
          console.log(`Compressing ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)...`);
          if (onProgress) onProgress({ status: "compressing", file: file.name });

          const options = {
            maxSizeMB: 2,
            maxWidthOrHeight: 1920,
            useWebWorker: true,
          };
          fileToProcess = await imageCompression(file, options);
          console.log(`Compressed to ${(fileToProcess.size / 1024 / 1024).toFixed(2)} MB`);
        } catch (error) {
          console.error("Compression failed:", error);
          // Fallback to original file if compression fails
        }
      }

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          processedCount++;
          if (onProgress) onProgress({ status: "processed", count: processedCount, total: totalFiles });
          resolve(reader.result);
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(fileToProcess);
      });
    }),
  );
}

const humanFileSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const precision = size >= 10 || unit === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unit]}`;
};

const removeFileFromInput = (input, index) => {
  if (!input?.files) return;
  const dataTransfer = new DataTransfer();
  Array.from(input.files).forEach((file, i) => {
    if (i !== index) {
      dataTransfer.items.add(file);
    }
  });
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

const renderFilePreviewList = (files, container, onRemove) => {
  console.log("renderFilePreviewList called", { files, container });
  if (!container) return;
  container.innerHTML = "";

  if (!files || !files.length) {
    container.classList.add("file-preview-list--empty");
    return;
  }

  container.classList.remove("file-preview-list--empty");

  files.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "file-preview-item";

    const thumbWrapper = document.createElement("div");
    thumbWrapper.className = "file-preview-thumb";

    const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.name);

    if (isImage) {
      const thumbImage = document.createElement("img");
      thumbImage.alt = `Preview of ${file.name}`;
      thumbImage.decoding = "async";
      try {
        const objectUrl = URL.createObjectURL(file);
        thumbImage.src = objectUrl;
        thumbImage.onload = () => URL.revokeObjectURL(objectUrl);
        thumbImage.onerror = () => {
          console.error("Failed to load preview image", file.name);
          URL.revokeObjectURL(objectUrl);
          thumbWrapper.classList.add("file-preview-thumb--placeholder");
          thumbWrapper.textContent = "!";
        };
        thumbWrapper.appendChild(thumbImage);
      } catch (e) {
        console.error("Error creating object URL", e);
        thumbWrapper.classList.add("file-preview-thumb--placeholder");
        thumbWrapper.textContent = "?";
      }
    } else {
      thumbWrapper.classList.add("file-preview-thumb--placeholder");
      thumbWrapper.textContent = file.name?.charAt(0)?.toUpperCase() || "?";
    }

    const details = document.createElement("div");
    details.className = "file-preview-details";

    const nameEl = document.createElement("span");
    nameEl.className = "file-preview-name";
    nameEl.textContent = file.name || `File ${index + 1}`;

    const metaEl = document.createElement("span");
    metaEl.className = "file-preview-meta";
    metaEl.textContent = [file.type.split("/")[1] || file.type || "", humanFileSize(file.size)]
      .filter(Boolean)
      .join(" · ");

    details.appendChild(nameEl);
    details.appendChild(metaEl);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "file-preview-remove";
    removeButton.setAttribute("aria-label", `Remove ${file.name || `file ${index + 1}`}`);
    removeButton.innerHTML = "×";
    removeButton.addEventListener("click", () => {
      if (onRemove) onRemove(index);
    });

    item.appendChild(thumbWrapper);
    item.appendChild(details);
    item.appendChild(removeButton);
    container.appendChild(item);
  });
};

function showToast(message, type = "info") {
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.dataset.type = type;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 4000);
}

function normalizeImageValue(value, modelKey) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:")
  ) {
    return trimmed;
  }

  const base64Pattern = /^[A-Za-z0-9+/=\s]+$/;
  if (base64Pattern.test(trimmed) && trimmed.length > 100) {
    const state = modelStates[modelKey ?? activeModelKey] || modelStates[activeModelKey];
    const extension =
      state?.downloadExtension || state?.defaultDownloadExtension || "jpeg";
    const format = extension.replace(/[^a-z0-9]/gi, "") || "jpeg";
    return `data:image/${format};base64,${trimmed.replace(/\s/g, "")}`;
  }

  return null;
}

function extractImageUrl(prediction, modelKey) {
  if (!prediction) return null;
  const output = prediction.output ?? prediction.images ?? null;

  if (typeof output === "string") {
    return normalizeImageValue(output, modelKey);
  }

  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item === "string") {
        const normalized = normalizeImageValue(item, modelKey);
        if (normalized) return normalized;
      }

      if (item && typeof item === "object") {
        const sources = [item.image, item.url, item.uri, item.path];
        for (const source of sources) {
          const normalized = normalizeImageValue(source, modelKey);
          if (normalized) return normalized;
        }
      }
    }
  }

  if (output && typeof output === "object") {
    const sources = [output.image, output.url, output.uri, output.path];
    for (const source of sources) {
      const normalized = normalizeImageValue(source, modelKey);
      if (normalized) return normalized;
    }
  }

  return null;
}

function setActiveOutputTab(tabName) {
  activeOutputTab = tabName;
  outputTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.getAttribute("data-output-tab") === tabName);
  });

  if (tabName === "preview") {
    outputPreview.classList.remove("hidden");
    outputJson.classList.add("hidden");
  }
}

function toggleRunning(isRunning, config, statusText = "Generating…") {
  const runButton = config?.runButton;

  if (isRunning) {
    if (loadingOverlay) {
      loadingOverlay.classList.remove("hidden");
      if (loadingText) loadingText.textContent = statusText;
    }

    if (runButton && !runButton.disabled) {
      runButton.dataset.originalHtml = runButton.innerHTML;
      runButton.disabled = true;
    }
  } else {
    if (loadingOverlay) loadingOverlay.classList.add("hidden");
    if (runButton) {
      runButton.innerHTML = runButton.dataset.originalHtml || "Run";
      runButton.disabled = false;
    }
  }
}

function createNanoBananaConfig() {
  const form = document.getElementById("nano-banana-form");
  const promptField = document.getElementById("nano-banana-prompt");
  const fileInput = document.getElementById("nano-banana-image-input");
  const previewContainer = document.getElementById("nano-banana-image-preview");
  const aspectSelect = document.getElementById("nano-banana-aspect-ratio");
  const resolutionSelect = document.getElementById("nano-banana-resolution");
  const outputFormatSelect = document.getElementById("nano-banana-output-format");
  const safetyFilterLevelSelect = document.getElementById("nano-banana-safety-filter-level");

  const defaults = {
    prompt:
      "How engineers see the San Francisco Bridge",
    aspect_ratio: "4:3",
    resolution: "2K",
    output_format: "png",
    safety_filter_level: "block_only_high",
  };

  let matchInputAspect = null;
  let selectedFiles = [];

  const getPreviewAspect = () => {
    const aspectValue = aspectSelect.value;
    const parsed = parseAspectRatioValue(aspectValue);
    if (parsed) return parsed;

    if (aspectValue === "match_input_image" && matchInputAspect) {
      return matchInputAspect;
    }

    return { ...defaultPreviewAspect };
  };

  expectedAspectResolvers["nano-banana"] = () => getPreviewAspect();

  const applyPreviewAspect = () => {
    if (activeModelKey !== "nano-banana") return;
    if (modelStates["nano-banana"].imageUrl) return;
    applyStateToPreview("nano-banana", { fallbackAspect: getPreviewAspect() });
  };

  const updateMatchInputAspectFromFile = () => {
    matchInputAspect = null;
    if (aspectSelect.value !== "match_input_image") {
      applyPreviewAspect();
      return;
    }
    const firstFile = selectedFiles[0];
    if (!firstFile) {
      applyPreviewAspect();
      return;
    }
    const objectUrl = URL.createObjectURL(firstFile);
    const image = new Image();
    image.onload = () => {
      const width = normalizePositiveNumber(image.naturalWidth);
      const height = normalizePositiveNumber(image.naturalHeight);
      matchInputAspect =
        width && height ? { width, height } : { ...defaultPreviewAspect };
      URL.revokeObjectURL(objectUrl);
      applyPreviewAspect();
    };
    image.onerror = () => {
      matchInputAspect = null;
      URL.revokeObjectURL(objectUrl);
      applyPreviewAspect();
    };
    image.src = objectUrl;
  };

  aspectSelect.addEventListener("change", () => {
    if (aspectSelect.value === "match_input_image") {
      updateMatchInputAspectFromFile();
    } else {
      matchInputAspect = null;
      applyPreviewAspect();
    }
  });

  fileInput.addEventListener("change", () => {
    console.log("File input changed");
    const newFiles = Array.from(fileInput.files || []);
    if (newFiles.length > 0) {
      selectedFiles = [...selectedFiles, ...newFiles];
      fileInput.value = ""; // Clear input to allow re-selecting same file
      updateMatchInputAspectFromFile();
      renderFilePreviewList(selectedFiles, previewContainer, (indexToRemove) => {
        selectedFiles = selectedFiles.filter((_, i) => i !== indexToRemove);
        renderFilePreviewList(selectedFiles, previewContainer, (idx) => {
          // Recursive callback handling is tricky here, better to just re-render with same logic
          // But since we are inside the closure, we can just call the main render
          // Actually, let's simplify: define a render function
          updatePreview();
        });
        updateMatchInputAspectFromFile();
      });
    }
  });

  const updatePreview = () => {
    renderFilePreviewList(selectedFiles, previewContainer, (indexToRemove) => {
      selectedFiles = selectedFiles.filter((_, i) => i !== indexToRemove);
      updatePreview();
      updateMatchInputAspectFromFile();
    });
  };

  function resetFields() {
    promptField.value = defaults.prompt;
    aspectSelect.value = defaults.aspect_ratio;
    resolutionSelect.value = defaults.resolution;
    outputFormatSelect.value = defaults.output_format;
    safetyFilterLevelSelect.value = defaults.safety_filter_level;
    fileInput.value = "";
    selectedFiles = [];
    matchInputAspect = null;
    applyPreviewAspect();
    updatePreview();
  }

  async function gatherPayload(onProgress) {
    const prompt = promptField.value;
    const aspect_ratio = aspectSelect.value;
    const resolution = resolutionSelect.value;
    const output_format = outputFormatSelect.value;
    const safety_filter_level = safetyFilterLevelSelect.value;

    const image_input = await filesToBase64(selectedFiles, {
      onProgress: (progress) => {
        if (onProgress) onProgress(progress);
      }
    });

    const payload = {
      model_key: "nano-banana",
      prompt,
      aspect_ratio,
      resolution,
      output_format,
      safety_filter_level,
    };

    if (image_input.length) {
      payload.image_input = image_input;
    }

    return {
      payload,
      downloadExtension: output_format || "png",
    };
  }

  const refineButton = document.getElementById("nano-banana-refine-button");

  refineButton?.addEventListener("click", async () => {
    const prompt = promptField.value.trim();
    if (!prompt) {
      showToast("Provide a prompt before refining.", "error");
      promptField.focus();
      return;
    }

    const originalText = refineButton.textContent;
    refineButton.disabled = true;
    refineButton.textContent = "Refining…";

    try {
      const response = await fetch("/api/refine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });

      const result = await response.json();

      if (!response.ok) {
        const message =
          result?.error ||
          result?.details?.error ||
          "Unable to refine prompt right now.";
        throw new Error(message);
      }

      const refinedPrompt = typeof result?.refined_prompt === "string"
        ? result.refined_prompt.trim()
        : "";

      if (refinedPrompt) {
        promptField.value = refinedPrompt;
        showToast("Prompt refined.", "success");
      } else {
        showToast("Refine service returned no changes.", "error");
      }
    } catch (error) {
      console.error("Prompt refinement failed", error);
      showToast(
        error instanceof Error ? error.message : "Failed to refine prompt.",
        "error",
      );
    } finally {
      refineButton.disabled = false;
      refineButton.textContent = originalText;
    }
  });

  applyPreviewAspect();
  renderFilePreviewList(fileInput, previewContainer);

  return {
    key: "nano-banana",
    form,
    promptField,
    fileInput,
    runButton: form.querySelector('[data-role="run"]'),
    resetButton: form.querySelector('[data-role="reset"]'),
    reset: resetFields,
    gatherPayload,
    getPreviewAspect,
  };
}

function createRemoveBgConfig() {
  const form = document.getElementById("remove-bg-form");
  const fileInput = document.getElementById("remove-bg-image-input");
  const previewContainer = document.getElementById("remove-bg-image-preview");
  const imageUrlInput = document.getElementById("remove-bg-image-url");
  const contentModerationCheckbox = document.getElementById("remove-bg-content-moderation");
  const preservePartialAlphaCheckbox = document.getElementById("remove-bg-preserve-partial-alpha");

  const defaults = {
    image_url: "",
    content_moderation: false,
    preserve_partial_alpha: true,
  };

  const getPreviewAspect = () => {
    return { ...defaultPreviewAspect };
  };

  expectedAspectResolvers["remove-bg"] = () => getPreviewAspect();

  const applyPreviewAspect = () => {
    if (activeModelKey !== "remove-bg") return;
    if (modelStates["remove-bg"].imageUrl) return;
    applyStateToPreview("remove-bg", { fallbackAspect: getPreviewAspect() });
  };

  fileInput.addEventListener("change", () => {
    renderFilePreviewList(Array.from(fileInput.files || []), previewContainer);
  });

  function resetFields() {
    fileInput.value = "";
    imageUrlInput.value = defaults.image_url;
    contentModerationCheckbox.checked = defaults.content_moderation;
    preservePartialAlphaCheckbox.checked = defaults.preserve_partial_alpha;
    applyPreviewAspect();
    renderFilePreviewList([], previewContainer);
  }

  async function gatherPayload() {
    const image_url = imageUrlInput.value.trim();
    const content_moderation = contentModerationCheckbox.checked;
    const preserve_partial_alpha = preservePartialAlphaCheckbox.checked;
    const image_input = await filesToBase64(fileInput, { skipCompression: true });

    const payload = {
      model_key: "remove-bg",
      content_moderation,
      preserve_partial_alpha,
    };

    if (image_input.length) {
      payload.image = image_input[0];
    } else if (image_url) {
      payload.image_url = image_url;
    }

    return {
      payload,
      downloadExtension: "png",
    };
  }

  applyPreviewAspect();
  renderFilePreviewList(Array.from(fileInput.files || []), previewContainer);

  return {
    key: "remove-bg",
    form,
    fileInput,
    runButton: form.querySelector('[data-role="run"]'),
    resetButton: form.querySelector('[data-role="reset"]'),
    reset: resetFields,
    gatherPayload,
    getPreviewAspect,
  };
}

const modelConfigs = {
  "nano-banana": createNanoBananaConfig(),
  "remove-bg": createRemoveBgConfig(),
};

const refreshPreviewAspectForModel = (modelKey) => {
  const fallbackAspect = getExpectedAspectForModel(modelKey);
  applyStateToPreview(modelKey, { fallbackAspect });
};

function setActiveModel(modelKey) {
  if (!modelConfigs[modelKey]) return;
  activeModelKey = modelKey;

  Object.entries(modelConfigs).forEach(([key, config]) => {
    config.form.classList.toggle("form--hidden", key !== modelKey);
    config.form.classList.toggle("form--active", key === modelKey);
    config.onActivate?.();
  });

  modelButtons.forEach((button) => {
    const isActive = button.getAttribute("data-model-button") === modelKey;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  refreshPreviewAspectForModel(modelKey);

  const modelInfoHeader = document.getElementById("model-info-header");
  if (modelInfoHeader) {
    const modelName = modelKey === "nano-banana" ? "google/nano-banana-pro" : "briaai/bria-rmbg-2.0";
    modelInfoHeader.innerHTML = `<strong>Generation Model:</strong> ${modelName}`;
  }
}

async function handleSubmit(event, modelKey) {
  event.preventDefault();
  const config = modelConfigs[modelKey];
  if (!config) return;

  setActiveOutputTab("preview");

  const state = modelStates[modelKey];

  try {
    // Disable button immediately and show initial status
    toggleRunning(true, config, "Preparing...");

    const { payload, downloadExtension } = await config.gatherPayload((progress) => {
      if (progress.status === "compressing") {
        toggleRunning(true, config, `Compressing ${progress.file}...`);
      } else if (progress.status === "processed") {
        toggleRunning(true, config, `Processed ${progress.count}/${progress.total}`);
      }
    });
    payload.prompt = (payload.prompt || "").trim();

    if (modelKey !== "remove-bg" && !payload.prompt) {
      showToast("Please provide a prompt before running the model.", "error");
      toggleRunning(false, config); // Re-enable if validation fails
      return;
    }

    state.downloadExtension =
      downloadExtension || state.downloadExtension || state.defaultDownloadExtension;

    resetModelState(modelKey, { preserveDownloadExtension: true });
    applyStateToPreview(modelKey, { fallbackAspect: getExpectedAspectForModel(modelKey) });

    state.isLoading = true;
    applyStateToPreview(modelKey);
    toggleRunning(true, config, "Generating...");

    const startTime = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

    const response = await fetch("/api/predictions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    let result = await response.json();

    if (!response.ok) {
      const message = result?.error || "Failed to start prediction.";
      throw new Error(message);
    }

    let prediction = result.prediction;

    // Poll for completion
    while (
      prediction.status !== "succeeded" &&
      prediction.status !== "failed" &&
      prediction.status !== "canceled"
    ) {
      if (Date.now() - startTime > TIMEOUT_MS) {
        throw new Error("Prediction timed out after 5 minutes.");
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const pollResponse = await fetch(`/api/predictions/${prediction.id}`);
      const pollResult = await pollResponse.json();

      if (!pollResponse.ok) {
        const message = pollResult?.error || "Failed to poll prediction status.";
        throw new Error(message);
      }

      prediction = pollResult.prediction;
    }

    if (prediction.status !== "succeeded") {
      const message = prediction.error || "Prediction failed or was canceled.";
      throw new Error(message);
    }

    const elapsedSeconds = Number(((Date.now() - startTime) / 1000).toFixed(2));

    state.prediction = prediction;
    state.elapsedSeconds = elapsedSeconds;

    const imageUrl = extractImageUrl(prediction, modelKey);

    if (!imageUrl) {
      showToast("Prediction finished but no image URL returned.", "error");
    }

    updateStateWithImage(modelKey, imageUrl, state.downloadExtension);

    if (modelKey === activeModelKey) {
      applyStateToPreview(modelKey);
    }

    showToast("Prediction complete.", "success");
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Unexpected error while running the prediction.";
    showToast(message, "error");

    // Update UI with error state if needed
    if (modelKey === activeModelKey) {
      generatedTime.textContent = "—";
    }
  } finally {
    state.isLoading = false;
    if (modelKey === activeModelKey) {
      applyStateToPreview(modelKey);
    }
    toggleRunning(false, config);
  }
}


function resetModelForm(modelKey, { silent = false } = {}) {
  const config = modelConfigs[modelKey];
  if (!config) return;

  resetModelState(modelKey, { preserveDownloadExtension: true });
  config.reset();
  refreshPreviewAspectForModel(modelKey);

  if (!silent && modelKey === activeModelKey) {
    applyStateToPreview(modelKey);
    showToast("Inputs reset to defaults.");
  }
}

modelButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const modelKey = button.getAttribute("data-model-button");
    setActiveModel(modelKey);
  });
});

outputTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const tabName = tab.getAttribute("data-output-tab");
    setActiveOutputTab(tabName);
  });
});

Object.entries(modelConfigs).forEach(([modelKey, config]) => {
  config.form.addEventListener("submit", (event) => handleSubmit(event, modelKey));
  config.resetButton?.addEventListener("click", () => resetModelForm(modelKey));
});



document.addEventListener("keydown", (event) => {
  const isCmdOrCtrl = event.metaKey || event.ctrlKey;
  if (isCmdOrCtrl && event.key.toLowerCase() === "enter") {
    event.preventDefault();
    const config = modelConfigs[activeModelKey];
    config?.form?.requestSubmit();
  }
});

try {
  // resetModelForm("seedream", { silent: true }); // seedream not in config
  resetModelForm("nano-banana", { silent: true });
  setActiveModel(activeModelKey);
  applyStateToPreview(activeModelKey);
  console.log("App initialized successfully");
} catch (error) {
  console.error("App initialization failed:", error);
  showToast("App initialization failed: " + error.message, "error");
}
