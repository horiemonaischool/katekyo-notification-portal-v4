const {
  buildSyncPlan,
  dateText,
  json,
  meetingPropertiesForPage,
  notionRequest,
  notionRequestMethod,
  pageToPreview,
  propAny,
  queryCompanyPages,
  slotForDate,
  textValue,
  todayYmdInJst
} = require("./_notion");
const {
  fetchCompanyWatchSummary
} = require("./_onestream");

const MEETING_COMPANY_CANDIDATES = ["受講企業", "受講企業名", "法人名", "会社名", "企業名", "企業", "対象企業"];
const MEETING_DATE_CANDIDATES = ["面談日", "面談実施日", "実施日", "開催日", "日付"];
const MEETING_NEXT_CANDIDATES = ["次回面談予定日", "次回面談日", "次回面談", "次回予定日", "次回"];
const MEETING_STATUS_CANDIDATES = ["ステータス", "状態", "現在ステータス"];
const MEETING_DATABASE_TITLE_CANDIDATES = ["月次面談ログ", "面談ログ", "面談記録", "面談管理"];
const SKIP_STATUS_PATTERN = /(キャンセル|中止|削除|不実施|無効)/;

function numberParam(query, name, fallback, min, max) {
  const value = Number(query.get(name) || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function isRunRequested(query) {
  const value = String(query.get("run") || "").toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function isDryRunRequested(query) {
  const value = String(query.get("dryRun") || "").toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function isMeetingSyncRequested(query) {
  const value = String(query.get("meeting") || "").toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function compactId(id) {
  return String(id || "").replace(/-/g, "").toLowerCase();
}

function normalizeCompanyName(value) {
  return String(value || "").replace(/\s+/g, "").replace(/[　]/g, "").toLowerCase();
}

function normalizeTitle(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function compactSummary(result) {
  const summary = result.summary || {};
  return {
    userCount: summary.userCount || 0,
    activeUsers: summary.activeUsers || 0,
    totalLogs: summary.totalLogs || 0,
    uniqueVideos: summary.uniqueVideos || 0,
    totalWatchSeconds: summary.totalWatchSeconds || 0,
    totalWatchTime: summary.totalWatchTime || "0時間0分",
    latestAt: summary.latestAt || "-",
    recentVideos: summary.recentVideos || []
  };
}

function displayRowFromPreview(preview, status = "pending", extra = {}) {
  return {
    id: preview.id,
    company: preview.company,
    groupId: preview.notionMeta?.groupId || "",
    deliveryType: preview.delivery?.type || "none",
    targetStatus: targetStatus(preview),
    status,
    ...extra
  };
}

function targetStatus(preview) {
  const risks = preview.risks || [];
  if (risks.includes("OneStreamグループID未設定")) return "onestream_missing";
  if ((preview.delivery?.type || "none") === "none") return "delivery_missing";
  return "ready";
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function fetchPreviewWatch(preview, options) {
  const base = displayRowFromPreview(preview);
  const groupId = base.groupId || "";

  if (!groupId) {
    return { ...base, status: "skipped", error: "OneStreamグループID未設定" };
  }

  try {
    const watch = await fetchCompanyWatchSummary({
      groupId,
      days: options.days,
      pageSize: options.pageSize,
      maxPages: options.maxPages,
      chunkSize: options.chunkSize,
      maxVideoChunks: options.maxVideoChunks
    });
    return {
      ...base,
      status: "fetched",
      batchCount: watch.batchCount,
      failedBatches: watch.failedBatches,
      testedVideoChunks: watch.testedVideoChunks,
      totalVideoChunks: watch.totalVideoChunks,
      summary: compactSummary(watch)
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      error: error.message || "OneStream視聴履歴の取得に失敗しました"
    };
  }
}

function propertyText(property) {
  if (!property) return "";
  if (property.type === "date") return property.date?.start?.slice(0, 10) || "";
  if (property.type === "people") return (property.people || []).map((person) => person.name || "").join(" ");
  if (property.type === "relation") return (property.relation || []).map((item) => item.id || "").join(" ");
  if (property.type === "multi_select") return (property.multi_select || []).map((item) => item.name || "").join(" ");
  return textValue(property);
}

function propAnyText(page, names) {
  const direct = propAny(page, names);
  return direct ? propertyText(direct) : "";
}

function relationIds(page) {
  return Object.values(page.properties || {})
    .filter((property) => property?.type === "relation")
    .flatMap((property) => property.relation || [])
    .map((item) => compactId(item.id))
    .filter(Boolean);
}

async function queryDatabase(databaseId, { pageSize = 100, maxPages = 20 } = {}) {
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

function notionObjectTitle(item) {
  const title = item.title || [];
  if (Array.isArray(title)) {
    return title.map((part) => part.plain_text || part.text?.content || "").join("").trim();
  }
  return "";
}

async function findMeetingDatabaseId() {
  const configuredTitle = process.env.NOTION_MEETING_DATABASE_TITLE || "";
  const titleCandidates = [configuredTitle, ...MEETING_DATABASE_TITLE_CANDIDATES].filter(Boolean);

  for (const title of titleCandidates) {
    const response = await notionRequest("search", {
      query: title,
      filter: { property: "object", value: "database" },
      page_size: 10
    });
    const expected = normalizeTitle(title);
    const database = (response.results || []).find((item) => {
      const actual = normalizeTitle(notionObjectTitle(item));
      return actual === expected || actual.includes(expected) || expected.includes(actual);
    });
    if (database?.id) {
      return { id: database.id, title: notionObjectTitle(database), source: "notion_search" };
    }
  }

  return { id: "", title: "", source: "" };
}

function buildCompanyIndex(companyPages) {
  const byId = new Map();
  const byName = new Map();

  for (const page of companyPages) {
    const preview = pageToPreview(page);
    byId.set(compactId(page.id), { page, preview });
    const nameKey = normalizeCompanyName(preview.company);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, { page, preview });
  }

  return { byId, byName };
}

function findCompanyForMeeting(meetingPage, index) {
  for (const id of relationIds(meetingPage)) {
    if (index.byId.has(id)) return index.byId.get(id);
  }

  const companyText = propAnyText(meetingPage, MEETING_COMPANY_CANDIDATES);
  const nameKey = normalizeCompanyName(companyText);
  if (nameKey && index.byName.has(nameKey)) return index.byName.get(nameKey);

  return null;
}

function meetingDate(page) {
  const value = dateText(propAny(page, MEETING_DATE_CANDIDATES)) || propAnyText(page, MEETING_DATE_CANDIDATES).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function nextMeetingDate(page) {
  const value = dateText(propAny(page, MEETING_NEXT_CANDIDATES)) || propAnyText(page, MEETING_NEXT_CANDIDATES).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function applyMeetingRecord(summary, meetingPage, today) {
  const statusText = propAnyText(meetingPage, MEETING_STATUS_CANDIDATES);
  if (SKIP_STATUS_PATTERN.test(statusText)) return;

  const date = meetingDate(meetingPage);
  const nextDate = nextMeetingDate(meetingPage);
  if (date && date <= today) {
    summary.totalCount += 1;
    if (!summary.lastDate || date > summary.lastDate) summary.lastDate = date;
  }
  if (date && date >= today && (!summary.nextDate || date < summary.nextDate)) {
    summary.nextDate = date;
  }
  if (nextDate && nextDate >= today && (!summary.nextDate || nextDate < summary.nextDate)) {
    summary.nextDate = nextDate;
  }
}

function changedMeeting(preview, meeting) {
  return String(preview.meeting?.lastDate || "") !== String(meeting.lastDate || "")
    || Number(preview.meeting?.totalCount || 0) !== Number(meeting.totalCount || 0)
    || String(preview.meeting?.nextDate || "") !== String(meeting.nextDate || "");
}

async function buildMeetingSyncResponse(query, companyPages) {
  const run = isRunRequested(query);
  const today = todayYmdInJst();
  const limit = numberParam(query, "limit", run ? 30 : 100, 1, 200);
  let meetingDatabaseId = process.env.NOTION_MEETING_DATABASE_ID || process.env.MEETING_DATABASE_ID || "";
  let meetingDatabaseSource = meetingDatabaseId ? "environment" : "";
  let meetingDatabaseTitle = "";

  if (!meetingDatabaseId) {
    const found = await findMeetingDatabaseId();
    meetingDatabaseId = found.id;
    meetingDatabaseSource = found.source;
    meetingDatabaseTitle = found.title;
    if (!meetingDatabaseId) {
      return {
        kind: "meeting_sync",
        configured: false,
        run,
        date: today,
        changedCount: 0,
        updatedCount: 0,
        results: [],
        message: "Vercel環境変数 NOTION_MEETING_DATABASE_ID が未設定で、Notion検索でも月次面談ログDBを見つけられませんでした。"
      };
    }
  }

  const index = buildCompanyIndex(companyPages);
  const summaries = new Map();
  for (const { preview } of index.byId.values()) {
    summaries.set(preview.id, {
      preview,
      meeting: { lastDate: "", totalCount: 0, nextDate: "" },
      matchedLogs: 0
    });
  }

  const meetingPages = await queryDatabase(meetingDatabaseId, {
    pageSize: 100,
    maxPages: numberParam(query, "meetingMaxPages", 20, 1, 50)
  });

  for (const meetingPage of meetingPages) {
    const match = findCompanyForMeeting(meetingPage, index);
    if (!match) continue;
    const summary = summaries.get(match.preview.id);
    if (!summary) continue;
    summary.matchedLogs += 1;
    applyMeetingRecord(summary.meeting, meetingPage, today);
  }

  const targets = Array.from(summaries.values())
    .filter((item) => changedMeeting(item.preview, item.meeting))
    .sort((a, b) => a.preview.company.localeCompare(b.preview.company, "ja"))
    .slice(0, limit);

  const results = [];
  for (const item of targets) {
    if (!run) {
      results.push({
        id: item.preview.id,
        company: item.preview.company,
        status: "dry_run",
        matchedLogs: item.matchedLogs,
        meeting: item.meeting
      });
      continue;
    }

    const page = await notionRequest(`pages/${encodeURIComponent(item.preview.id)}`);
    const properties = meetingPropertiesForPage(page, item.meeting);
    if (Object.keys(properties).length === 0) {
      results.push({
        id: item.preview.id,
        company: item.preview.company,
        status: "skipped",
        error: "受講企業マスターに面談用の書き込み可能な列が見つかりません",
        meeting: item.meeting
      });
      continue;
    }

    const updatedPage = await notionRequestMethod("PATCH", `pages/${encodeURIComponent(item.preview.id)}`, { properties });
    const updatedPreview = pageToPreview(updatedPage);
    results.push({
      id: item.preview.id,
      company: item.preview.company,
      status: "updated",
      matchedLogs: item.matchedLogs,
      meeting: updatedPreview.meeting
    });
  }

  return {
    kind: "meeting_sync",
    configured: true,
    run,
    date: today,
    sourceLogCount: meetingPages.length,
    meetingDatabaseSource,
    meetingDatabaseTitle,
    changedCount: targets.length,
    updatedCount: results.filter((item) => item.status === "updated").length,
    limit,
    results,
    message: run
      ? "面談ログから受講企業マスターへ面談情報を更新しました。"
      : "面談ログから更新候補を作成しました。Notion更新はまだ実行していません。"
  };
}

async function buildSyncRunResponse(query, previews) {
  const date = query.get("date") || todayYmdInJst();
  const run = isRunRequested(query);
  const limit = numberParam(query, "limit", run ? 3 : 50, 1, 50);
  const days = numberParam(query, "days", 14, 1, 365);
  const pageSize = numberParam(query, "pageSize", 50, 1, 100);
  const maxPages = numberParam(query, "maxPages", 5, 1, 20);
  const chunkSize = numberParam(query, "chunkSize", 30, 1, 50);
  const maxVideoChunks = numberParam(query, "maxVideoChunks", run ? 1 : 0, 0, 200);
  const concurrency = numberParam(query, "concurrency", run ? 3 : 1, 1, 5);
  const eligible = previews.filter((preview) => preview.target?.eligible && preview.sync?.autoSync !== false);
  const slot = slotForDate(date);
  const targets = eligible
    .filter((preview) => Number(preview.sync?.slot) === slot.index)
    .sort((a, b) => a.company.localeCompare(b.company, "ja"));
  const selected = targets.slice(0, limit);

  const results = run
    ? await mapWithConcurrency(selected, concurrency, (preview) => fetchPreviewWatch(preview, {
        days,
        pageSize,
        maxPages,
        chunkSize,
        maxVideoChunks
      }))
    : selected.map((preview) => ({ ...displayRowFromPreview(preview), status: "dry_run" }));

  return {
    date,
    slot,
    run,
    mode: run ? "watch_fetch_test" : "dry_run",
    note: run
      ? "OneStreamから視聴履歴を取得しました。Notion更新と投稿はまだ実行していません。"
      : "今日の同期対象だけ確認しました。OneStream取得、Notion更新、投稿は実行していません。",
    limit,
    concurrency: run ? concurrency : 0,
    totalEligibleCompanies: eligible.length,
    totalTargets: targets.length,
    selectedCount: selected.length,
    displayRows: selected.map((preview) => displayRowFromPreview(preview, run ? "queued" : "dry_run")),
    results
  };
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const pages = await queryCompanyPages({ pageSize: 100, maxPages: 20 });
    const previews = pages
      .map(pageToPreview)
      .filter((preview) => preview.target?.eligible);

    if (isMeetingSyncRequested(url.searchParams)) {
      json(res, 200, await buildMeetingSyncResponse(url.searchParams, pages));
      return;
    }

    if (isRunRequested(url.searchParams) || isDryRunRequested(url.searchParams)) {
      json(res, 200, await buildSyncRunResponse(url.searchParams, previews));
      return;
    }

    json(res, 200, buildSyncPlan(previews));
  } catch (error) {
    json(res, 500, {
      error: error.message || "同期予定の取得に失敗しました。"
    });
  }
};
