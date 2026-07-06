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
const PROP_CHATWORK_ROOM_ID_CANDIDATES = [
  "ChatworkルームID",
  "ChatworkルームＩＤ",
  "ChatworkルームId",
  "Chatwork Room ID",
  "Chatwork RoomId",
  "Chatwork room ID",
  "Chatwork room_id",
  "Chatworkルーム",
  "Chatworkルーム番号",
  "ChatworkグループID",
  "チャットワークルームID",
  "チャットワークルームＩＤ",
  "チャットワークID",
  "チャットワークＩＤ",
  "チャットワークルーム",
  "チャットワークルーム番号",
  "CWルームID",
  "CWルームＩＤ",
  "CW Room ID",
  "CW ID",
  "Chatwork ID",
  "ChatworkURL",
  "Chatwork URL",
  "チャットワークURL",
  "room_id",
  "Room ID",
  "ルームID",
  "ルームＩＤ",
  "ルーム番号",
  "通知先ID",
  "通知先ルームID"
];
const PROP_SLACK_CHANNEL_ID_CANDIDATES = [
  "SlackチャンネルID",
  "SlackチャンネルＩＤ",
  "Slack Channel ID",
  "Slack ChannelId",
  "Slack channel ID",
  "Slack channel_id",
  "Slack ID",
  "Slack URL",
  "SlackURL",
  "チャンネルID",
  "チャンネルＩＤ",
  "チャンネル番号",
  "通知先ID",
  "通知先チャンネルID"
];
const PROP_OVERVIEW_CANDIDATES = ["概要", "備考", "メモ"];
const PROP_MEETING_LAST_CANDIDATES = ["前回の面談日", "前回面談日", "最終面談日"];
const PROP_MEETING_COUNT_CANDIDATES = ["総合面談実施回数", "面談実施回数", "面談回数"];
const PROP_MEETING_NEXT_CANDIDATES = ["次回面談予定日", "次回面談日", "次回の面談日"];
const PROP_SYNC_GROUP_CANDIDATES = ["同期グループ", "自動同期グループ", "OneStream同期グループ"];
const PROP_SYNC_NEXT_CANDIDATES = ["次回視聴履歴取得日", "次回OneStream取得日", "次回同期日"];
const PROP_SYNC_LAST_CANDIDATES = ["最終視聴履歴取得日", "最終OneStream取得日", "最終同期日"];
const PROP_SYNC_STATUS_CANDIDATES = ["最終取得ステータス", "最終同期ステータス", "同期ステータス"];
const PROP_AUTO_SYNC_CANDIDATES = ["自動同期対象", "OneStream自動同期対象"];

const SYNC_SLOT_LABELS = [
  "A週 月曜",
  "A週 火曜",
  "A週 水曜",
  "A週 木曜",
  "A週 金曜",
  "B週 月曜",
  "B週 火曜",
  "B週 水曜",
  "B週 木曜",
  "B週 金曜"
];

