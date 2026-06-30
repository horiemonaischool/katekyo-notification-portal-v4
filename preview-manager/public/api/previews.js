const {
  countsFor,
  filterPreviews,
  json,
  pageToPreview,
  queryCompanyPages
} = require("./_notion");

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const pages = await queryCompanyPages({ pageSize: 100 });
    const allPreviews = pages
      .map(pageToPreview)
      .sort((a, b) => a.company.localeCompare(b.company, "ja"));
    const previews = filterPreviews(allPreviews, url.searchParams);

    json(res, 200, {
      cycle: {
        id: "notion-live",
        label: "Notion受講企業マスター",
        generatedAt: new Date().toISOString()
      },
      counts: countsFor(allPreviews),
      previews
    });
  } catch (error) {
    json(res, 500, {
      error: error.message || "Notion企業一覧の取得に失敗しました。"
    });
  }
};
