const https = require("https");

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function chatworkRequest() {
  return new Promise((resolve, reject) => {
    const token = process.env.CHATWORK_POSTING_API_TOKEN || "";
    const request = https.request({
      method: "GET",
      hostname: "api.chatwork.com",
      path: "/v2/me",
      headers: {
        "x-chatworktoken": token
      },
      timeout: Number(process.env.CHATWORK_TIMEOUT_MS || 15000)
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
        reject(new Error(parsed.errors?.join(" / ") || parsed.message || `Chatwork API ${response.statusCode}`));
      });
    });

    request.on("timeout", () => request.destroy(new Error("Chatwork API request timed out.")));
    request.on("error", reject);
    request.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  if (!process.env.CHATWORK_POSTING_API_TOKEN) {
    json(res, 409, { error: "Chatwork APIトークンが未設定です。" });
    return;
  }

  try {
    const account = await chatworkRequest();
    json(res, 200, {
      ok: true,
      account: {
        id: account.account_id || "",
        name: account.name || "Chatwork接続OK",
        organization: account.organization_name || ""
      }
    });
  } catch (error) {
    json(res, 502, { error: error.message || "Chatwork接続確認に失敗しました。" });
  }
};
