const OVERLAY_ID = "browser-video-ocr-overlay";
const BUTTON_ID = "browser-video-ocr-btn";

let activeVideo = null;
let activeOverlay = null;
let ocrButton = null;
let processing = false;
let refreshScheduled = false;
let domObserver = null;

const MIN_VIDEO_AREA = 320 * 180;
const MIN_VIDEO_AREA_RATIO = 0.12;
const BUTTON_MARGIN = 12;

function getFullscreenRoot() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement ||
    null
  );
}

function scheduleRefresh() {
  if (refreshScheduled) return;

  refreshScheduled = true;
  window.requestAnimationFrame(() => {
    refreshScheduled = false;
    refreshActiveVideo();
  });
}

function isVisibleVideo(video) {
  if (!(video instanceof HTMLVideoElement) || !video.isConnected) return false;

  const rect = video.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;

  const style = getComputedStyle(video);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0
  ) {
    return false;
  }

  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.left < innerWidth &&
    rect.top < innerHeight
  );
}

function isEligibleVideo(video) {
  if (!(video instanceof HTMLVideoElement)) return false;
  if (!video.paused) return false;
  if (!isVisibleVideo(video)) return false;

  const rect = video.getBoundingClientRect();
  const viewportArea = Math.max(innerWidth * innerHeight, 1);
  const area = rect.width * rect.height;

  return area >= Math.max(MIN_VIDEO_AREA, viewportArea * MIN_VIDEO_AREA_RATIO);
}

function findEligibleVideo() {
  let bestVideo = null;
  let bestArea = 0;

  for (const video of document.querySelectorAll("video")) {
    if (!isEligibleVideo(video)) continue;

    const rect = video.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      bestArea = area;
      bestVideo = video;
    }
  }

  return bestVideo;
}

function refreshActiveVideo() {
  if (activeVideo && isEligibleVideo(activeVideo)) {
    positionButton(activeVideo);
    syncOverlay();
    return;
  }

  const eligibleVideo = findEligibleVideo();
  if (eligibleVideo) {
    if (activeVideo !== eligibleVideo) {
      clearOverlay();
    }

    activeVideo = eligibleVideo;
    positionButton(eligibleVideo);
    clearOverlay();
    return;
  }

  if (activeVideo) {
    activeVideo = null;
    clearOverlay();
    hideButton();
  }
}

function clearActiveState() {
  activeVideo = null;
  clearOverlay();
  hideButton();
}

function getOrCreateButton() {
  if (ocrButton) return ocrButton;

  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.textContent = "OCR";

  Object.assign(btn.style, {
    position: "fixed",
    zIndex: "2147483647",
    padding: "4px 10px",
    borderRadius: "6px",
    border: "none",
    background: "rgba(20,20,20,0.82)",
    color: "#fff",
    fontSize: "12px",
    fontFamily: "system-ui, sans-serif",
    fontWeight: "600",
    letterSpacing: "0.04em",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
    backdropFilter: "blur(6px)",
    userSelect: "none",
    transition: "opacity 0.15s, transform 0.1s",
    display: "none",
  });

  btn.addEventListener("mouseenter", () => {
    btn.style.transform = "scale(1.06)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.transform = "scale(1)";
  });
  btn.addEventListener("click", onButtonClick);

  document.body.appendChild(btn);
  ocrButton = btn;
  return btn;
}

function getButtonAnchorRect(video) {
  const fullscreenRoot = getFullscreenRoot();
  if (fullscreenRoot && fullscreenRoot.contains(video)) {
    return fullscreenRoot.getBoundingClientRect();
  }

  return video.getBoundingClientRect();
}

