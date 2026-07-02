function truthy(value) {
  return /^(1|true|yes)$/i.test(String(value || ""));
}

function publicConfig() {
  const chatworkConfigured = Boolean(process.env.CHATWORK_POSTING_API_TOKEN || "");
  const slackConfigured = Boolean(process.env.SLACK_POSTING_BOT_TOKEN || "");
  const chatworkEnabled = truthy(process.env.CHATWORK_ENABLE_POSTING);
  const slackEnabled = truthy(process.env.SLACK_ENABLE_POSTING);

  return {
    chatwork: {
      configured: chatworkConfigured,
      enabled: chatworkEnabled,
      mode: chatworkConfigured && chatworkEnabled ? "send_enabled" : "preview_only"
    },
    slack: {
      configured: slackConfigured,
      enabled: slackEnabled,
      mode: slackConfigured && slackEnabled ? "send_enabled" : "preview_only"
    }
  };
}

module.exports = async function handler(req, res) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(publicConfig()));
};
