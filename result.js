const RESULT_KEY = "latestDecodeResult";

const statusBadge = document.getElementById("statusBadge");
const createdAt = document.getElementById("createdAt");
const messageEl = document.getElementById("message");
const rawSelectionEl = document.getElementById("rawSelection");
const chosenCandidateEl = document.getElementById("chosenCandidate");
const decodedTextEl = document.getElementById("decodedText");
const safeCountEl = document.getElementById("safeCount");
const blockedCountEl = document.getElementById("blockedCount");
const safeUrlListEl = document.getElementById("safeUrlList");
const blockedUrlListEl = document.getElementById("blockedUrlList");
const safeUrlEmptyEl = document.getElementById("safeUrlEmpty");
const blockedEmptyEl = document.getElementById("blockedEmpty");
const openFirstButton = document.getElementById("openFirstButton");
const openAllButton = document.getElementById("openAllButton");
const copyFirstButton = document.getElementById("copyFirstButton");
const candidateAttemptsEl = document.getElementById("candidateAttempts");
const settingsButton = document.getElementById("settingsButton");

init().catch((error) => {
  render({
    status: "error",
    message: `結果の表示に失敗しました: ${error?.message || error}`,
    rawSelection: "",
    chosenCandidate: "",
    primaryDecodedText: "",
    safeUrls: [],
    blockedUrls: [],
    candidateAttempts: []
  });
});

async function init() {
  settingsButton.addEventListener("click", async () => {
    await chrome.runtime.openOptionsPage();
  });

  const stored = await chrome.storage.session.get(RESULT_KEY);
  const result = stored[RESULT_KEY];

  if (!result) {
    render({
      status: "empty",
      message: "まだdecode結果がありません。",
      rawSelection: "",
      chosenCandidate: "",
      primaryDecodedText: "",
      safeUrls: [],
      blockedUrls: [],
      candidateAttempts: []
    });
    return;
  }

  render(result);
}

function render(result) {
  const {
    status = "unknown",
    message = "",
    rawSelection = "",
    chosenCandidate = "",
    primaryDecodedText = "",
    safeUrls = [],
    blockedUrls = [],
    candidateAttempts = [],
    createdAt: createdAtValue = null
  } = result;

  const statusMeta = getStatusMeta(status);

  statusBadge.textContent = statusMeta.label;
  statusBadge.className = `badge ${statusMeta.kind}`.trim();
  messageEl.textContent = message || statusMeta.label;
  rawSelectionEl.textContent = rawSelection || "（空）";

  if (chosenCandidate) {
    chosenCandidateEl.textContent = chosenCandidate;
    chosenCandidateEl.classList.remove("empty");
  } else {
    chosenCandidateEl.textContent = "候補なし";
    chosenCandidateEl.classList.add("empty");
  }

  if (primaryDecodedText) {
    decodedTextEl.textContent = primaryDecodedText;
    decodedTextEl.classList.remove("empty");
  } else {
    decodedTextEl.textContent = "decode結果はありません。";
    decodedTextEl.classList.add("empty");
  }

  if (createdAtValue) {
    const date = new Date(createdAtValue);
    createdAt.textContent = Number.isNaN(date.valueOf()) ? "" : date.toLocaleString();
  } else {
    createdAt.textContent = "";
  }

  renderSafeUrls(safeUrls);
  renderBlockedUrls(blockedUrls);
  renderCandidateAttempts(candidateAttempts);
}

function renderSafeUrls(urls) {
  safeUrlListEl.textContent = "";
  safeCountEl.textContent = String(urls.length);
  safeUrlEmptyEl.hidden = urls.length > 0;

  for (const entry of urls) {
    const li = document.createElement("li");
    li.className = "url-card";

    const link = document.createElement("a");
    link.href = entry.url;
    link.textContent = entry.url;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    li.appendChild(link);

    const meta = document.createElement("div");
    meta.className = "url-meta";
    meta.textContent = [entry.protocol || "", entry.host || "", entry.sourcePass ? `pass ${entry.sourcePass}` : ""].filter(Boolean).join(" / ");
    li.appendChild(meta);

    safeUrlListEl.appendChild(li);
  }

  openFirstButton.hidden = urls.length === 0;
  copyFirstButton.hidden = urls.length === 0;
  openAllButton.hidden = urls.length <= 1;

  openFirstButton.onclick = urls.length > 0 ? () => chrome.tabs.create({ url: urls[0].url }) : null;
  openAllButton.onclick = urls.length > 1 ? async () => {
    for (const entry of urls) {
      await chrome.tabs.create({ url: entry.url });
    }
  } : null;
  copyFirstButton.onclick = urls.length > 0 ? () => copyWithFeedback(copyFirstButton, urls[0].url, "最初のURLをコピー") : null;
}

