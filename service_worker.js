const MENU_IDS = {
  OPEN: "base64-link-opener.decode-and-open",
  PREVIEW: "base64-link-opener.decode-and-preview"
};

const RESULT_KEY = "latestDecodeResult";
const OPTIONS_KEY = "options";
const MAX_SEED_CANDIDATES = 18;
const MAX_TOKEN_CANDIDATES = 8;
const DEFAULT_OPTIONS = {
  autoOpenSafeUrl: true,
  openInBackground: false,
  maxDecodePasses: 3,
  allowHttps: true,
  allowHttp: false,
  allowMagnet: true,
  tryUrlDecodeBeforeBase64: true,
  inspectUrlContainers: true
};

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaultOptions();
  await ensureContextMenus();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureContextMenus();
});

chrome.action.onClicked.addListener(() => {
  openResultPage().catch((error) => {
    console.error("Failed to open result page:", error);
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  handleMenuClick(info).catch((error) => {
    console.error("Context menu handling failed:", error);
  });
});

async function ensureDefaultOptions() {
  const stored = await chrome.storage.sync.get(OPTIONS_KEY);
  const current = normalizeOptions(stored[OPTIONS_KEY]);
  await chrome.storage.sync.set({
    [OPTIONS_KEY]: current
  });
}

async function ensureContextMenus() {
  await chrome.contextMenus.removeAll();

  await createMenu({
    id: MENU_IDS.OPEN,
    title: "Base64をdecodeして開く",
    contexts: ["selection"]
  });

  await createMenu({
    id: MENU_IDS.PREVIEW,
    title: "Base64をdecodeして結果を確認",
    contexts: ["selection"]
  });
}

function createMenu(options) {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(options, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function handleMenuClick(info) {
  const menuItemId = String(info.menuItemId || "");
  if (!Object.values(MENU_IDS).includes(menuItemId)) {
    return;
  }

  const rawSelection = typeof info.selectionText === "string" ? info.selectionText : "";
  const options = await getOptions();
  const analyzed = analyzeSelection(rawSelection, options);
  let finalResult = analyzed;

  const wantsOpen = menuItemId === MENU_IDS.OPEN;
  if (wantsOpen && analyzed.safeUrls.length === 1 && options.autoOpenSafeUrl) {
    await chrome.tabs.create({
      url: analyzed.safeUrls[0].url,
      active: !options.openInBackground
    });

    finalResult = {
      ...analyzed,
      status: "opened",
      message: "安全なURLを新しいタブで開きました。"
    };
  }

  await storeResult(finalResult);

  if (menuItemId === MENU_IDS.PREVIEW || finalResult.status !== "opened") {
    await openResultPage();
  }
}

async function storeResult(result) {
  await chrome.storage.session.set({
    [RESULT_KEY]: {
      ...result,
      createdAt: new Date().toISOString()
    }
  });
}

async function openResultPage() {
  await chrome.tabs.create({
    url: chrome.runtime.getURL("result.html")
  });
}

async function getOptions() {
  const stored = await chrome.storage.sync.get(OPTIONS_KEY);
  return normalizeOptions(stored[OPTIONS_KEY]);
}

function normalizeOptions(raw) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(raw && typeof raw === "object" ? raw : {})
  };

  merged.autoOpenSafeUrl = Boolean(merged.autoOpenSafeUrl);
  merged.openInBackground = Boolean(merged.openInBackground);
  merged.allowHttps = Boolean(merged.allowHttps);
  merged.allowHttp = Boolean(merged.allowHttp);
  merged.allowMagnet = Boolean(merged.allowMagnet);
  merged.tryUrlDecodeBeforeBase64 = Boolean(merged.tryUrlDecodeBeforeBase64);
  merged.inspectUrlContainers = Boolean(merged.inspectUrlContainers);

  const passes = Number.parseInt(String(merged.maxDecodePasses), 10);
  merged.maxDecodePasses = Number.isFinite(passes)
    ? Math.min(5, Math.max(1, passes))
    : DEFAULT_OPTIONS.maxDecodePasses;

  if (!merged.allowHttps && !merged.allowHttp && !merged.allowMagnet) {
    merged.allowHttps = true;
  }

  return merged;
}

function getSafeProtocols(options) {
  const protocols = new Set();
  if (options.allowHttps) protocols.add("https:");
  if (options.allowHttp) protocols.add("http:");
  if (options.allowMagnet) protocols.add("magnet:");
  return protocols;
}

function analyzeSelection(rawSelection, options) {
  const original = rawSelection ?? "";
  const trimmed = original.trim();

  if (!trimmed) {
    return buildResult({
      rawSelection: original,
      status: "empty",
      message: "選択文字列が空です。",
      chosenCandidate: "",
      primaryDecodedText: "",
      safeUrls: [],
      blockedUrls: [],
      candidateAttempts: [],
      detectedType: "empty"
    });
  }

  const seeds = collectSeedCandidates(trimmed, options);
  const analyses = seeds.map((seed) => analyzeSeed(seed, options));
  const best = pickBestAnalysis(analyses);

  if (!best) {
    return buildResult({
      rawSelection: original,
      normalizedSelection: sanitizeInput(trimmed),
      status: "decode-failed",
      message: "Base64 / Base64URL としてdecodeできませんでした。",
      chosenCandidate: "",
      primaryDecodedText: "",
      safeUrls: [],
      blockedUrls: [],
      candidateAttempts: serializeAttempts(analyses),
      detectedType: "unknown"
    });
  }

  let status = "decode-failed";
  let message = "Base64 / Base64URL としてdecodeできませんでした。";

  if (best.safeUrls.length > 1) {
    status = "multi-url";
    message = `安全に開けるURLを ${best.safeUrls.length} 件抽出しました。結果ページで選べます。`;
  } else if (best.safeUrls.length === 1) {
    status = "ready";
    message = "安全に開けるURLを抽出しました。";
  } else if (best.blockedUrls.length > 0) {
    status = "unsafe";
    message = "URL候補は見つかりましたが、許可されていないschemeでした。";
  } else if (best.decodedText) {
    status = "not-url";
    message = "decodeには成功しましたが、安全に開けるURLは見つかりませんでした。";
  }

  return buildResult({
    rawSelection: original,
    normalizedSelection: best.seedValue,
    status,
    message,
    chosenCandidate: best.seedValue,
    primaryDecodedText: best.decodedText,
    safeUrls: best.safeUrls,
    blockedUrls: best.blockedUrls,
    candidateAttempts: serializeAttempts(analyses),
    detectedType: best.detectedType
  });
}

function buildResult(partial) {
  return {
    rawSelection: partial.rawSelection ?? "",
    normalizedSelection: partial.normalizedSelection ?? "",
    chosenCandidate: partial.chosenCandidate ?? "",
    primaryDecodedText: partial.primaryDecodedText ?? "",
    safeUrls: Array.isArray(partial.safeUrls) ? partial.safeUrls : [],
    blockedUrls: Array.isArray(partial.blockedUrls) ? partial.blockedUrls : [],
    candidateAttempts: Array.isArray(partial.candidateAttempts) ? partial.candidateAttempts : [],
    status: partial.status ?? "unknown",
    message: partial.message ?? "",
    detectedType: partial.detectedType ?? "unknown"
  };
}

function serializeAttempts(analyses) {
  return (analyses || []).map((analysis) => ({
    candidate: analysis.seedValue,
    candidatePreview: shorten(analysis.seedValue, 140),
    seedLabel: analysis.seedLabel,
    score: analysis.score,
    safeUrls: analysis.safeUrls,
    blockedUrls: analysis.blockedUrls,
    passes: analysis.passes
  }));
}

function collectSeedCandidates(rawValue, options) {
  const seeds = [];
  const seen = new Set();

  const push = (value, label) => {
    const sanitized = sanitizeInput(value);
    if (!sanitized || sanitized.length < 8 || seen.has(sanitized)) {
      return;
    }
    seen.add(sanitized);
    seeds.push({ value: sanitized, label });
  };

  push(rawValue, "selection");

  if (options.tryUrlDecodeBeforeBase64 && /%[0-9A-Fa-f]{2}/.test(rawValue)) {
    try {
      push(decodeURIComponent(rawValue), "selection:url-decoded");
    } catch {
      // Ignore invalid percent-encoding.
    }
  }

  for (const token of extractPotentialBase64Tokens(rawValue)) {
    push(token, "selection:token");
  }

  if (options.inspectUrlContainers) {
    for (const item of extractValuesFromUrlContainers(rawValue, options)) {
      push(item.value, item.label);
    }

    for (const item of extractJsonStringSeeds(rawValue, options)) {
      push(item.value, item.label);
    }
  }

  return seeds.slice(0, MAX_SEED_CANDIDATES);
}

function extractPotentialBase64Tokens(rawValue) {
  const found = [];
  const seen = new Set();

  const push = (value) => {
    const trimmed = String(value || "").trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    found.push(trimmed);
  };

  const assignmentRegex = /(?:^|[^A-Za-z0-9_\-])(?:[A-Za-z0-9_\-]{1,40}[=:])([A-Za-z0-9+/_-]{16,}={0,2})(?=$|[^A-Za-z0-9+/_-])/g;
  for (const match of rawValue.matchAll(assignmentRegex)) {
    push(match[1]);
  }

  const plainRegex = /(?:^|[^A-Za-z0-9+/_-])([A-Za-z0-9+/_-]{16,}={0,2})(?=$|[^A-Za-z0-9+/_-])/g;
  for (const match of rawValue.matchAll(plainRegex)) {
    push(match[1]);
  }

  const jwtRegex = /([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g;
  for (const match of rawValue.matchAll(jwtRegex)) {
    push(match[1]);
  }

  found.sort((a, b) => b.length - a.length);
  return found.slice(0, MAX_TOKEN_CANDIDATES);
}

function extractValuesFromUrlContainers(rawValue, options) {
  const results = [];
  const seen = new Set();
  const urlishValues = new Set();

  const push = (value, label) => {
    if (!value || typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    results.push({ value: trimmed, label });
  };

  const directUrlMatches = rawValue.match(/\b(?:https?:\/\/|magnet:\?)[^\s"'<>]+/gi) || [];
  for (const match of directUrlMatches) {
    urlishValues.add(match);
  }

  const trimmed = rawValue.trim();
  if (/^(?:https?:\/\/|magnet:\?)/i.test(trimmed)) {
    urlishValues.add(trimmed);
  }

  for (const urlish of urlishValues) {
    try {
      const url = new URL(stripWrappingPunctuation(urlish));
      for (const [key, value] of url.searchParams.entries()) {
        push(value, `url:param:${key}`);
        if (options.tryUrlDecodeBeforeBase64 && /%[0-9A-Fa-f]{2}/.test(value)) {
          try {
            push(decodeURIComponent(value), `url:param:${key}:url-decoded`);
          } catch {
            // ignore
          }
        }
      }

      const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
      if (hash && hash.includes("=")) {
        const hashParams = new URLSearchParams(hash);
        for (const [key, value] of hashParams.entries()) {
          push(value, `url:hash:${key}`);
        }
      }

      const segments = url.pathname.split("/").filter(Boolean);
      for (const segment of segments) {
        push(segment, "url:path-segment");
      }
    } catch {
      // Ignore malformed URLs.
    }
  }

  return results;
}

function extractJsonStringSeeds(rawValue, options) {
  const results = [];
  const seen = new Set();

  const push = (value, label) => {
    if (!value || typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    results.push({ value: trimmed, label });
    if (options.tryUrlDecodeBeforeBase64 && /%[0-9A-Fa-f]{2}/.test(trimmed)) {
      try {
        const decoded = decodeURIComponent(trimmed);
        if (decoded && !seen.has(decoded)) {
          seen.add(decoded);
          results.push({ value: decoded, label: `${label}:url-decoded` });
        }
      } catch {
        // ignore
      }
    }
  };

  try {
    const parsed = JSON.parse(rawValue);
    walkJson(parsed, push, "json");
  } catch {
    // Not JSON.
  }

  return results;
}

function analyzeSeed(seed, options) {
  const passes = [];
  const seenDecoded = new Set();
  const safeUrls = [];
  const blockedUrls = [];
  const protocols = getSafeProtocols(options);
  let current = seed.value;
  let lastDecodedText = "";
  let detectedType = "unknown";
  let printableRatio = 0;

  for (let pass = 1; pass <= options.maxDecodePasses; pass += 1) {
    const decoded = tryDecodeCandidate(current);
    if (!decoded.ok) {
      passes.push({
        pass,
        seedLabel: seed.label,
        input: current,
        decodedText: "",
        mode: decoded.mode,
        error: decoded.error,
        classification: "failed",
        printableRatio: 0
      });
      break;
    }

    const decodedText = decoded.text.trim();
    const classification = classifyDecodedText(decodedText);
    const urlInfo = extractUrlInfo(decodedText, protocols, options, pass);

    appendUniqueByKey(safeUrls, urlInfo.safeUrls, (item) => item.url);
    appendUniqueByKey(blockedUrls, urlInfo.blockedUrls, (item) => `${item.protocol}|${item.value}`);

    passes.push({
      pass,
      seedLabel: seed.label,
      input: current,
      decodedText,
      mode: decoded.mode,
      error: "",
      classification,
      printableRatio: decoded.printableRatio
    });

    lastDecodedText = decodedText;
    detectedType = safeUrls.length > 0 ? "url" : classification;
    printableRatio = decoded.printableRatio;

    if (safeUrls.length > 0) {
      break;
    }

    if (!canAttemptNestedDecode(decodedText, seenDecoded)) {
      break;
    }

    seenDecoded.add(decodedText);
    current = sanitizeInput(decodedText);
  }

  const analysis = {
    seedValue: seed.value,
    seedLabel: seed.label,
    decodedText: lastDecodedText,
    safeUrls,
    blockedUrls,
    passes,
    detectedType,
    printableRatio
  };

  analysis.score = scoreAnalysis(analysis);
  return analysis;
}

function pickBestAnalysis(analyses) {
  if (!Array.isArray(analyses) || analyses.length === 0) {
    return null;
  }

  let best = null;
  let bestScore = -Infinity;

  for (const analysis of analyses) {
    const score = analysis.score ?? scoreAnalysis(analysis);
    if (score > bestScore) {
      bestScore = score;
      best = analysis;
    }
  }

  return best;
}

function scoreAnalysis(analysis) {
  let score = 0;
  score += analysis.safeUrls.length * 500;
  score += analysis.blockedUrls.length * 80;
  score += analysis.decodedText ? 40 : 0;
  score += Math.round((analysis.printableRatio || 0) * 20);
  score -= analysis.passes.length;

  switch (analysis.detectedType) {
    case "url":
      score += 80;
      break;
    case "json":
      score += 35;
      break;
    case "m3u8":
      score += 25;
      break;
    case "html":
      score += 10;
      break;
    default:
      break;
  }

  if (analysis.seedLabel === "selection") {
    score += 5;
  }

  return score;
}

function sanitizeInput(value) {
  let text = String(value ?? "").trim();

  text = text
    .replace(/^[`"'“”‘’〈《「『(\[{<]+/, "")
    .replace(/[`"'“”‘’〉》」』)\]}>]+$/, "");

  if (/^data:[^,]+;base64,/i.test(text)) {
    text = text.replace(/^data:[^,]+;base64,/i, "");
  }

  return text.replace(/\s+/g, "");
}

function canAttemptNestedDecode(value, seenDecoded) {
  if (!value || value.length < 8 || seenDecoded.has(value)) {
    return false;
  }

  const compact = sanitizeInput(value);
  if (compact.length < 8) {
    return false;
  }

  return /^(?:[A-Za-z0-9+/_=-]{8,}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.test(compact);
}

function tryDecodeCandidate(input) {
  const normalized = String(input ?? "").trim();
  if (!normalized) {
    return failure("unknown", "入力が空です。");
  }

  const jwtCandidate = tryDecodeJwtPayload(normalized);
  if (jwtCandidate.ok) {
    return jwtCandidate;
  }

  const variants = [
    { mode: "base64", value: normalizeBase64(normalized, false) },
    { mode: "base64url", value: normalizeBase64(normalized, true) }
  ];

  for (const variant of variants) {
    if (!isWellFormedBase64(variant.value)) {
      continue;
    }

    try {
      const binary = atob(variant.value);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const decoded = decodeText(bytes);
      if (!decoded.text || decoded.printableRatio < 0.55) {
        continue;
      }

      return {
        ok: true,
        mode: variant.mode,
        text: decoded.text,
        printableRatio: decoded.printableRatio
      };
    } catch {
      // Try next variant.
    }
  }

  return failure("unknown", "Base64 / Base64URL としてdecodeできませんでした。");
}

function tryDecodeJwtPayload(input) {
  const parts = input.split(".");
  if (parts.length !== 3 || parts.some((item) => !item)) {
    return failure("jwt", "JWTではありません。");
  }

  try {
    const payload = normalizeBase64(parts[1], true);
    if (!isWellFormedBase64(payload)) {
      return failure("jwt", "JWT payloadをdecodeできませんでした。");
    }

    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = decodeText(bytes);
    if (!decoded.text || decoded.printableRatio < 0.7) {
      return failure("jwt", "JWT payloadをdecodeできませんでした。");
    }

    return {
      ok: true,
      mode: "jwt-payload",
      text: decoded.text,
      printableRatio: decoded.printableRatio
    };
  } catch {
    return failure("jwt", "JWT payloadをdecodeできませんでした。");
  }
}

function failure(mode, error) {
  return {
    ok: false,
    mode,
    error
  };
}

function normalizeBase64(input, urlSafe) {
  let text = String(input ?? "").trim().replace(/\s+/g, "");

  if (urlSafe) {
    text = text.replace(/-/g, "+").replace(/_/g, "/");
  }

  text = text.replace(/=+$/g, "");
  const remainder = text.length % 4;
  if (remainder !== 0) {
    text += "=".repeat(4 - remainder);
  }

  return text;
}

function isWellFormedBase64(value) {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function decodeText(bytes) {
  const utf8 = decodeUtf8(bytes);
  const latin1 = decodeLatin1(bytes);

  const utf8Ratio = getPrintableRatio(utf8);
  const latin1Ratio = getPrintableRatio(latin1);

  if (utf8Ratio >= latin1Ratio) {
    return { text: utf8.trim(), printableRatio: utf8Ratio };
  }

  return { text: latin1.trim(), printableRatio: latin1Ratio };
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "";
  }
}

function decodeLatin1(bytes) {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
}

function getPrintableRatio(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return 0;
  }

  let printable = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 32 && code <= 126) ||
      (code >= 160 && code <= 255)
    ) {
      printable += 1;
    }
  }

  return printable / text.length;
}

function classifyDecodedText(text) {
  const trimmed = text.trim();
  if (!trimmed) return "empty";
  if (/^(?:https?:\/\/|magnet:\?)/i.test(trimmed)) return "url";
  if (/^#EXTM3U/i.test(trimmed) || /\.m3u8(?:$|\?)/i.test(trimmed)) return "m3u8";
  if (/^data:/i.test(trimmed)) return "data-url";
  if (/^</.test(trimmed)) return "html";

  try {
    JSON.parse(trimmed);
    return "json";
  } catch {
    return "text";
  }
}

function extractUrlInfo(decodedText, protocols, options, sourcePass) {
  const candidates = collectUrlCandidates(decodedText, options);
  const safeUrls = [];
  const blockedUrls = [];

  for (const candidate of candidates) {
    const normalized = normalizeUrlCandidate(candidate);
    if (!normalized) continue;

    const validated = normalizeAndValidateUrl(normalized, protocols, sourcePass);
    if (validated.safeUrl) {
      appendUniqueByKey(safeUrls, [validated.safeUrl], (item) => item.url);
    } else if (validated.blockedUrl) {
      appendUniqueByKey(blockedUrls, [validated.blockedUrl], (item) => `${item.protocol}|${item.value}`);
    }
  }

  return { safeUrls, blockedUrls };
}

function collectUrlCandidates(decodedText, options) {
  const candidates = [];
  const seen = new Set();

  const push = (value) => {
    if (!value || typeof value !== "string") {
      return;
    }
    const trimmed = stripWrappingPunctuation(value.trim());
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  push(decodedText);

  if (/^(?:https?|magnet)%3A/i.test(decodedText)) {
    try {
      push(decodeURIComponent(decodedText));
    } catch {
      // ignore
    }
  }

  try {
    const parsed = JSON.parse(decodedText);
    walkJson(parsed, (value) => push(value), "json");
  } catch {
    // not JSON
  }

  const directRegex = /\b(?:https?:\/\/|magnet:\?)[^\s"'<>]+/gi;
  for (const match of decodedText.matchAll(directRegex)) {
    push(match[0]);
  }

  const encodedRegex = /\b(?:https?|magnet)%3A[^\s"'<>]+/gi;
  for (const match of decodedText.matchAll(encodedRegex)) {
    try {
      push(decodeURIComponent(match[0]));
    } catch {
      // ignore
    }
  }

  if (options.inspectUrlContainers) {
    for (const item of extractValuesFromUrlContainers(decodedText, options)) {
      push(item.value);
    }
  }

  return candidates;
}

function walkJson(value, push, pathLabel = "json") {
  if (typeof value === "string") {
    push(value, pathLabel);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJson(item, push, `${pathLabel}[${index}]`));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      walkJson(item, push, `${pathLabel}.${key}`);
    }
  }
}

function normalizeUrlCandidate(value) {
  const candidate = stripWrappingPunctuation(value);
  if (!candidate) return null;

  if (/^(?:https?:\/\/|magnet:\?)/i.test(candidate)) {
    return candidate;
  }

  if (/^(?:https?|magnet)%3A/i.test(candidate)) {
    try {
      return decodeURIComponent(candidate);
    } catch {
      return candidate;
    }
  }

  return candidate;
}

function normalizeAndValidateUrl(value, protocols, sourcePass) {
  const candidate = stripWrappingPunctuation(value);

  if (/^magnet:\?/i.test(candidate)) {
    if (protocols.has("magnet:")) {
      return {
        safeUrl: { url: candidate, protocol: "magnet:", host: "", sourcePass, value: candidate },
        blockedUrl: null
      };
    }
    return {
      safeUrl: null,
      blockedUrl: { value: candidate, protocol: "magnet:", reason: "許可されていないscheme", sourcePass }
    };
  }

  try {
    const url = new URL(candidate);
    if (protocols.has(url.protocol)) {
      return {
        safeUrl: { url: url.href, protocol: url.protocol, host: url.host, sourcePass, value: candidate },
        blockedUrl: null
      };
    }

    return {
      safeUrl: null,
      blockedUrl: { value: url.href, protocol: url.protocol, reason: "許可されていないscheme", sourcePass }
    };
  } catch {
    return { safeUrl: null, blockedUrl: null };
  }
}

function stripWrappingPunctuation(value) {
  return String(value ?? "")
    .replace(/^[`"'([{<]+/, "")
    .replace(/[`"')\]}>.,;!?]+$/g, "");
}

function appendUniqueByKey(target, values, keyFn) {
  const existing = new Set(target.map((item) => keyFn(item)));
  for (const value of values) {
    const key = keyFn(value);
    if (!existing.has(key)) {
      existing.add(key);
      target.push(value);
    }
  }
}

function shorten(value, maxLength) {
  const text = String(value ?? "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}
