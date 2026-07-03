const {
  buildSyncPlan,
  json,
  pageToPreview,
  queryCompanyPages
} = require("./_notion");

module.exports = async function handler(req, res) {
  try {
    const pages = await queryCompanyPages({ pageSize: 100 });
    const previews = pages
      .map(pageToPreview)
      .filter((preview) => preview.target?.eligible);

    json(res, 200, buildSyncPlan(previews));
  } catch (error) {
    json(res, 500, {
      error: error.message || "同期予定の取得に失敗しました。"
    });
  }
};
