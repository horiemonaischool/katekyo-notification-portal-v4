const {
  buildSyncPlan,
  json,
  pageToPreview,
  queryCompanyPages,
  slotForDate,
  todayYmdInJst
} = require("./_notion");
const {
  fetchCompanyWatchSummary
} = require("./_onestream");

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

async function buildSyncRunResponse(query, previews) {
  const date = query.get("date") || todayYmdInJst();
  const run = isRunRequested(query);
  const limit = numberParam(query, "limit", run ? 3 : 50, 1, 50);
  const days = numberParam(query, "days", 14, 1, 365);
  const pageSize = numberParam(query, "pageSize", 50, 1, 100);
  const maxPages = numberParam(query, "maxPages", 5, 1, 20);
  const chunkSize = numberParam(query, "chunkSize", 30, 1, 50);
  const maxVideoChunks = numberParam(query, "maxVideoChunks", run ? 1 : 0, 0, 200);
  const eligible = previews.filter((preview) => preview.target?.eligible && preview.sync?.autoSync !== false);
  const slot = slotForDate(date);
  const targets = eligible
    .filter((preview) => Number(preview.sync?.slot) === slot.index)
    .sort((a, b) => a.company.localeCompare(b.company, "ja"));
  const selected = targets.slice(0, limit);

  const results = [];
  for (const preview of selected) {
    const base = displayRowFromPreview(preview);
    const groupId = base.groupId || "";

    if (!run) {
      results.push({ ...base, status: "dry_run" });
      continue;
    }

    if (!groupId) {
      results.push({ ...base, status: "skipped", error: "OneStreamグループID未設定" });
      continue;
    }

    try {
      const watch = await fetchCompanyWatchSummary({
        groupId,
        days,
        pageSize,
        maxPages,
        chunkSize,
        maxVideoChunks
      });
      results.push({
        ...base,
        status: "fetched",
        batchCount: watch.batchCount,
        failedBatches: watch.failedBatches,
        testedVideoChunks: watch.testedVideoChunks,
        totalVideoChunks: watch.totalVideoChunks,
        summary: compactSummary(watch)
      });
    } catch (error) {
      results.push({
        ...base,
        status: "error",
        error: error.message || "OneStream視聴履歴の取得に失敗しました"
      });
    }
  }

  return {
    date,
    slot,
    run,
    mode: run ? "watch_fetch_test" : "dry_run",
    note: run
      ? "OneStreamから視聴履歴を取得しました。Notion更新と投稿はまだ実行していません。"
      : "今日の同期対象だけ確認しました。OneStream取得、Notion更新、投稿は実行していません。",
    limit,
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
