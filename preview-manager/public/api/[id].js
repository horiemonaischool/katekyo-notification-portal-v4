const {
  json,
  notionRequest,
  pageToPreview
} = require("../_notion");

module.exports = async function handler(req, res) {
  try {
    const rawId = req.query?.id || "";
    const pageId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!pageId) {
      json(res, 400, { error: "Preview not found." });
      return;
    }

    const page = await notionRequest(`pages/${encodeURIComponent(pageId)}`);
    json(res, 200, { preview: pageToPreview(page) });
  } catch (error) {
    json(res, 404, { error: error.message || "Preview not found." });
  }
};
