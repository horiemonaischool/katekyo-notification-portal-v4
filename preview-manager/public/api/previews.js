const {
  countsFor,
  filterPreviews,
  json,
  pageToPreview,
  queryCompanyPages
} = require("./_notion");
const { buildMeetingSyncResponse } = require("./sync-plan");

async function applyMeetingLogOverlay(previews, pages) {
  try {
    const query = new URLSearchParams("meeting=1&dryRun=1&limit=200");
    const meetingResult = await buildMeetingSyncResponse(query, pages);
    const meetingById = new Map(
      (meetingResult.results || [])
        .filter((item) => item.status === "dry_run" && item.meeting)
        .map((item) => [item.id, item.meeting])
    );

    if (!meetingById.size) {
      return {
        previews,
        overlay: {
          ok: true,
          appliedCount: 0,
          candidateCount: meetingResult.changedCount || 0,
          source: meetingResult.meetingDatabaseTitle || meetingResult.meetingDatabaseSource || ""
        }
      };
    }

    return {
      previews: previews.map((preview) => {
        const meeting = meetingById.get(preview.id);
        if (!meeting) return preview;
        return {
          ...preview,
          meeting: { ...(preview.meeting || {}), ...meeting },
          notionMeta: {
            ...(preview.notionMeta || {}),
            meetingSource: "monthly-meeting-log-live"
          }
        };
      }),
      overlay: {
        ok: true,
        appliedCount: meetingById.size,
        candidateCount: meetingResult.changedCount || meetingById.size,
        source: meetingResult.meetingDatabaseTitle || meetingResult.meetingDatabaseSource || ""
      }
    };
  } catch (error) {
    return {
      previews,
      overlay: {
        ok: false,
        appliedCount: 0,
        candidateCount: 0,
        error: error.message || "面談ログの読み取りに失敗しました。"
      }
    };
  }
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const pages = await queryCompanyPages({ pageSize: 100 });
    const basePreviews = pages
      .map(pageToPreview)
      .filter((preview) => preview.target?.eligible)
      .sort((a, b) => a.company.localeCompare(b.company, "ja"));
    const { previews: allPreviews, overlay } = await applyMeetingLogOverlay(basePreviews, pages);
    const previews = filterPreviews(allPreviews, url.searchParams);

    json(res, 200, {
      cycle: {
        id: "notion-live",
        label: "Notion受講企業マスター",
        generatedAt: new Date().toISOString(),
        meetingOverlay: overlay
      },
      counts: countsFor(allPreviews),
      previews
    });
  } catch (error) {
    json(res, 500, {
      error: error.message || "Notion企業一覧の取得に失敗しました。"
    });
  }
};