const FC_EXCEPTIONS = ["FCSMG", "ミックス(30%)", "FC税理士校"];
const COMPANY_BLACKLIST = ["和同情報システム株式会社", "株式会社トライスパイド"];
const EXCLUDED_STATUS_KEYWORDS = [
  "対象外",
  "打ち止め",
  "サポート打ち止め",
  "ブラックリスト",
  "問題企業",
  "解約",
  "終了",
  "契約終了",
  "停止",
  "休止",
  "失注"
];

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function notionRequestMethod(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const token = process.env.NOTION_API_TOKEN || "";
    const payload = body ? JSON.stringify(body) : "";
    const request = https.request({
      method,
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

function notionRequest(pathname, body) {
  return notionRequestMethod(body ? "POST" : "GET", pathname, body);
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

function propNameAny(page, names) {
  for (const name of names) {
    if (page.properties?.[name]) return name;
  }
  return "";
}

function propertyValueForWrite(property, value) {
  const text = String(value || "").trim();
  if (!property) return null;
  if (property.type === "rich_text") return { rich_text: text ? [{ text: { content: text } }] : [] };
  if (property.type === "url") return { url: text || null };
  if (property.type === "date") return { date: text ? { start: text } : null };
  if (property.type === "number") {
    const number = Number(text);
    return { number: Number.isFinite(number) ? number : null };
  }
  if (property.type === "email") return { email: text || null };
  if (property.type === "phone_number") return { phone_number: text || null };
  return null;
}

function setWritableProperty(properties, page, name, value) {
  const writeValue = propertyValueForWrite(page.properties?.[name], value);
  if (!writeValue) return false;
  properties[name] = writeValue;
  return true;
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
  if (property.type === "phone_number") return (property.phone_number || "").trim();
  if (property.type === "email") return (property.email || "").trim();
  if (property.type === "rollup") return rollupValue(property.rollup);
  if (property.type === "unique_id") {
    const prefix = property.unique_id?.prefix || "";
    const number = property.unique_id?.number;
    return number == null ? "" : `${prefix}${number}`;
  }
  return "";
}

function rollupValue(rollup) {
  if (!rollup) return "";
  if (rollup.type === "number") return rollup.number == null ? "" : String(rollup.number);
  if (rollup.type === "date") return rollup.date?.start || "";
  if (rollup.type === "array") {
    return (rollup.array || [])
      .map((item) => textValue(item))
      .filter(Boolean)
      .join(" ");
  }
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

function ymdFromUtcMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDaysYmd(ymd, days) {
  const time = parseYmd(ymd);
  if (time === null) return "";
  return ymdFromUtcMs(time + days * 86400000);
}

function isBusinessYmd(ymd) {
  const time = parseYmd(ymd);
  if (time === null) return false;
  const day = new Date(time).getUTCDay();
  return day >= 1 && day <= 5;
}

function businessDaysBetween(anchorYmd, targetYmd) {
  let current = anchorYmd;
  let count = 0;
  const targetTime = parseYmd(targetYmd);
  const anchorTime = parseYmd(anchorYmd);
  if (targetTime === null || anchorTime === null || targetTime < anchorTime) return 0;
  while (parseYmd(current) < targetTime) {
    current = addDaysYmd(current, 1);
    if (isBusinessYmd(current)) count += 1;
  }
  return count;
}

function slotForDate(ymd) {
  const anchor = process.env.KATEKYO_SYNC_ANCHOR_DATE || "2026-07-06";
  const index = businessDaysBetween(anchor, ymd) % SYNC_SLOT_LABELS.length;
  return { index, label: SYNC_SLOT_LABELS[index] };
}

function nextDateForSlot(slotIndex, fromYmd = todayYmdInJst()) {
  let current = fromYmd;
  for (let i = 0; i < 21; i += 1) {
    if (isBusinessYmd(current) && slotForDate(current).index === slotIndex) return current;
    current = addDaysYmd(current, 1);
  }
  return "";
}

function hashSlot(id) {
  const hex = hashId(id || "");
  return parseInt(hex.slice(0, 8), 16) % SYNC_SLOT_LABELS.length;
}

function diffDays(fromYmd, toYmd = todayYmdInJst()) {
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  if (from === null || to === null) return null;
  return Math.floor((to - from) / 86400000);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function containsAny(value, keywords) {
  const normalized = normalizeText(value);
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function isContractActive(start, end) {
  const today = parseYmd(todayYmdInJst());
  const startTime = parseYmd(start);
  const endTime = parseYmd(end);
  if (today === null || startTime === null || endTime === null) return false;
  return startTime <= today && today <= endTime;
}

function isFcCompany({ company, groupName, overview }) {
  const haystack = [company, groupName, overview].filter(Boolean).join(" ");
  if (FC_EXCEPTIONS.some((name) => haystack.includes(name))) return false;
  return /(^|[\s　])FC[^A-Za-z0-9ぁ-んァ-ヶ一-龠]|FC/.test(haystack);
}

function exclusionReasons(previewLike) {
  const reasons = [];
  const { company, statusText, start, end, groupName, overview } = previewLike;

  if (COMPANY_BLACKLIST.includes(company)) reasons.push("個別除外企業");
  if (!isContractActive(start, end)) reasons.push("契約期間外");
  if (containsAny(statusText, EXCLUDED_STATUS_KEYWORDS)) reasons.push(`対象外ステータス：${statusText}`);
  if (isFcCompany({ company, groupName, overview })) reasons.push("FC系企業");

  return reasons;
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

function normalizeId(value) {
  return String(value || "").trim();
}

function extractChatworkRoomId(value) {
  const text = String(value || "").trim();
  if (/^\d+$/.test(text)) return text;
  const match = text.match(/rid(\d+)/i) || text.match(/[?&]room_id=(\d+)/i) || text.match(/\/rooms\/(\d+)/i);
  return match ? match[1] : "";
}

function extractSlackChannelId(value) {
  const text = String(value || "").trim();
  if (/^[CGD][A-Z0-9]{8,}$/.test(text)) return text;
  const archiveMatch = text.match(/\/archives\/([CGD][A-Z0-9]+)/i);
  if (archiveMatch) return archiveMatch[1];
  const clientMatch = text.match(/\/client\/[A-Z0-9]+\/([CGD][A-Z0-9]+)/i);
  if (clientMatch) return clientMatch[1];
  const queryMatch = text.match(/[?&](?:channel|channel_id)=([CGD][A-Z0-9]+)/i);
  return queryMatch ? queryMatch[1] : "";
}

function chatworkUrlForRoomId(roomId) {
  return roomId ? `https://www.chatwork.com/#!rid${roomId}` : "";
}

function slackUrlForChannelId(channelId) {
  return channelId ? `https://slack.com/app_redirect?channel=${encodeURIComponent(channelId)}` : "";
}

function detectDelivery(chatSupportUrl, chatworkRoomId = "", slackChannelId = "") {
  const url = String(chatSupportUrl || "").trim();
  const roomId = extractChatworkRoomId(chatworkRoomId) || extractChatworkRoomId(url);
  const channelId = extractSlackChannelId(slackChannelId) || extractSlackChannelId(url);
  if (/chatwork\.com/i.test(url)) {
    return { type: "chatwork", destination: "Notionチャットサポート", roomId, channelId: "" };
  }
  if (/slack\.com/i.test(url)) {
    return { type: "slack", destination: "Notionチャットサポート", roomId: "", channelId };
  }
  if (roomId) {
    return { type: "chatwork", destination: "Notionチャットサポート", roomId, channelId: "" };
  }
  if (channelId) {
    return { type: "slack", destination: "Notionチャットサポート", roomId: "", channelId };
  }
  return { type: "none", destination: "", roomId: "", channelId: "" };
}

function deliveryPropertiesForPage(page, delivery = {}) {
  const properties = {};
  const type = String(delivery.type || "none").trim();
  const roomId = extractChatworkRoomId(delivery.roomId || delivery.destination || "");
  const channelId = extractSlackChannelId(delivery.channelId || delivery.destination || "");

  if (type === "chatwork" && roomId) {
    const roomName = propNameAny(page, PROP_CHATWORK_ROOM_ID_CANDIDATES);
    if (roomName) setWritableProperty(properties, page, roomName, roomId);
    setWritableProperty(properties, page, PROP_CHAT_SUPPORT, chatworkUrlForRoomId(roomId));
  }

  if (type === "slack" && channelId) {
    const channelName = propNameAny(page, PROP_SLACK_CHANNEL_ID_CANDIDATES);
    if (channelName) setWritableProperty(properties, page, channelName, channelId);
    setWritableProperty(properties, page, PROP_CHAT_SUPPORT, slackUrlForChannelId(channelId));
  }

  return properties;
}

function meetingPropertiesForPage(page, meeting = {}) {
  const properties = {};
  const lastName = propNameAny(page, PROP_MEETING_LAST_CANDIDATES);
  const countName = propNameAny(page, PROP_MEETING_COUNT_CANDIDATES);
  const nextName = propNameAny(page, PROP_MEETING_NEXT_CANDIDATES);

  if (lastName && Object.prototype.hasOwnProperty.call(meeting, "lastDate")) {
    setWritableProperty(properties, page, lastName, meeting.lastDate || "");
  }
  if (countName && Object.prototype.hasOwnProperty.call(meeting, "totalCount")) {
    setWritableProperty(properties, page, countName, meeting.totalCount == null ? "" : String(meeting.totalCount));
  }
  if (nextName && Object.prototype.hasOwnProperty.call(meeting, "nextDate")) {
    setWritableProperty(properties, page, nextName, meeting.nextDate || "");
  }

  return properties;
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
  const chatworkRoomId = normalizeId(textValue(propAny(page, PROP_CHATWORK_ROOM_ID_CANDIDATES)));
  const slackChannelId = normalizeId(textValue(propAny(page, PROP_SLACK_CHANNEL_ID_CANDIDATES)));
  const overview = textValue(propAny(page, PROP_OVERVIEW_CANDIDATES));
  const derivedSlot = hashSlot(page.id || company);
  const syncGroupText = textValue(propAny(page, PROP_SYNC_GROUP_CANDIDATES));
  const syncNextDate = dateText(propAny(page, PROP_SYNC_NEXT_CANDIDATES));
  const syncLastDate = dateText(propAny(page, PROP_SYNC_LAST_CANDIDATES));
  const syncStatus = textValue(propAny(page, PROP_SYNC_STATUS_CANDIDATES));
  const autoSyncText = textValue(propAny(page, PROP_AUTO_SYNC_CANDIDATES));
  const autoSync = !/^(false|0|no|off|対象外)$/i.test(String(autoSyncText || "").trim());
  const meeting = {
    lastDate: dateText(propAny(page, PROP_MEETING_LAST_CANDIDATES)),
    totalCount: numberValue(propAny(page, PROP_MEETING_COUNT_CANDIDATES)),
    nextDate: dateText(propAny(page, PROP_MEETING_NEXT_CANDIDATES))
  };
  const risks = [];
  if (!groupId) risks.push("OneStreamグループID未設定");
  if (!chatSupportUrl) risks.push("通知先未設定");
  const excludedReasons = exclusionReasons({ company, statusText, start, end, groupName, overview });

  return {
    id: page.id,
    source: "notion-company-master-live",
    notionPageId: page.id,
    company,
    status: "needs_review",
    delivery: detectDelivery(chatSupportUrl, chatworkRoomId, slackChannelId),
    contract: { start, end },
    stage: stageFor(start, end),
    sync: {
      slot: derivedSlot,
      group: syncGroupText || SYNC_SLOT_LABELS[derivedSlot],
      nextDate: syncNextDate || nextDateForSlot(derivedSlot),
      lastDate: syncLastDate || "",
      status: syncStatus || "未取得",
      autoSync
    },
    target: {
      eligible: excludedReasons.length === 0,
      excludedReasons
    },
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
    notionMeta: { statusText, groupId, groupName, chatSupportUrl, overview }
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

function buildSyncPlan(previews, today = todayYmdInJst()) {
  const eligible = previews.filter((preview) => preview.target?.eligible && preview.sync?.autoSync !== false);
  const days = [];
  let current = today;
  while (days.length < SYNC_SLOT_LABELS.length) {
    if (isBusinessYmd(current)) {
      const slot = slotForDate(current);
      const companies = eligible
        .filter((preview) => Number(preview.sync?.slot) === slot.index)
        .sort((a, b) => a.company.localeCompare(b.company, "ja"));
      days.push({
        date: current,
        slot: slot.index,
        label: slot.label,
        count: companies.length,
        readyCount: companies.filter((preview) => preview.delivery?.type !== "none" && !preview.risks?.includes("OneStreamグループID未設定")).length,
        missingDeliveryCount: companies.filter((preview) => preview.delivery?.type === "none").length,
        missingGroupCount: companies.filter((preview) => preview.risks?.includes("OneStreamグループID未設定")).length,
        companies: companies.map((preview) => ({
          id: preview.id,
          company: preview.company,
          deliveryType: preview.delivery?.type || "none",
          nextDate: preview.sync?.nextDate || current,
          lastDate: preview.sync?.lastDate || "",
          status: preview.sync?.status || "未取得",
          risks: preview.risks || []
        }))
      });
    }
    current = addDaysYmd(current, 1);
  }

  return {
    today,
    cycle: "10営業日で1周（各企業は約2週間に1回）",
    dailyTarget: Math.ceil(eligible.length / SYNC_SLOT_LABELS.length),
    totalCompanies: eligible.length,
    days
  };
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
  buildSyncPlan,
  deliveryPropertiesForPage,
  filterPreviews,
  json,
  meetingPropertiesForPage,
  notionRequest,
  notionRequestMethod,
  pageToPreview,
  propAny,
  propNameAny,
  queryCompanyPages,
  requireNotionConfig,
  dateText,
  numberValue,
  slotForDate,
  textValue,
  todayYmdInJst
};