function positionButton(video) {
  const btn = getOrCreateButton();
  const anchorRect = getButtonAnchorRect(video);
  const left = Math.max(anchorRect.left + BUTTON_MARGIN, BUTTON_MARGIN);
  const top = Math.max(anchorRect.top + BUTTON_MARGIN, BUTTON_MARGIN);

  btn.style.visibility = "hidden";
  btn.style.left = "0px";
  btn.style.top = "0px";
  btn.style.display = "block";

  btn.style.left = `${left}px`;
  btn.style.top = `${top}px`;
  btn.style.visibility = "visible";
}

function hideButton() {
  if (ocrButton) ocrButton.style.display = "none";
}

async function onButtonClick() {
  if (!activeVideo || processing) return;

  const btn = getOrCreateButton();
  btn.textContent = "…";
  btn.style.opacity = "0.6";
  btn.style.pointerEvents = "none";
  processing = true;

  try {
    await runOcr(activeVideo);
  } finally {
    processing = false;
    btn.textContent = "OCR";
    btn.style.opacity = "1";
    btn.style.pointerEvents = "auto";
  }
}

document.addEventListener("pause", () => scheduleRefresh(), true);

document.addEventListener("play", () => scheduleRefresh(), true);

document.addEventListener("seeked", () => scheduleRefresh(), true);

window.addEventListener(
  "resize",
  () => {
    scheduleRefresh();
  },
  true,
);

window.addEventListener(
  "scroll",
  () => {
    scheduleRefresh();
  },
  true,
);

document.addEventListener(
  "fullscreenchange",
  () => {
    scheduleRefresh();
  },
  true,
);

document.addEventListener(
  "webkitfullscreenchange",
  () => {
    scheduleRefresh();
  },
  true,
);

window.addEventListener(
  "pagehide",
  () => {
    clearActiveState();
  },
  true,
);

window.addEventListener(
  "pageshow",
  () => {
    scheduleRefresh();
  },
  true,
);

window.addEventListener(
  "popstate",
  () => {
    clearActiveState();
    scheduleRefresh();
  },
  true,
);

window.addEventListener(
  "hashchange",
  () => {
    scheduleRefresh();
  },
  true,
);

domObserver = new MutationObserver(() => {
  scheduleRefresh();
});

domObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["class", "style", "hidden", "aria-hidden"],
});

async function runOcr(video) {
  const frame = captureFrame(video);
  if (!frame) {
    console.error("[VideoOCR] frame capture failed.");
    return;
  }

  const response = await sendMessage({ type: "ocrFrame", imageBase64: frame });
  if (!response?.ok) {
    console.error("[VideoOCR]", response?.error);
    return;
  }

  const items = response.items ?? response.words ?? [];
  if (!items.length) {
    return;
  }

  renderOverlay(video, items);
}

function captureFrame(video) {
  const { videoWidth: w, videoHeight: h } = video;
  if (!w || !h) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
}

function renderOverlay(video, items) {
  clearOverlay();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, {
    position: "fixed",
    zIndex: "2147483646", // just below the button
    pointerEvents: "none",
    userSelect: "none",
    left: "0",
    top: "0",
  });

  for (const { text, box } of items) {
    overlay.appendChild(createWordSpan(text, box));
  }

  document.body.appendChild(overlay);
  activeOverlay = overlay;
  syncOverlay(video);
}

function createWordSpan(text, box) {
  const span = document.createElement("span");
  span.textContent = text;
  span.dataset.ocrLeft = box.left;
  span.dataset.ocrTop = box.top;
  span.dataset.ocrWidth = box.width;
  span.dataset.ocrHeight = box.height;

  Object.assign(span.style, {
    position: "absolute",
    whiteSpace: "pre-wrap",
    overflow: "hidden",
    pointerEvents: "auto",
    userSelect: "text",
    webkitUserSelect: "text",
    cursor: "text",
    lineBreak: "anywhere",
    color: "rgba(255,255,255,0.92)",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: "2px",
    padding: "0 1px",
    boxSizing: "border-box",
    fontFamily: "system-ui, sans-serif",
  });

  return span;
}

let measureContext = null;

