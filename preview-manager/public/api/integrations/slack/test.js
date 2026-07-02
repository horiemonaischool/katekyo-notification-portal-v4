const https = require("https");

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function slackRequest() {
  return new Promise((resolve, reject) => {
    const token = process.env.SLACK_POSTING_BOT_TOKEN || "";
    const request = https.request({
      method: "POST",
      hostname: "slack.com",
      path: "/api/auth.test",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      timeout: Number(process.env.SLACK_TIMEOUT_MS || 15000)
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
        if (response.statusCode >= 200 && response.statusCode < 300 && parsed.ok) {
          resolve(parsed);
          return;
        }
        reject(new Error(parsed.error || `Slack API ${response.statusCode}`));
      });
    });

    request.on("timeout", () => request.destroy(new Error("Slack API request timed out.")));
    request.on("error", reject);
    request.end("");
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  if (!process.env.SLACK_POSTING_BOT_TOKEN) {
    json(res, 409, { error: "Slack Bot tokenが未設定です。" });
    return;
  }

  try {
    const account = await slackRequest();
    json(res, 200, {
      ok: true,
      account: {
        team: account.team || "",
        user: account.user || "Slack接続OK",
        botId: account.bot_id || ""
      }
    });
  } catch (error) {
    json(res, 502, { error: error.message || "Slack接続確認に失敗しました。" });
  }
};
