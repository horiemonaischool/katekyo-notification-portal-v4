const {
  json,
  notionRequest,
  pageToPreview
} = require("../../_notion");
const {
  fetchCompanyWatchSummary
} = require("../../_onestream");

function numberParam(query, name, fallback, min, max) {
  const value = Number(query.get(name) || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const rawId = req.query?.id || "";
    const pageId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!pageId) {
      json(res, 400, { error: "Preview not found." });
      return;
    }

    const page = await notionRequest(`pages/${encodeURIComponent(pageId)}`);
    const preview = pageToPreview(page);
    const groupId = preview.notionMeta?.groupId || "";
    if (!groupId) {
      json(res, 400, {
        error: "この企業にはOneStreamグループIDが設定されていません。",
        company: preview.company
      });
      return;
    }

    const days = numberParam(url.searchParams, "days", 14, 1, 365);
    const pageSize = numberParam(url.searchParams, "pageSize", 50, 1, 100);
    const maxPages = numberParam(url.searchParams, "maxPages", 5, 1, 20);
    const chunkSize = numberParam(url.searchParams, "chunkSize", 30, 1, 50);
    const maxVideoChunks = numberParam(url.searchParams, "maxVideoChunks", 1, 0, 200);

    const result = await fetchCompanyWatchSummary({
      groupId,
      days,
      pageSize,
      maxPages,
      chunkSize,
      maxVideoChunks
    });

    json(res, 200, {
      company: preview.company,
      groupId,
      mode: maxVideoChunks > 0 ? "limited-test" : "full",
      note: maxVideoChunks > 0
        ? "初期テストのため、動画チャンク数を制限しています。全件確認は maxVideoChunks=0 を指定してください。"
        : "指定期間・取得上限内で全動画チャンクを確認しました。",
      ...result
    });
  } catch (error) {
    json(res, 500, {
      error: error.message || "OneStream視聴履歴の取得に失敗しました。"
    });
  }
};
