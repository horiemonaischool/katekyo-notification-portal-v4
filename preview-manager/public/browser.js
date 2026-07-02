const state = {
  previews: [],
  counts: {},
  cycle: null,
  selectedId: "",
  statusFilter: "",
  deliveryFilter: "",
  stageFilter: "",
  search: "",
  detail: null,
  fetchingWatchId: "",
  config: {
    chatwork: { configured: false, enabled: false, mode: "preview_only" },
    slack: { configured: false, enabled: false, mode: "preview_only" }
  },
  notion: { configured: false, ok: false, message: "Notion未確認" }
};

const statusLabels = {
  needs_review: "要確認",
  in_review: "確認中",
  approved: "送信OK",
  skipped: "送らない",
  sent: "送信済み"
};

const deliveryLabels = {
  slack: "Slack",
  chatwork: "Chatwork",
  none: "未設定"
};

const els = {
  cycleLabel: document.getElementById("cycleLabel"),
  postingStatus: document.getElementById("postingStatus"),
  notionStatus: document.getElementById("notionStatus"),
  operatorName: document.getElementById("operatorName"),
  refreshButton: document.getElementById("refreshButton"),
  searchInput: document.getElementById("searchInput"),
  deliveryFilter: document.getElementById("deliveryFilter"),
  stageFilter: document.getElementById("stageFilter"),
  previewList: document.getElementById("previewList"),
  detailPanel: document.getElementById("detailPanel"),
  toast: document.getElementById("toast"),
  countAll: document.getElementById("countAll"),
  countNeeds: document.getElementById("countNeeds"),
  countApproved: document.getElementById("countApproved"),
  countSkipped: document.getElementById("countSkipped")
};

const staticSamplePreview = {
  id: "sample-company",
  company: "サンプル株式会社",
  status: "needs_review",
  delivery: { type: "chatwork", destination: "サンプル通知先", roomId: "", channelId: "" },
  contract: { start: "2026-01-15", end: "2027-01-14" },
  stage: { id: "six_months", label: "開始6か月前後", milestone: true },
  meeting: { lastDate: "2026-06-01", totalCount: 3, nextDate: "2026-07-01" },
  reviewer: "",
  sentAt: "",
  sentBy: "",
  updatedAt: new Date().toISOString(),
  stats: {
    registeredUsers: 4,
    activeUsers: 2,
    totalLogs: 8,
    uniqueVideos: 3,
    totalWatchSeconds: 7200,
    totalWatchTime: "2時間0分",
    latestAt: "2026-06-18 10:00",
    periodStart: "2026-06-04T00:00:00Z",
    periodEnd: "2026-06-18T00:00:00Z",
    batchFailures: 0
  },
  learners: [
    { name: "サンプル受講者A", logs: 5, videoCount: 2, watchSeconds: 4200, watchTime: "1時間10分", latestAt: "2026-06-18 10:00" },
    { name: "サンプル受講者B", logs: 3, videoCount: 1, watchSeconds: 3000, watchTime: "0時間50分", latestAt: "2026-06-17 15:00" }
  ],
  recommendations: [
    { title: "ChatGPTの概要と全体像", reason: "受講再開時にも案内しやすい基礎講義です。" }
  ],
  risks: ["サンプルデータ"],
  message: [
    "サンプル株式会社 ご担当者さま",
    "",
    "いつもお世話になっております。ホリエモンAI学校です。",
    "直近の受講状況を共有いたします。",
    "",
    "登録受講者：4人",
    "視聴あり：2人",
    "視聴ログ：8件",
    "推定視聴時間：2時間0分",
    "",
    "■ 直近見られた講義",
    "・ChatGPTの概要と全体像",
    "",
    "引き続き、社内で試しやすいテーマから進めていただければと思います。"
  ].join("\n"),
  notes: "これはVercel表示確認用のサンプルです。",
  activity: [
    { id: "sample-activity", at: new Date().toISOString(), operator: "system", action: "サンプル生成", detail: "Vercel表示確認用" }
  ]
};

