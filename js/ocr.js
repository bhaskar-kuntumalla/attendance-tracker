// ============================================================
// ocr.js — Browser-Side OCR Engine (Tesseract.js Word-Level Bounding Box Extraction)
// Runs entirely inside the user's browser — 100% FREE with ZERO external AI APIs.
// ============================================================

const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

let tesseractLoadedPromise = null;

// Dynamically load Tesseract.js library via script tag if not present
export function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoadedPromise) return tesseractLoadedPromise;

  tesseractLoadedPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TESSERACT_CDN;
    script.async = true;
    script.onload = () => {
      if (window.Tesseract) resolve(window.Tesseract);
      else reject(new Error("Failed to initialize Tesseract library."));
    };
    script.onerror = () => reject(new Error("Failed to load OCR script from CDN. Please check your connection."));
    document.head.appendChild(script);
  });

  return tesseractLoadedPromise;
}

// Preprocess image on HTML5 canvas for sharper OCR text detection
export async function preprocessImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      // Scale up small images for better OCR resolution
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;

      const minDim = 1600;
      if (width < minDim && height < minDim) {
        const scale = minDim / Math.min(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      canvas.width = width;
      canvas.height = height;

      // Draw image
      ctx.drawImage(img, 0, 0, width, height);

      // Grayscale & Contrast enhancement
      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;

      for (let i = 0; i < data.length; i += 4) {
        // Luminance formula
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        // Contrast boost factor
        const contrast = 1.35;
        let adjusted = (gray - 128) * contrast + 128;
        adjusted = Math.min(255, Math.max(0, adjusted));

        data[i] = adjusted;
        data[i + 1] = adjusted;
        data[i + 2] = adjusted;
      }

      ctx.putImageData(imgData, 0, 0);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve({ blob, width, height });
          else resolve({ blob: file, width, height });
        },
        "image/png"
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load image file for OCR processing."));
    };

    img.src = url;
  });
}

// Execute OCR on a timetable image file, extracting word-level bounding box geometry
export async function runTimetableOCR(file, onProgress = () => {}) {
  if (!file) throw new Error("No image file provided.");
  const validTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg", "image/bmp"];
  if (!validTypes.includes(file.type.toLowerCase())) {
    throw new Error("Unsupported image format. Please upload JPG, PNG, or WebP.");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error("Image size too large. Please upload an image under 15MB.");
  }

  onProgress({ stage: "init", message: "Loading OCR engine...", progress: 10 });
  const Tesseract = await loadTesseract();

  onProgress({ stage: "preprocess", message: "Preprocessing image for spatial grid detection...", progress: 25 });
  let processedData;
  try {
    processedData = await preprocessImage(file);
  } catch (err) {
    console.warn("Image preprocessing warning:", err);
    processedData = { blob: file, width: 1200, height: 800 };
  }

  onProgress({ stage: "recognize", message: "Extracting text and bounding box geometry...", progress: 40 });

  const result = await Tesseract.recognize(processedData.blob, "eng", {
    logger: (m) => {
      if (m.status === "recognizing text") {
        const p = Math.round(40 + (m.progress || 0) * 50);
        onProgress({ stage: "recognize", message: `Analyzing table geometry (${Math.round((m.progress || 0) * 100)}%)...`, progress: p });
      }
    },
  });

  onProgress({ stage: "finalize", message: "Constructing spatial grid and cell geometry...", progress: 95 });

  const rawText = result?.data?.text || "";
  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);

  // Extract detailed word-level bounding boxes for spatial grid parsing
  const rawWords = result?.data?.words || [];
  const words = rawWords
    .filter((w) => w.text && w.text.trim().length > 0)
    .map((w) => {
      const x0 = w.bbox ? w.bbox.x0 : 0;
      const y0 = w.bbox ? w.bbox.y0 : 0;
      const x1 = w.bbox ? w.bbox.x1 : 0;
      const y1 = w.bbox ? w.bbox.y1 : 0;
      return {
        text: w.text.trim(),
        x0,
        y0,
        x1,
        y1,
        cx: (x0 + x1) / 2,
        cy: (y0 + y1) / 2,
        confidence: w.confidence || 0,
      };
    });

  return {
    rawText,
    lines,
    words,
    imageWidth: processedData.width,
    imageHeight: processedData.height,
    confidence: result?.data?.confidence || 0,
  };
}
