const https = require("https");

function requireOneStreamConfig() {
  const baseUrl = (process.env.ONESTREAM_BASE_URL || "").replace(/\/+$/, "");
  const teamId = process.env.ONESTREAM_TEAM_ID || "";
  const token = process.env.ONESTREAM_API_TOKEN || "";
  if (!baseUrl || !teamId || !token) {
    throw new Error("Vercelの環境変数 ONESTREAM_BASE_URL / ONESTREAM_TEAM_ID / ONESTREAM_API_TOKEN が未設定です。");
  }
  return { baseUrl, teamId, token };
}

function buildQuery(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

function oneStreamRequest(pathname, { method = "GET", query = {}, body = null, timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const { baseUrl, teamId, token } = requireOneStreamConfig();
    const payload = body ? JSON.stringify(body) : "";
    const url = new URL(`${baseUrl}/api/v1/team/${encodeURIComponent(teamId)}/${pathname}${buildQuery(query)}`);
    const request = https.request({
      method,
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      port: url.port || 443,
      protocol: url.protocol,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload)
      },
      timeout: timeoutMs
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
        reject(new Error(parsed.message || `OneStream API ${response.statusCode}`));
      });
    });

    request.on("timeout", () => request.destroy(new Error("OneStream API request timed out.")));
    request.on("error", reject);
    request.end(payload);
  });
}

function itemsFrom(response) {
  for (const key of ["items", "data", "users", "videos", "groups", "logs"]) {
    if (Array.isArray(response?.[key])) return response[key];
  }
  return Array.isArray(response) ? response : [];
}

async function pagedItems(pathname, { query = {}, pageSize = 50, maxPages = 5 } = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await oneStreamRequest(pathname, {
      query: { ...query, page, pageSize },
      timeoutMs: 25000
    });
    const pageItems = itemsFrom(response);
    items.push(...pageItems);
    if (pageItems.length < pageSize) break;
  }
  return items;
}