function renderBlockedUrls(urls) {
  blockedUrlListEl.textContent = "";
  blockedCountEl.textContent = String(urls.length);
  blockedEmptyEl.hidden = urls.length > 0;

  for (const entry of urls) {
    const li = document.createElement("li");
    li.className = "url-card";

    const code = document.createElement("pre");
    code.className = "small-code";
    code.textContent = entry.value || "";
    li.appendChild(code);

    const meta = document.createElement("div");
    meta.className = "url-meta";
    meta.textContent = [entry.protocol || "", entry.reason || "", entry.sourcePass ? `pass ${entry.sourcePass}` : ""].filter(Boolean).join(" / ");
    li.appendChild(meta);

    blockedUrlListEl.appendChild(li);
  }
}

function renderCandidateAttempts(attempts) {
  candidateAttemptsEl.textContent = "";

  if (!Array.isArray(attempts) || attempts.length === 0) {
    candidateAttemptsEl.textContent = "候補の試行履歴はありません。";
    return;
  }

  const sorted = [...attempts].sort((a, b) => (b.score || 0) - (a.score || 0));
  for (const attempt of sorted) {
    const card = document.createElement("section");
    card.className = "attempt-card";

    const top = document.createElement("div");
    top.className = "attempt-top";

    const title = document.createElement("strong");
    title.textContent = attempt.candidatePreview || shorten(attempt.candidate || "", 140);
    top.appendChild(title);

    const badge = document.createElement("span");
    badge.className = "pill muted-pill";
    badge.textContent = `score ${Math.round(attempt.score || 0)}`;
    top.appendChild(badge);

    card.appendChild(top);

    const summary = document.createElement("div");
    summary.className = "attempt-preview";
    summary.textContent = [
      attempt.seedLabel || "candidate",
      `safe ${attempt.safeUrls?.length || 0}`,
      `blocked ${attempt.blockedUrls?.length || 0}`,
      `pass ${attempt.passes?.length || 0}`
    ].join(" / ");
    card.appendChild(summary);

    const passList = document.createElement("ol");
    passList.className = "pass-list";

    for (const entry of attempt.passes || []) {
      const li = document.createElement("li");

      const meta = document.createElement("div");
      meta.className = "pass-meta";
      const parts = [`pass ${entry.pass}`];
      if (entry.mode) parts.push(entry.mode);
      if (entry.classification) parts.push(entry.classification);
      if (entry.error) parts.push(`error: ${entry.error}`);
      meta.textContent = parts.join(" / ");
      li.appendChild(meta);

      const code = document.createElement("pre");
      code.className = "small-code";
      code.textContent = entry.decodedText || entry.input || "結果なし";
      li.appendChild(code);

      passList.appendChild(li);
    }

    card.appendChild(passList);
    candidateAttemptsEl.appendChild(card);
  }
}

async function copyWithFeedback(button, text, defaultLabel) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "コピーしました";
  } catch {
    button.textContent = "コピー失敗";
  }
  setTimeout(() => {
    button.textContent = defaultLabel;
  }, 1400);
}

function shorten(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function getStatusMeta(status) {
  switch (status) {
    case "opened":
      return { label: "URLを開きました", kind: "success" };
    case "ready":
      return { label: "URLを見つけました", kind: "success" };
    case "multi-url":
      return { label: "複数のURL候補があります", kind: "warn" };
    case "unsafe":
      return { label: "危険なschemeをブロックしました", kind: "warn" };
    case "not-url":
      return { label: "decodeは成功、URLではありません", kind: "warn" };
    case "decode-failed":
      return { label: "decodeできませんでした", kind: "error" };
    case "empty":
      return { label: "入力が空です", kind: "warn" };
    default:
      return { label: "結果を確認してください", kind: "" };
  }
}
