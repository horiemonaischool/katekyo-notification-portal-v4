const https = require("https");

const NOTION_VERSION = process.env.NOTION_VERSION || "2022-06-28";

function notionRequest(pathname) {
  return new Promise((resolve, reject) => {
    const token = process.env.NOTION_API_TOKEN || "";
    const request = https.request({
      method: "GET",
      hostname: "api.notion.com",
      path: `/v1/${pathname}`,
      headers: {
        authorization: `Bearer ${token}`,
        "notion-version": NOTION_VERSION
      },
      timeout: 15000
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
    request.end();
  });
}

module.exports = async function handler(req, res) {
  const token = process.env.NOTION_API_TOKEN || "";
  const databaseId = process.env.NOTION_DATABASE_ID || "";

  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");

  if (!token || !databaseId) {
    res.statusCode = 200;
    res.end(JSON.stringify({
      configured: false,
      ok: false,
      message: "Vercelの環境変数 NOTION_API_TOKEN / NOTION_DATABASE_ID が未設定です。"
    }));
    return;
  }

  try {
    const database = await notionRequest(`databases/${encodeURIComponent(databaseId)}`);
    const title = (database.title || []).map((item) => item.plain_text || "").join("").trim();
    res.statusCode = 200;
    res.end(JSON.stringify({
      configured: true,
      ok: true,
      databaseTitle: title || "タイトル未設定",
      propertyCount: Object.keys(database.properties || {}).length,
      message: "Notion接続OK"
    }));
  } catch (error) {
    res.statusCode = 200;
    res.end(JSON.stringify({
      configured: true,
      ok: false,
      message: error.message || "Notion接続に失敗しました。"
    }));
  }
};