function splitChunks(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function getUserName(user) {
  return user?.name || user?.display_name || user?.full_name || user?.email || user?.id || "未取得";
}

function getVideoTitle(video) {
  return video?.name || video?.title || video?.video_name || video?.id || "名称未取得";
}

function readLogRows(response, usersById, videosById) {
  const rows = [];
  const userResults = Array.isArray(response) ? response : itemsFrom(response);

  for (const userResult of userResults) {
    const userId = userResult?.user_id || userResult?.userId || userResult?.id;
    const logs = Array.isArray(userResult?.logs) ? userResult.logs : [];
    for (const log of logs) {
      const logUserId = log.user_id || log.userId || userId || "";
      const videoId = log.video_id || log.videoId || log.video?.id || "";
      const watchedAt = log.watched_at || log.watchedAt || log.created_at || log.createdAt || log.updated_at || "";
      const watchSeconds = Number(
        log.actual_watch_seconds ??
        log.actualWatchSeconds ??
        log.watch_seconds ??
        log.watchSeconds ??
        log.duration ??
        0
      );

      rows.push({
        userId: logUserId,
        userName: getUserName(usersById.get(logUserId)),
        videoId,
        videoTitle: getVideoTitle(videosById.get(videoId)),
        watchedAt,
        watchSeconds: Number.isFinite(watchSeconds) ? watchSeconds : 0
      });
    }
  }

  return rows;
}

function durationText(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}時間${minutes}分`;
}

function summarizeWatch({ users, videos, rows, after, before }) {
  const usersByName = new Map();
  const uniqueVideos = new Set();
  let totalWatchSeconds = 0;
  let latestAt = "";

  for (const user of users) {
    const name = getUserName(user);
    usersByName.set(name, { name, logs: 0, videoTitles: new Set(), watchSeconds: 0, latestAt: "" });
  }

  for (const row of rows) {
    const name = row.userName || "未取得";
    const item = usersByName.get(name) || { name, logs: 0, videoTitles: new Set(), watchSeconds: 0, latestAt: "" };
    item.logs += 1;
    item.watchSeconds += row.watchSeconds;
    if (row.videoTitle) item.videoTitles.add(row.videoTitle);
    if (row.videoTitle) uniqueVideos.add(row.videoTitle);
    if (row.watchedAt && row.watchedAt > item.latestAt) item.latestAt = row.watchedAt;
    if (row.watchedAt && row.watchedAt > latestAt) latestAt = row.watchedAt;
    totalWatchSeconds += row.watchSeconds;
    usersByName.set(name, item);
  }

  const learners = Array.from(usersByName.values())
    .map((item) => ({
      name: item.name,
      logs: item.logs,
      videoCount: item.videoTitles.size,
      watchSeconds: item.watchSeconds,
      watchTime: durationText(item.watchSeconds),
      latestAt: item.latestAt || "-"
    }))
    .sort((a, b) => b.logs - a.logs || b.watchSeconds - a.watchSeconds || a.name.localeCompare(b.name, "ja"));

  const recentVideos = rows
    .filter((row) => row.videoTitle)
    .sort((a, b) => String(b.watchedAt || "").localeCompare(String(a.watchedAt || "")))
    .reduce((list, row) => {
      if (!list.includes(row.videoTitle)) list.push(row.videoTitle);
      return list;
    }, [])
    .slice(0, 3);

  return {
    after,
    before,
    userCount: users.length,
    videoCount: videos.length,
    totalLogs: rows.length,
    activeUsers: learners.filter((learner) => learner.logs > 0).length,
    uniqueVideos: uniqueVideos.size,
    totalWatchSeconds,
    totalWatchTime: durationText(totalWatchSeconds),
    latestAt: latestAt || "-",
    recentVideos,
    learners
  };
}

async function fetchCompanyWatchSummary({ groupId, days = 14, pageSize = 50, maxPages = 5, chunkSize = 30, maxVideoChunks = 0 }) {
  if (!groupId) throw new Error("OneStreamグループIDが未設定です。");

  const beforeDate = new Date();
  const afterDate = new Date(beforeDate.getTime() - Number(days || 14) * 86400000);
  const before = beforeDate.toISOString().replace(/\.\d{3}Z$/, "Z");
  const after = afterDate.toISOString().replace(/\.\d{3}Z$/, "Z");

  const users = await pagedItems("users", { query: { groupId }, pageSize, maxPages });
  const videos = await pagedItems("videos", { pageSize, maxPages });
  const userIds = users.map((user) => user.id).filter(Boolean);
  const videoIds = videos.map((video) => video.id).filter(Boolean);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const videosById = new Map(videos.map((video) => [video.id, video]));
  const userChunks = splitChunks(userIds, chunkSize);
  let videoChunks = splitChunks(videoIds, chunkSize);
  if (maxVideoChunks > 0) videoChunks = videoChunks.slice(0, maxVideoChunks);

  const rows = [];
  let batchCount = 0;
  let failedBatches = 0;

  for (const userChunk of userChunks) {
    for (const videoChunk of videoChunks) {
      batchCount += 1;
      try {
        const response = await oneStreamRequest("analytics/video_watch_logs", {
          method: "POST",
          body: {
            userIds: userChunk,
            videoIds: videoChunk,
            after,
            before
          },
          timeoutMs: 30000
        });
        rows.push(...readLogRows(response, usersById, videosById));
      } catch {
        failedBatches += 1;
      }
    }
  }

  return {
    groupId,
    batchCount,
    failedBatches,
    testedVideoChunks: videoChunks.length,
    totalVideoChunks: Math.ceil(videoIds.length / chunkSize),
    summary: summarizeWatch({ users, videos, rows, after, before })
  };
}

module.exports = {
  fetchCompanyWatchSummary,
  requireOneStreamConfig
};