function staticApi(path) {
  if (path === "/api/config") {
    return {
      chatwork: { configured: false, enabled: false, mode: "preview_only" },
      slack: { configured: false, enabled: false, mode: "preview_only" }
    };
  }
  if (path.startsWith("/api/previews/sample-company")) {
    return { preview: staticSamplePreview };
  }
  if (path.startsWith("/api/previews")) {
    return {
      cycle: { id: "sample", label: "Vercel表示確認用サンプル", generatedAt: new Date().toISOString() },
      counts: { needs_review: 1 },
      stageCounts: { six_months: 1 },
      previews: [staticSamplePreview]
    };
  }
  throw new Error("This static Vercel preview is read-only.");
}

async function loadNotionStatus() {
  try {
    state.notion = await api("/api/notion-status");
  } catch (error) {
    state.notion = { configured: false, ok: false, message: error.message || "Notion未確認" };
  }
  renderNotionStatus();
}

function operator() {
  return els.operatorName.value.trim() || "未入力";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateTime(value) {
  if (!value || value === "-") return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date).replace(/\//g, "-");
}

function formatPeriod(start, end) {
  return `${formatDateTime(start)} - ${formatDateTime(end)}`;
}

function meetingValue(value) {
  return value === "" || value == null ? "-" : String(value);
}

function meetingCountText(value) {
  const text = meetingValue(value);
  return text === "-" ? "-" : `${text}回`;
}

function durationText(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}時間${minutes}分`;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  try {
    const response = await fetch(path, {
      headers: { "content-type": "application/json" },
      ...options
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    return body;
  } catch (error) {
    if (path.startsWith("/api/")) {
      return staticApi(path);
    }
    throw error;
  }
}

function setOperatorFromStorage() {
  const saved = localStorage.getItem("katekyo.operator") || "";
  const allowed = ["大島", "永島", "中川"];
  els.operatorName.value = allowed.includes(saved) ? saved : "";
}

function saveOperator() {
  localStorage.setItem("katekyo.operator", els.operatorName.value.trim());
}

function queryString() {
  const params = new URLSearchParams();
  if (state.statusFilter) params.set("status", state.statusFilter);
  if (state.deliveryFilter) params.set("delivery", state.deliveryFilter);
  if (state.stageFilter) params.set("stage", state.stageFilter);
  if (state.search) params.set("q", state.search);
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function loadConfig() {
  state.config = await api("/api/config");
  renderConfig();
}

function renderConfig() {
  const chatwork = state.config.chatwork || {};
  const slack = state.config.slack || {};
  let label = "投稿OFF";
  let className = "posting-status posting-off";
  if (chatwork.enabled && chatwork.configured && slack.enabled && slack.configured) {
    label = "Slack/Chatwork投稿ON";
    className = "posting-status posting-on";
  } else if (chatwork.enabled && chatwork.configured) {
    label = "Chatwork投稿ON";
    className = "posting-status posting-on";
  } else if (slack.enabled && slack.configured) {
    label = "Slack投稿ON";
    className = "posting-status posting-on";
  } else if (chatwork.configured || slack.configured) {
    label = "接続設定あり/投稿OFF";
    className = "posting-status posting-standby";
  }
  els.postingStatus.textContent = label;
  els.postingStatus.className = className;
}

function renderNotionStatus() {
  const notion = state.notion || {};
  let label = "Notion未設定";
  let className = "posting-status posting-off";

  if (notion.configured && notion.ok) {
    label = "Notion接続OK";
    className = "posting-status posting-on";
  } else if (notion.configured) {
    label = "Notion接続エラー";
    className = "posting-status posting-standby";
  }

  els.notionStatus.textContent = label;
  els.notionStatus.className = className;
  els.notionStatus.title = notion.message || "";
}

async function loadPreviews() {
  const data = await api(`/api/previews${queryString()}`);
  state.previews = data.previews;
  state.counts = data.counts || {};
  state.cycle = data.cycle || null;
  renderShell();

  if (state.previews.length === 0) {
    state.selectedId = "";
    state.detail = null;
    renderEmpty();
    return;
  }

  if (state.selectedId) {
    const stillVisible = state.previews.some((preview) => preview.id === state.selectedId);
    if (!stillVisible) {
      state.selectedId = state.previews[0].id;
    }
    await loadDetail(state.selectedId);
  } else if (state.previews.length > 0) {
    await loadDetail(state.previews[0].id);
  }
}

async function loadDetail(id) {
  try {
    const data = await api(`/api/previews/${encodeURIComponent(id)}`);
    state.selectedId = id;
    state.detail = data.preview;
    renderList();
    renderDetail();
  } catch (error) {
    if (error.message === "Preview not found." && state.previews.length > 0 && id !== state.previews[0].id) {
      state.selectedId = state.previews[0].id;
      await loadDetail(state.selectedId);
      return;
    }
    throw error;
  }
}

function renderShell() {
  const counts = state.counts;
  const all = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  els.countAll.textContent = all;
  els.countNeeds.textContent = counts.needs_review || 0;
  els.countApproved.textContent = counts.approved || 0;
  els.countSkipped.textContent = counts.skipped || 0;
  els.cycleLabel.textContent = "受講中企業";
  renderList();
}

function renderList() {
  if (state.previews.length === 0) {
    els.previewList.innerHTML = `<div class="empty-state"><p>該当なし</p></div>`;
    return;
  }

  els.previewList.innerHTML = state.previews.map((preview) => {
    const deliveryType = preview.delivery?.type || "none";
    const riskHtml = (preview.risks || []).slice(0, 2)
      .map((risk) => `<span class="risk-badge">${escapeHtml(risk)}</span>`)
      .join("");
    return `
      <button class="preview-item ${preview.id === state.selectedId ? "active" : ""}" data-id="${escapeHtml(preview.id)}" type="button">
        <div class="preview-title-row">
          <span class="preview-title">${escapeHtml(preview.company)}</span>
          <span class="status-badge status-${escapeHtml(preview.status)}">${escapeHtml(statusLabels[preview.status] || preview.status)}</span>
        </div>
        <div class="preview-meta">
          <span>開始 ${escapeHtml(preview.contract?.start || "-")}</span>
          <span class="stage-badge ${preview.stage?.milestone ? "stage-milestone" : ""}">${escapeHtml(preview.stage?.label || "通常フォロー")}</span>
        </div>
        <div class="preview-meta">
          <span>前回面談 ${escapeHtml(meetingValue(preview.meeting?.lastDate))}</span>
          <span>面談 ${escapeHtml(meetingCountText(preview.meeting?.totalCount))}</span>
          <span>次回 ${escapeHtml(meetingValue(preview.meeting?.nextDate))}</span>
        </div>
        <div class="preview-meta">
          <span>${escapeHtml(deliveryLabels[deliveryType] || deliveryType)}</span>
          <span>視聴 ${preview.stats.activeUsers}/${preview.stats.registeredUsers}人</span>
          <span>${preview.stats.totalLogs}件</span>
          <span>${escapeHtml(preview.stats.totalWatchTime || "")}</span>
        </div>
        <div class="preview-meta">${riskHtml || "<span>リスクなし</span>"}</div>
      </button>
    `;
  }).join("");
}

function renderEmpty() {
  els.detailPanel.innerHTML = `
    <div class="empty-state">
      <h2>企業を選択</h2>
      <p>左の一覧からプレビューを開いてください。</p>
    </div>
  `;
}

function renderDetail() {
  const preview = state.detail;
  if (!preview) {
    renderEmpty();
    return;
  }

  const deliveryType = preview.delivery?.type || "none";
  const destination = preview.delivery?.destination || preview.delivery?.channelId || preview.delivery?.roomId || "未設定";
  const roomId = preview.delivery?.roomId || "";
  const channelId = preview.delivery?.channelId || "";
  const meeting = preview.meeting || {};
  const chatwork = state.config.chatwork || {};
  const slack = state.config.slack || {};
  const canPostChatwork = chatwork.enabled && chatwork.configured && deliveryType === "chatwork";
  const canPostSlack = slack.enabled && slack.configured && deliveryType === "slack";
  const sendButtonLabel = canPostChatwork ? "Chatwork送信" : canPostSlack ? "Slack送信" : "送信テスト";
  const isFetchingWatch = state.fetchingWatchId === preview.id;
  const chatworkState = chatwork.configured ? (chatwork.enabled ? "投稿ON" : "設定あり/投稿OFF") : "未設定";
  const slackState = slack.configured ? (slack.enabled ? "投稿ON" : "設定あり/投稿OFF") : "未設定";
  const risks = (preview.risks || []).map((risk) => `<span class="risk-badge">${escapeHtml(risk)}</span>`).join("");
  const sentMeta = preview.sentAt
    ? `<span>最終投稿 ${escapeHtml(formatDateTime(preview.sentAt))}${preview.sentBy ? ` / ${escapeHtml(preview.sentBy)}` : ""}</span>`
    : `<span>最終投稿 -</span>`;
  const recommendations = (preview.recommendations || []).map((rec) => `
    <div class="recommendation">
      <strong>${escapeHtml(rec.title)}</strong>
      <p>${escapeHtml(rec.reason)}</p>
    </div>
  `).join("") || `<p class="muted">候補なし</p>`;

  const learners = (preview.learners || []).map((learner) => `
    <tr>
      <td>${escapeHtml(learner.name)}</td>
      <td class="number">${learner.logs}</td>
      <td class="number">${learner.videoCount}</td>
      <td class="number">${escapeHtml(learner.watchTime)}</td>
      <td>${escapeHtml(learner.latestAt || "-")}</td>
    </tr>
  `).join("");

  const activity = (preview.activity || []).map((item) => `
    <div class="activity">
      <div class="activity-row">
        <strong>${escapeHtml(item.action)}</strong>
        <time>${formatDateTime(item.at)}</time>
      </div>
      <p>${escapeHtml(item.operator)}${item.detail ? ` / ${escapeHtml(item.detail)}` : ""}</p>
    </div>
  `).join("");

  els.detailPanel.innerHTML = `
    <div class="detail-shell">
      <div class="detail-head">
        <div class="detail-title">
          <h2>${escapeHtml(preview.company)}</h2>
          <div class="detail-sub">
            <span class="status-badge status-${escapeHtml(preview.status)}">${escapeHtml(statusLabels[preview.status] || preview.status)}</span>
            <span class="delivery-badge">${escapeHtml(deliveryLabels[deliveryType] || deliveryType)}</span>
            <span class="stage-badge ${preview.stage?.milestone ? "stage-milestone" : ""}">${escapeHtml(preview.stage?.label || "通常フォロー")}</span>
            <span>${escapeHtml(destination)}</span>
            ${sentMeta}
          </div>
        </div>
        <div class="detail-actions">
          <button class="neutral-button" id="fetchWatchButton" type="button" ${isFetchingWatch ? "disabled" : ""}>${isFetchingWatch ? "取得中..." : "視聴履歴を取得"}</button>
          <button class="neutral-button" data-action="start_review" type="button">確認開始</button>
          <button class="success-button" data-action="approve" type="button">送信OK</button>
          <button class="danger-button" data-action="skip" type="button">今回は送らない</button>
          <button class="ghost-button" data-action="reopen" type="button">要確認へ戻す</button>
          <button class="ghost-button" id="sendDryRunButton" type="button">${sendButtonLabel}</button>
        </div>
      </div>

      <div class="detail-body">
        <div class="main-pane">
          <section class="section">
            <div class="metric-grid">
              <div class="metric"><span>登録受講者</span><strong>${preview.stats.registeredUsers}人</strong></div>
              <div class="metric"><span>視聴あり</span><strong>${preview.stats.activeUsers}人</strong></div>
              <div class="metric"><span>視聴ログ</span><strong>${preview.stats.totalLogs}件</strong></div>
              <div class="metric"><span>推定視聴時間</span><strong>${escapeHtml(preview.stats.totalWatchTime)}</strong></div>
              <div class="metric"><span>前回面談日</span><strong>${escapeHtml(meetingValue(meeting.lastDate))}</strong></div>
              <div class="metric"><span>総合面談回数</span><strong>${escapeHtml(meetingCountText(meeting.totalCount))}</strong></div>
              <div class="metric"><span>次回面談予定日</span><strong>${escapeHtml(meetingValue(meeting.nextDate))}</strong></div>
            </div>
            <div class="preview-meta">
              <span>期間 ${escapeHtml(formatPeriod(preview.stats.periodStart, preview.stats.periodEnd))}</span>
              <span>取得失敗 ${preview.stats.batchFailures}件</span>
              <span>最新 ${escapeHtml(preview.stats.latestAt || "-")}</span>
            </div>
          </section>

          <section class="section">
            <h3>通知本文</h3>
            <textarea id="messageEditor">${escapeHtml(preview.message || "")}</textarea>
            <div class="message-actions">
              <button class="primary-button" id="saveMessageButton" type="button">本文を保存</button>
            </div>
          </section>

          <section class="section">
            <h3>受講者別サマリー</h3>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>受講者</th>
                    <th class="number">ログ</th>
                    <th class="number">動画</th>
                    <th class="number">視聴時間</th>
                    <th>最新視聴</th>
                  </tr>
                </thead>
                <tbody>${learners}</tbody>
              </table>
            </div>
          </section>
        </div>

        <aside class="side-pane">
          <section class="section">
            <h3>おすすめ候補</h3>
            <div class="recommendation-list">${recommendations}</div>
          </section>

          <section class="section">
            <h3>通知先</h3>
            <div class="field-grid">
              <label>
                <span>通知方法</span>
                <select id="deliveryTypeEditor">
                  <option value="none" ${deliveryType === "none" ? "selected" : ""}>未設定</option>
                  <option value="chatwork" ${deliveryType === "chatwork" ? "selected" : ""}>Chatwork</option>
                  <option value="slack" ${deliveryType === "slack" ? "selected" : ""}>Slack</option>
                </select>
              </label>
              <label>
                <span>表示名</span>
                <input id="destinationEditor" value="${escapeHtml(destination === "未設定" ? "" : destination)}" placeholder="例：先方Chatworkグループ">
              </label>
              <label>
                <span>ChatworkルームID</span>
                <input id="roomIdEditor" value="${escapeHtml(roomId)}" inputmode="numeric" placeholder="数字のルームID">
              </label>
              <label>
                <span>SlackチャンネルID</span>
                <input id="channelIdEditor" value="${escapeHtml(channelId)}" placeholder="Slack接続時に利用">
              </label>
            </div>
            <button class="primary-button" id="saveDeliveryButton" type="button">通知先を保存</button>
          </section>

          <section class="section">
            <h3>投稿接続</h3>
            <div class="connection-grid">
              <div class="connection-row">
                <span>Chatwork</span>
                <strong>${escapeHtml(chatworkState)}</strong>
                <button class="ghost-button small-button" data-test-integration="chatwork" type="button">確認</button>
              </div>
              <div class="connection-row">
                <span>Slack</span>
                <strong>${escapeHtml(slackState)}</strong>
                <button class="ghost-button small-button" data-test-integration="slack" type="button">確認</button>
              </div>
            </div>
            <p class="muted">接続確認は投稿しません。実投稿は送信OK後、投稿ON設定、確認ダイアログOKの時だけ実行されます。</p>
          </section>

          <section class="section">
            <h3>確認メモ</h3>
            <textarea id="notesEditor" class="note-box">${escapeHtml(preview.notes || "")}</textarea>
            <button class="primary-button" id="saveNotesButton" type="button">メモを保存</button>
          </section>

          <section class="section">
            <h3>注意</h3>
            <div class="risk-list">${risks || "<span class=\"delivery-badge\">なし</span>"}</div>
          </section>

          <section class="section">
            <h3>操作ログ</h3>
            <div class="activity-list">${activity}</div>
          </section>
        </aside>
      </div>
    </div>
  `;
}

function buildWatchMessage(preview, result) {
  const summary = result.summary || {};
  const learners = summary.learners || [];
  const activeLearners = learners
    .filter((learner) => Number(learner.logs || 0) > 0)
    .sort((a, b) => Number(b.watchSeconds || 0) - Number(a.watchSeconds || 0))
    .slice(0, 5);
  const recentVideos = summary.recentVideos || [];
  const lines = [
    `${preview.company} ご担当者さま`,
    "",
    "いつもお世話になっております。ホリエモンAI学校です。",
    "直近の受講状況を共有いたします。",
    "",
    `登録受講者：${summary.userCount ?? preview.stats?.registeredUsers ?? 0}人`,
    `視聴あり：${summary.activeUsers ?? 0}人`,
    `視聴ログ：${summary.totalLogs ?? 0}件`,
    `推定視聴時間：${summary.totalWatchTime || durationText(summary.totalWatchSeconds)}`
  ];

  if (recentVideos.length > 0) {
    lines.push("", "■ 直近見られた講義");
    recentVideos.slice(0, 3).forEach((title) => lines.push(`・${title}`));
  }

  if (activeLearners.length > 0) {
    lines.push("", "■ 受講状況");
    activeLearners.forEach((learner) => {
      lines.push(`・${learner.name}：${learner.watchTime || durationText(learner.watchSeconds)} / ${learner.logs || 0}件`);
    });
  } else {
    lines.push("", "直近では視聴履歴がまだ少ないようです。");
  }

  lines.push(
    "",
    "必要に応じて、次に取り組みやすそうな講義もあわせてご案内いたします。"
  );
  return lines.join("\n");
}

function applyWatchResult(result) {
  const preview = state.detail;
  if (!preview) return;
  const summary = result.summary || {};
  const previousStats = preview.stats || {};
  const learners = (summary.learners || []).map((learner) => ({
    name: learner.name || "-",
    logs: Number(learner.logs || 0),
    videoCount: Number(learner.videoCount || 0),
    watchSeconds: Number(learner.watchSeconds || 0),
    watchTime: learner.watchTime || durationText(learner.watchSeconds),
    latestAt: learner.latestAt ? formatDateTime(learner.latestAt) : "-"
  }));
  const totalWatchSeconds = Number(summary.totalWatchSeconds || 0);
  const risks = (preview.risks || []).filter((risk) => risk !== "直近視聴なし");

  if (Number(summary.totalLogs || 0) === 0) {
    risks.push("直近視聴なし");
  }
  if (Number(result.failedBatches || 0) > 0) {
    risks.push(`視聴履歴の一部取得失敗 ${result.failedBatches}件`);
  }

  preview.stats = {
    ...previousStats,
    registeredUsers: Number(summary.userCount ?? previousStats.registeredUsers ?? 0),
    activeUsers: Number(summary.activeUsers || 0),
    totalLogs: Number(summary.totalLogs || 0),
    uniqueVideos: Number(summary.uniqueVideos || 0),
    totalWatchSeconds,
    totalWatchTime: summary.totalWatchTime || durationText(totalWatchSeconds),
    latestAt: summary.latestAt ? formatDateTime(summary.latestAt) : "-",
    periodStart: summary.after || previousStats.periodStart,
    periodEnd: summary.before || previousStats.periodEnd,
    batchFailures: Number(result.failedBatches || 0)
  };
  preview.learners = learners;
  preview.message = buildWatchMessage(preview, result);
  preview.risks = [...new Set(risks)];

  const recentVideos = summary.recentVideos || [];
  if (recentVideos.length > 0) {
    preview.recommendations = recentVideos.slice(0, 3).map((title) => ({
      title,
      reason: "直近の受講履歴に出ている講義です。必要に応じて次の案内に使えます。"
    }));
  }

  const listIndex = state.previews.findIndex((item) => item.id === preview.id);
  if (listIndex >= 0) {
    state.previews[listIndex] = {
      ...state.previews[listIndex],
      stats: preview.stats,
      learners: preview.learners,
      message: preview.message,
      recommendations: preview.recommendations,
      risks: preview.risks
    };
  }
}

async function fetchWatchHistory() {
  if (!state.selectedId || state.fetchingWatchId) return;
  state.fetchingWatchId = state.selectedId;
  renderDetail();
  toast("視聴履歴を取得しています");
  try {
    const response = await fetch(`/api/previews/${encodeURIComponent(state.selectedId)}/watch?maxVideoChunks=0`, {
      headers: { "content-type": "application/json" }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }
    applyWatchResult(result);
    toast("視聴履歴を反映しました");
    renderList();
    renderDetail();
  } catch (error) {
    toast(error.message || "視聴履歴の取得に失敗しました");
  } finally {
    state.fetchingWatchId = "";
    renderDetail();
  }
}

async function runAction(action) {
  if (!state.selectedId) return;
  try {
    const data = await api(`/api/previews/${encodeURIComponent(state.selectedId)}/actions`, {
      method: "POST",
      body: JSON.stringify({ action, operator: operator() })
    });
    state.detail = data.preview;
    toast("更新しました");
    await loadPreviews();
  } catch (error) {
    toast(error.message);
  }
}

async function saveDetailPatch(patch) {
  if (!state.selectedId) return;
  try {
    const data = await api(`/api/previews/${encodeURIComponent(state.selectedId)}`, {
      method: "PATCH",
      body: JSON.stringify({ ...patch, operator: operator() })
    });
    state.detail = data.preview;
    toast("保存しました");
    await loadPreviews();
  } catch (error) {
    toast(error.message);
  }
}

async function sendDryRun() {
  if (!state.selectedId) return;
  const preview = state.detail;
  const chatwork = state.config.chatwork || {};
  const slack = state.config.slack || {};
  const deliveryType = preview?.delivery?.type || "none";
  const destination = preview?.delivery?.destination || preview?.delivery?.roomId || preview?.delivery?.channelId || "未設定";
  const sendEnabled = (chatwork.enabled && chatwork.configured && deliveryType === "chatwork")
    || (slack.enabled && slack.configured && deliveryType === "slack");
  const providerLabel = deliveryType === "slack" ? "Slack" : deliveryType === "chatwork" ? "Chatwork" : "未設定";

  if (sendEnabled) {
    const ok = window.confirm(`${preview.company} の ${destination} に${providerLabel}投稿します。\n送信後の削除は投稿アカウント側での操作が必要です。\n本当に送信しますか？`);
    if (!ok) return;
  }

  try {
    const data = await api(`/api/previews/${encodeURIComponent(state.selectedId)}/send`, {
      method: "POST",
      body: JSON.stringify({ operator: operator(), confirmText: sendEnabled ? "送信する" : "" })
    });
    state.detail = data.preview;
    toast(`${providerLabel}に送信しました`);
    await loadPreviews();
  } catch (error) {
    toast(error.message || "外部投稿は実行されませんでした");
    await loadDetail(state.selectedId);
  }
}

async function testIntegration(provider) {
  try {
    const data = await api(`/api/integrations/${provider}/test`, {
      method: "POST",
      body: JSON.stringify({ operator: operator() })
    });
    const account = data.account || {};
    const name = account.name || account.user || account.team || "接続OK";
    toast(`${provider === "slack" ? "Slack" : "Chatwork"}接続OK：${name}`);
  } catch (error) {
    toast(error.message);
  }
}

document.addEventListener("click", (event) => {
  const previewButton = event.target.closest(".preview-item");
  if (previewButton) {
    loadDetail(previewButton.dataset.id).catch((error) => toast(error.message));
    return;
  }

  const countButton = event.target.closest(".count-pill");
  if (countButton) {
    document.querySelectorAll(".count-pill").forEach((button) => button.classList.remove("active"));
    countButton.classList.add("active");
    state.statusFilter = countButton.dataset.status || "";
    state.selectedId = "";
    loadPreviews().catch((error) => toast(error.message));
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    runAction(actionButton.dataset.action);
    return;
  }

  const integrationButton = event.target.closest("[data-test-integration]");
  if (integrationButton) {
    testIntegration(integrationButton.dataset.testIntegration);
    return;
  }

  if (event.target.id === "saveMessageButton") {
    saveDetailPatch({ message: document.getElementById("messageEditor").value });
    return;
  }

  if (event.target.id === "saveNotesButton") {
    saveDetailPatch({ notes: document.getElementById("notesEditor").value });
    return;
  }

  if (event.target.id === "saveDeliveryButton") {
    saveDetailPatch({
      delivery: {
        type: document.getElementById("deliveryTypeEditor").value,
        destination: document.getElementById("destinationEditor").value,
        roomId: document.getElementById("roomIdEditor").value,
        channelId: document.getElementById("channelIdEditor").value
      }
    });
    return;
  }

  if (event.target.id === "sendDryRunButton") {
    sendDryRun();
    return;
  }

  if (event.target.id === "fetchWatchButton") {
    fetchWatchHistory();
  }
});

els.refreshButton.addEventListener("click", () => loadPreviews().catch((error) => toast(error.message)));
els.operatorName.addEventListener("change", saveOperator);
els.operatorName.addEventListener("blur", saveOperator);
els.searchInput.addEventListener("input", () => {
  state.search = els.searchInput.value.trim();
  window.clearTimeout(els.searchInput.timer);
  els.searchInput.timer = window.setTimeout(() => {
    state.selectedId = "";
    loadPreviews().catch((error) => toast(error.message));
  }, 180);
});
els.deliveryFilter.addEventListener("change", () => {
  state.deliveryFilter = els.deliveryFilter.value;
  state.selectedId = "";
  loadPreviews().catch((error) => toast(error.message));
});
els.stageFilter.addEventListener("change", () => {
  state.stageFilter = els.stageFilter.value;
  state.selectedId = "";
  loadPreviews().catch((error) => toast(error.message));
});

setOperatorFromStorage();
Promise.all([loadConfig(), loadNotionStatus()])
  .then(loadPreviews)
  .catch((error) => toast(error.message));
