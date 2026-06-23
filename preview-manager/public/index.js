const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = __dirname;
const NOTION_VERSION = process.env.NOTION_VERSION || "2022-06-28";

function send(res, statusCode, fileName, contentType) {
  const body = fs.readFileSync(path.join(ROOT, fileName));
  res.statusCode = statusCode;
  res.setHeader("content-type", contentType);
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

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

async function notionStatus(res) {
  const token = process.env.NOTION_API_TOKEN || "";
  const databaseId = process.env.NOTION_DATABASE_ID || "";

  if (!token || !databaseId) {
    json(res, 200, {
      configured: false,
      ok: false,
      message: "Vercelの環境変数 NOTION_API_TOKEN / NOTION_DATABASE_ID が未設定です。"
    });
    return;
  }

  try {
    const database = await notionRequest(`databases/${encodeURIComponent(databaseId)}`);
    const title = (database.title || []).map((item) => item.plain_text || "").join("").trim();
    json(res, 200, {
      configured: true,
      ok: true,
      databaseTitle: title || "タイトル未設定",
      propertyCount: Object.keys(database.properties || {}).length,
      message: "Notion接続OK"
    });
  } catch (error) {
    json(res, 200, {
      configured: true,
      ok: false,
      message: error.message || "Notion接続に失敗しました。"
    });
  }
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (pathname === "/api/notion-status") {
    await notionStatus(res);
    return;
  }

  if (pathname === "/styles.css") {
    send(res, 200, "styles.css", "text/css; charset=utf-8");
    return;
  }

  if (pathname === "/browser.js") {
    send(res, 200, "browser.js", "application/javascript; charset=utf-8");
    return;
  }

  send(res, 200, "index.html", "text/html; charset=utf-8");
};
