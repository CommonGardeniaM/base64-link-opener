const OPTIONS_KEY = "options";
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

const form = document.getElementById("settingsForm");
const resetButton = document.getElementById("resetButton");
const statusEl = document.getElementById("status");

const fields = {
  autoOpenSafeUrl: document.getElementById("autoOpenSafeUrl"),
  openInBackground: document.getElementById("openInBackground"),
  maxDecodePasses: document.getElementById("maxDecodePasses"),
  allowHttps: document.getElementById("allowHttps"),
  allowHttp: document.getElementById("allowHttp"),
  allowMagnet: document.getElementById("allowMagnet"),
  tryUrlDecodeBeforeBase64: document.getElementById("tryUrlDecodeBeforeBase64"),
  inspectUrlContainers: document.getElementById("inspectUrlContainers")
};

init().catch((error) => {
  statusEl.textContent = `設定の読み込みに失敗しました: ${error?.message || error}`;
});

async function init() {
  await loadIntoForm();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveFromForm();
  });

  resetButton.addEventListener("click", async () => {
    await chrome.storage.sync.set({ [OPTIONS_KEY]: DEFAULT_OPTIONS });
    await loadIntoForm();
    flashStatus("初期値に戻しました。");
  });
}

async function loadIntoForm() {
  const stored = await chrome.storage.sync.get(OPTIONS_KEY);
  const merged = normalizeOptions(stored[OPTIONS_KEY]);

  for (const [key, field] of Object.entries(fields)) {
    if (field.type === "checkbox") {
      field.checked = Boolean(merged[key]);
    } else {
      field.value = String(merged[key]);
    }
  }
}

async function saveFromForm() {
  const next = normalizeOptions({
    autoOpenSafeUrl: fields.autoOpenSafeUrl.checked,
    openInBackground: fields.openInBackground.checked,
    maxDecodePasses: clampNumber(fields.maxDecodePasses.value, 1, 5, DEFAULT_OPTIONS.maxDecodePasses),
    allowHttps: fields.allowHttps.checked,
    allowHttp: fields.allowHttp.checked,
    allowMagnet: fields.allowMagnet.checked,
    tryUrlDecodeBeforeBase64: fields.tryUrlDecodeBeforeBase64.checked,
    inspectUrlContainers: fields.inspectUrlContainers.checked
  });

  await chrome.storage.sync.set({ [OPTIONS_KEY]: next });
  fields.maxDecodePasses.value = String(next.maxDecodePasses);
  flashStatus("設定を保存しました。");
}

function normalizeOptions(raw) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(raw && typeof raw === "object" ? raw : {})
  };

  const passes = Number.parseInt(String(merged.maxDecodePasses), 10);
  merged.maxDecodePasses = Number.isFinite(passes)
    ? Math.min(5, Math.max(1, passes))
    : DEFAULT_OPTIONS.maxDecodePasses;

  merged.autoOpenSafeUrl = Boolean(merged.autoOpenSafeUrl);
  merged.openInBackground = Boolean(merged.openInBackground);
  merged.allowHttps = Boolean(merged.allowHttps);
  merged.allowHttp = Boolean(merged.allowHttp);
  merged.allowMagnet = Boolean(merged.allowMagnet);
  merged.tryUrlDecodeBeforeBase64 = Boolean(merged.tryUrlDecodeBeforeBase64);
  merged.inspectUrlContainers = Boolean(merged.inspectUrlContainers);

  if (!merged.allowHttps && !merged.allowHttp && !merged.allowMagnet) {
    merged.allowHttps = true;
  }

  return merged;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

let statusTimer = null;
function flashStatus(message) {
  statusEl.textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.textContent = "";
  }, 1800);
}
