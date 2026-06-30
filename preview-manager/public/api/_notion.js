const https = require("https");
const crypto = require("crypto");

const NOTION_VERSION = process.env.NOTION_VERSION || "2022-06-28";

const PROP_COMPANY = "法人名";
const PROP_STATUS = "現在ステータス";
const PROP_START = "受講開始日";
const PROP_END = "受講終了日";
const PROP_GROUP_ID = "OneStreamグループID";
const PROP_GROUP_NAME = "OneStreamグループ名";
const PROP_CHAT_SUPPORT = "チャットサポート";
const PROP_LEARNER_COUNT = "受講者数";
const PROP_MEETING_LAST_CANDIDATES = ["前回の面談日", "前回面談日", "最終面談日"];
const PROP_MEETING_COUNT_CANDIDATES = ["総合面談実施回数", "面談実施回数", "面談回数"];
const PROP_MEETING_NEXT_CANDIDATES = ["次回面談予定日", "次回面談日", "次回の面談日"];

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function notionRequest(pathname, body) {
  return new Promise((resolve, reject) => {
    const token = process.env.NOTION_API_TOKEN || "";
    const payload = body ? JSON.stringify(body) : "";
    const request = https.request({
      method: body ? "POST" : "GET",
      hostname: "api.notion.com",
      path: `/v1/${pathname}`,
      headers: {
        authorization: `Bearer ${token}`,
        "notion-version": NOTION_VERSION,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload)
      },
      timeout: 20000
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = {};
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = { raw: text };
          }
        }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(parsed);
          return;
        }
        reject(new Error(parsed.message || `Notion API ${response.statusCode}`));
      });
    });

    request.on("timeout", () => request.destroy(new Error("Notion API request timed out.")));
    request.on("error", reject);
    request.end(payload);
  });
}

function requireNotionConfig() {
  const token = process.env.NOTION_API_TOKEN || "";
  const databaseId = process.env.NOTION_DATABASE_ID || "";
  if (!token || !databaseId) {
    throw new Error("Vercelの環境変数 NOTION_API_TOKEN / NOTION_DATABASE_ID が未設定です。");
  }
  return { databaseId };
}

function prop(page, name) {
  return page.properties?.[name] || null;
}

function propAny(page, names) {
  for (const name of names) {
    const value = prop(page, name);
    if (value) return value;
  }
  return null;
}

function textValue(property) {
  if (!property) return "";
  if (property.type === "title") return (property.title || []).map((item) => item.plain_text || "").join("").trim();
  if (property.type === "rich_text") return (property.rich_text || []).map((item) => item.plain_text || "").join("").trim();
  if (property.type === "select") return (property.select?.name || "").trim();
  if (property.type === "status") return (property.status?.name || "").trim();
  if (property.type === "url") return (property.url || "").trim();
  if (property.type === "number") return property.number == null ? "" : String(property.number);
  if (property.type === "formula") return formulaValue(property.formula);
  return "";
}

function formulaValue(formula) {
  if (!formula) return "";
  if (formula.type === "string") return formula.string || "";
  if (formula.type === "number") return formula.number == null ? "" : String(formula.number);
  if (formula.type === "boolean") return formula.boolean ? "true" : "false";
  if (formula.type === "date") return formula.date?.start || "";
  return "";
}

