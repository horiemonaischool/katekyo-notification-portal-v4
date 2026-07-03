const { json, notionRequest, pageToPreview } = require("../../_notion");

const ACTION_STATUS = {
  start_review: "in_review",
  approve: "approved",
  skip: "skipped",
  reopen: "needs_review",
  mark_sent: "sent"
};

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
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function activityLabel(action) {
  if (action === "start_review") return "確認開始";
  if (action === "approve") return "送信OK";
  if (action === "skip") return "今回は送らない";
  if (action === "reopen") return "要確認へ戻す";
  if (action === "mark_sent") return "送信済みにする";
  return action;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const rawId = req.query?.id || "";
    const pageId = Array.isArray(rawId) ? rawId[0] : rawId;
    const body = await readBody(req);
    const action = String(body.action || "");
    const nextStatus = ACTION_STATUS[action];

    if (!pageId) {
      json(res, 400, { error: "Preview not found." });
      return;
    }
    if (!nextStatus) {
      json(res, 400, { error: "Unknown action." });
      return;
    }

    const page = await notionRequest(`pages/${encodeURIComponent(pageId)}`);
    const preview = pageToPreview(page);
    const now = new Date().toISOString();
    const operator = String(body.operator || "").trim();

    preview.status = nextStatus;
    preview.updatedAt = now;
    if (action === "approve") {
      preview.approvedAt = now;
      preview.approvedBy = operator;
    }
    if (action === "skip") {
      preview.skippedAt = now;
      preview.skippedBy = operator;
    }
    if (action === "start_review") {
      preview.reviewer = operator;
    }
    if (action === "mark_sent") {
      preview.sentAt = now;
      preview.sentBy = operator;
    }

    preview.activity = [
      {
        id: `action-${Date.now()}`,
        at: now,
        operator: operator || "未入力",
        action: activityLabel(action),
        detail: "画面上の一時ステータス変更"
      },
      ...(preview.activity || [])
    ];

    json(res, 200, { preview });
  } catch (error) {
    json(res, 500, { error: error.message || "ステータス変更に失敗しました。" });
  }
};
