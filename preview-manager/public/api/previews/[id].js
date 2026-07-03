const {
  deliveryPropertiesForPage,
  json,
  notionRequestMethod,
  notionRequest,
  pageToPreview
} = require("../_notion");

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") {
      resolve(req.body);
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  try {
    const rawId = req.query?.id || "";
    const pageId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!pageId) {
      json(res, 400, { error: "Preview not found." });
      return;
    }

    const page = await notionRequest(`pages/${encodeURIComponent(pageId)}`);
    if (req.method === "PATCH") {
      const body = await readBody(req);
      const properties = {};

      if (body.delivery) {
        Object.assign(properties, deliveryPropertiesForPage(page, body.delivery));
      }

      if (Object.keys(properties).length === 0) {
        json(res, 400, {
          error: "保存できる通知先IDが見つかりませんでした。Chatworkは数字のルームID、SlackはCから始まるチャンネルIDを入力してください。"
        });
        return;
      }

      const updatedPage = await notionRequestMethod("PATCH", `pages/${encodeURIComponent(pageId)}`, { properties });
      json(res, 200, { preview: pageToPreview(updatedPage), saved: true });
      return;
    }

    json(res, 200, { preview: pageToPreview(page) });
  } catch (error) {
    json(res, 404, { error: error.message || "Preview not found." });
  }
};