function getMeasureContext() {
  if (measureContext) return measureContext;
  const canvas = document.createElement("canvas");
  measureContext = canvas.getContext("2d");
  return measureContext;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getLongestWordWidth(text, fontSize) {
  const ctx = getMeasureContext();
  if (!ctx) return fontSize;

  const words = text.split(/\s+/).filter(Boolean);
  const font = `${fontSize}px system-ui, sans-serif`;
  ctx.font = font;

  if (!words.length) {
    return ctx.measureText(text).width || fontSize;
  }

  let maxWidth = 0;
  for (const word of words) {
    maxWidth = Math.max(maxWidth, ctx.measureText(word).width);
  }

  return maxWidth || fontSize;
}

function fitFontSize(text, width, height, isVertical) {
  const minSize = 8;
  const maxSize = 64;

  if (!text || width <= 0 || height <= 0) {
    return minSize;
  }

  if (isVertical) {
    const perChar = height / Math.max(1, text.length);
    const size = Math.min(perChar, width);
    return clamp(size, minSize, maxSize);
  }

  const baseSize = 12;
  const longestWord = getLongestWordWidth(text, baseSize);
  const maxByWidth = (baseSize * width) / Math.max(1, longestWord);
  const maxByHeight = height * 0.85;

  return clamp(Math.min(maxByWidth, maxByHeight), minSize, maxSize);
}

function isVerticalText(text, width, height) {
  return text.length > 1 && height > width * 1.6;
}

function syncOverlay(video) {
  if (!activeOverlay) return;
  const vid = video || activeVideo;
  if (!vid) return;

  const rect = getVideoRect(vid);

  Object.assign(activeOverlay.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });

  const scaleX = rect.width / rect.sourceWidth;
  const scaleY = rect.height / rect.sourceHeight;

  for (const span of activeOverlay.children) {
    const left = Number(span.dataset.ocrLeft) * scaleX;
    const top = Number(span.dataset.ocrTop) * scaleY;
    const width = Number(span.dataset.ocrWidth) * scaleX;
    const height = Number(span.dataset.ocrHeight) * scaleY;
    const text = span.textContent || "";
    const vertical = isVerticalText(text, width, height);
    const fs = fitFontSize(text, width, height, vertical);

    Object.assign(span.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      fontSize: `${fs}px`,
      lineHeight: `${fs}px`,
      writingMode: vertical ? "vertical-rl" : "horizontal-tb",
      textOrientation: vertical ? "mixed" : "initial",
      wordBreak: vertical ? "normal" : "break-word",
      whiteSpace: vertical ? "pre" : "pre-wrap",
    });
  }
}

function getVideoRect(video) {
  const bounds = video.getBoundingClientRect();
  const sourceWidth = video.videoWidth || bounds.width;
  const sourceHeight = video.videoHeight || bounds.height;
  const objectFit = getComputedStyle(video).objectFit || "contain";

  if (objectFit === "fill") {
    return {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      sourceWidth,
      sourceHeight,
    };
  }

  const sourceRatio = sourceWidth / sourceHeight;
  const boundsRatio = bounds.width / bounds.height;
  let width, height;

  if (objectFit === "cover") {
    if (sourceRatio > boundsRatio) {
      height = bounds.height;
      width = height * sourceRatio;
    } else {
      width = bounds.width;
      height = width / sourceRatio;
    }
  } else {
    if (sourceRatio > boundsRatio) {
      width = bounds.width;
      height = width / sourceRatio;
    } else {
      height = bounds.height;
      width = height * sourceRatio;
    }
  }

  return {
    left: bounds.left + (bounds.width - width) / 2,
    top: bounds.top + (bounds.height - height) / 2,
    width,
    height,
    sourceWidth,
    sourceHeight,
  };
}

function clearOverlay() {
  activeOverlay?.remove();
  activeOverlay = null;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "[VideoOCR] runtime error:",
          chrome.runtime.lastError.message,
        );
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}
