const https = require("https");
const { json, notionRequest, pageToPreview } = require("../../_notion");

function truthy(value) {
  return /^(1|true|yes)$/i.test(String(value || ""));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
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

function chatworkMessage(preview) {
  return String(preview.message || "").trim();
}

function slackMessage(preview) {
  return String(preview.message || "").trim();
}

function roomIdFromPreview(preview) {
  const direct = preview.delivery?.roomId || "";
  if (direct) return direct;
  const url = preview.notionMeta?.chatSupportUrl || "";
  const match = String(url).match(/rid(\d+)/i) || String(url).match(/[?&]room_id=(\d+)/i);
  return match ? match[1] : "";
}

function channelIdFromPreview(preview) {
  const direct = preview.delivery?.channelId || "";
  if (direct) return direct;
  const url = preview.notionMeta?.chatSupportUrl || "";
  const archiveMatch = String(url).match(/\/archives\/([A-Z0-9]+)/i);
  if (archiveMatch) return archiveMatch[1];
  const clientMatch = String(url).match(/\/client\/[A-Z0-9]+\/([A-Z0-9]+)/i);
  if (clientMatch) return clientMatch[1];
  return "";
}

function chatworkPost(roomId, message) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams({
      body: message,
      self_unread: process.env.CHATWORK_SELF_UNREAD === "1" ? "1" : "0"
    }).toString();
    const request = https.request({
      method: "POST",
      hostname: "api.chatwork.com",
      path: `/v2/rooms/${encodeURIComponent(roomId)}/messages`,
      headers: {
        "x-chatworktoken": process.env.CHATWORK_POSTING_API_TOKEN || "",
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(payload)
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
    request.end(payload);
  });
}

function slackPost(channel, text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ channel, text });
    const request = https.request({
      method: "POST",
      hostname: "slack.com",
      path: "/api/chat.postMessage",
      headers: {
        authorization: `Bearer ${process.env.SLACK_POSTING_BOT_TOKEN || ""}`,
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload)
      },
      timeout: Number(process.env.SLACK_TIMEOUT_MS || 15000)
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const textBody = Buffer.concat(chunks).toString("utf8");
        let parsed = {};
        if (textBody) {
          try {
            parsed = JSON.parse(textBody);
          } catch {
            parsed = { raw: textBody };
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
    request.end(payload);
  });
}

async function loadPreview(pageId) {
  const page = await notionRequest(`pages/${encodeURIComponent(pageId)}`);
  return pageToPreview(page);
}

function previewWithBodyOverrides(preview, body) {
  const override = body.preview && typeof body.preview === "object" ? body.preview : {};
  const message = typeof body.message === "string" ? body.message : override.message;
  return {
    ...preview,
    delivery: {
      ...(preview.delivery || {}),
      ...(override.delivery || {})
    },
    stats: {
      ...(preview.stats || {}),
      ...(override.stats || {})
    },
    learners: Array.isArray(override.learners) ? override.learners : preview.learners,
    recommendations: Array.isArray(override.recommendations) ? override.recommendations : preview.recommendations,
    risks: Array.isArray(override.risks) ? override.risks : preview.risks,
    notes: typeof override.notes === "string" ? override.notes : preview.notes,
    message: typeof message === "string" && message.trim() ? message : preview.message
  };
}

async function sendChatwork(preview, body) {
  if (!truthy(process.env.CHATWORK_ENABLE_POSTING)) {
    return {
      ok: false,
      blocked: true,
      reason: "Chatwork本番投稿はOFFです。",
      preview
    };
  }
  if (!process.env.CHATWORK_POSTING_API_TOKEN) {
    throw new Error("Chatwork APIトークンが未設定です。");
  }
  if (String(body.confirmText || "") !== (process.env.CHATWORK_CONFIRM_TEXT || "送信する")) {
    throw new Error("確認テキストが一致しないため送信しません。");
  }
  const roomId = roomIdFromPreview(preview);
  if (!roomId) {
    throw new Error("ChatworkルームIDが未設定です。");
  }
  const message = chatworkMessage(preview);
  if (!message) {
    throw new Error("通知本文が空です。");
  }
  const result = await chatworkPost(roomId, message);
  return {
    ok: true,
    provider: "chatwork",
    postId: result.message_id || "",
    preview: {
      ...preview,
      status: "sent",
      sentAt: new Date().toISOString(),
      sentBy: body.operator || ""
    }
  };
}

async function sendSlack(preview, body) {
  if (!truthy(process.env.SLACK_ENABLE_POSTING)) {
    return {
      ok: false,
      blocked: true,
      reason: "Slack本番投稿はOFFです。",
      preview
    };
  }
  if (!process.env.SLACK_POSTING_BOT_TOKEN) {
    throw new Error("Slack Bot tokenが未設定です。");
  }
  if (String(body.confirmText || "") !== (process.env.SLACK_CONFIRM_TEXT || "送信する")) {
    throw new Error("確認テキストが一致しないため送信しません。");
  }
  const channel = channelIdFromPreview(preview);
  if (!channel) {
    throw new Error("SlackチャンネルIDが未設定です。");
  }
  const message = slackMessage(preview);
  if (!message) {
    throw new Error("通知本文が空です。");
  }
  const result = await slackPost(channel, message);
  return {
    ok: true,
    provider: "slack",
    postId: result.ts || "",
    channel: result.channel || channel,
    preview: {
      ...preview,
      status: "sent",
      sentAt: new Date().toISOString(),
      sentBy: body.operator || ""
    }
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const rawId = req.query?.id || "";
    const pageId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!pageId) {
      json(res, 400, { error: "Preview not found." });
      return;
    }

    const body = await readBody(req);
    const preview = previewWithBodyOverrides(await loadPreview(pageId), body);
    const deliveryType = preview.delivery?.type || "none";
    let result;
    if (deliveryType === "chatwork") {
      result = await sendChatwork(preview, body);
    } else if (deliveryType === "slack") {
      result = await sendSlack(preview, body);
    } else {
      json(res, 409, { error: "通知方法が未設定です。", preview });
      return;
    }

    if (result.blocked) {
      json(res, 200, {
        ok: false,
        blocked: true,
        message: result.reason,
        preview: result.preview
      });
      return;
    }

    json(res, 200, result);
  } catch (error) {
    json(res, 500, { error: error.message || "送信処理に失敗しました。" });
  }
};
