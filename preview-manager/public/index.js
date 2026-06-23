const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

function send(res, statusCode, fileName, contentType) {
  const body = fs.readFileSync(path.join(ROOT, fileName));
  res.statusCode = statusCode;
  res.setHeader("content-type", contentType);
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

module.exports = function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

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