function numberValue(property) {
  if (!property) return 0;
  if (property.type === "number" && property.number != null) return Number(property.number || 0);
  const text = textValue(property);
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateText(property) {
  if (!property) return "";
  if (property.type === "date" && property.date?.start) return property.date.start.slice(0, 10);
  if (property.type === "formula" && property.formula?.type === "date" && property.formula.date?.start) {
    return property.formula.date.start.slice(0, 10);
  }
  return "";
}

function endDateFor(startText, explicitEndText) {
  if (explicitEndText) return explicitEndText;
  if (!startText) return "";
  const date = new Date(`${startText}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setFullYear(date.getFullYear() + 1);
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function todayYmdInJst() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function parseYmd(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function diffDays(fromYmd, toYmd = todayYmdInJst()) {
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  if (from === null || to === null) return null;
  return Math.floor((to - from) / 86400000);
}

function stageFor(start, end) {
  const daysSinceStart = diffDays(start);
  const daysUntilEnd = diffDays(todayYmdInJst(), end);
  if (daysSinceStart === null) return { id: "missing_start", label: "開始日未設定", milestone: false };
  if (daysSinceStart < 21) return { id: "start_recent", label: "開始直後", milestone: true };
  if (Math.abs(daysSinceStart - 14) <= 7) return { id: "two_weeks", label: "開始2週間前後", milestone: true };
  if (Math.abs(daysSinceStart - 30) <= 14) return { id: "one_month", label: "開始1か月前後", milestone: true };
  if (Math.abs(daysSinceStart - 90) <= 21) return { id: "three_months", label: "開始3か月前後", milestone: true };
  if (Math.abs(daysSinceStart - 180) <= 30) return { id: "six_months", label: "開始6か月前後", milestone: true };
  if (Math.abs(daysSinceStart - 270) <= 30) return { id: "nine_months", label: "開始9か月前後", milestone: true };
  if (daysUntilEnd !== null && daysUntilEnd <= 14) return { id: "ending_final", label: "終了直前", milestone: true };
  if (daysUntilEnd !== null && daysUntilEnd <= 45) return { id: "ending_soon", label: "終了1か月前", milestone: true };
  return { id: "regular", label: "通常フォロー", milestone: false };
}

function detectDelivery(chatSupportUrl) {
  const url = String(chatSupportUrl || "").trim();
  if (/chatwork\.com/i.test(url)) {
    const roomMatch = url.match(/rid(\d+)/i) || url.match(/[?&]room_id=(\d+)/i);
    return { type: "chatwork", destination: "Notionチャットサポート", roomId: roomMatch ? roomMatch[1] : "", channelId: "" };
  }
  if (/slack\.com/i.test(url)) {
    return { type: "slack", destination: "Notionチャットサポート", roomId: "", channelId: "" };
  }
  return { type: "none", destination: "", roomId: "", channelId: "" };
}

function hashId(id) {
  return crypto.createHash("sha1").update(id).digest("hex").slice(0, 10);
}

function placeholderMessage(companyName, start, end) {
  return [
    `${companyName} ご担当者さま`,
    "",
    "いつもお世話になっております。ホリエモンAI学校です。",
    "",
    "こちらは通知プレビュー用の下書きです。",
    "この企業の直近視聴履歴は、まだこのクラウド版には取り込まれていません。",
    "",
    `受講期間：${start || "-"} ～ ${end || "-"}`,
    "",
    "視聴履歴連携後に、直近2週間の受講状況とおすすめ講義をここへ反映します。"
  ].join("\n");
}

function pageToPreview(page) {
  const company = textValue(prop(page, PROP_COMPANY)) || "名称未設定";
  const statusText = textValue(prop(page, PROP_STATUS));
  const start = dateText(prop(page, PROP_START));
  const end = endDateFor(start, dateText(prop(page, PROP_END)));
  const learnerCount = numberValue(prop(page, PROP_LEARNER_COUNT));
  const groupId = textValue(prop(page, PROP_GROUP_ID));
  const groupName = textValue(prop(page, PROP_GROUP_NAME));
  const chatSupportUrl = textValue(prop(page, PROP_CHAT_SUPPORT));
  const meeting = {
    lastDate: dateText(propAny(page, PROP_MEETING_LAST_CANDIDATES)),
    totalCount: numberValue(propAny(page, PROP_MEETING_COUNT_CANDIDATES)),
    nextDate: dateText(propAny(page, PROP_MEETING_NEXT_CANDIDATES))
  };
  const risks = [];
  if (!groupId) risks.push("OneStreamグループID未設定");
  if (!chatSupportUrl) risks.push("通知先未設定");

  return {
    id: page.id,
    source: "notion-company-master-live",
    notionPageId: page.id,
    company,
    status: "needs_review",
    delivery: detectDelivery(chatSupportUrl),
    contract: { start, end },
    stage: stageFor(start, end),
    meeting,
    reviewer: "",
    sentAt: "",
    sentBy: "",
    updatedAt: page.last_edited_time || new Date().toISOString(),
    stats: {
      registeredUsers: learnerCount,
      activeUsers: 0,
      totalLogs: 0,
      uniqueVideos: 0,
      totalWatchSeconds: 0,
      totalWatchTime: "0時間0分",
      latestAt: "-",
      periodStart: "",
      periodEnd: "",
      batchFailures: 0
    },
    learners: [],
    recommendations: [
      { title: "ChatGPTの概要と全体像", reason: "受講開始時にも案内しやすい基礎講義です。" }
    ],
    risks,
    message: placeholderMessage(company, start, end),
    notes: [
      statusText ? `現在ステータス：${statusText}` : "",
      groupId ? `OneStreamグループID：${groupId}` : "",
      groupName ? `OneStreamグループ名：${groupName}` : ""
    ].filter(Boolean).join("\n"),
    activity: [
      {
        id: `notion-${hashId(page.id)}`,
        at: page.last_edited_time || new Date().toISOString(),
        operator: "Notion",
        action: "Notionから取得",
        detail: "受講企業マスター"
      }
    ],
    notionMeta: { statusText, groupId, groupName, chatSupportUrl }
  };
}

async function queryCompanyPages({ pageSize = 100, maxPages = 10 } = {}) {
  const { databaseId } = requireNotionConfig();
  const results = [];
  let startCursor = "";
  let page = 0;

  do {
    const body = {
      page_size: Math.min(Math.max(Number(pageSize) || 100, 1), 100)
    };
    if (startCursor) body.start_cursor = startCursor;

    const response = await notionRequest(`databases/${encodeURIComponent(databaseId)}/query`, body);
    results.push(...(response.results || []));
    startCursor = response.has_more ? response.next_cursor : "";
    page += 1;
  } while (startCursor && page < maxPages);

  return results;
}

function countsFor(previews) {
  return previews.reduce((counts, preview) => {
    counts[preview.status] = (counts[preview.status] || 0) + 1;
    return counts;
  }, {});
}

function filterPreviews(previews, query) {
  const status = query.get("status") || "";
  const delivery = query.get("delivery") || "";
  const stage = query.get("stage") || "";
  const q = (query.get("q") || "").trim().toLowerCase();
  return previews.filter((preview) => {
    if (status && preview.status !== status) return false;
    if (delivery && (preview.delivery?.type || "none") !== delivery) return false;
    if (stage && preview.stage?.id !== stage) return false;
    if (q && !preview.company.toLowerCase().includes(q)) return false;
    return true;
  });
}

module.exports = {
  countsFor,
  filterPreviews,
  json,
  notionRequest,
  pageToPreview,
  queryCompanyPages,
  requireNotionConfig
};
