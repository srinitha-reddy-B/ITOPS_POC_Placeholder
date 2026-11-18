// HTTPS front door for the local client demo at https://tachyon-aura.
//
//   :443  TLS (certificate in %USERPROFILE%\.aura-demo\tachyon-aura.pfx) -> frontend on :3000
//   :80   redirects plain http to https
//
// Run the backend and the frontend first (npm start), then:  node scripts/https-proxy.mjs
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const TARGET_PORT = Number(process.env.AURA_APP_PORT ?? process.env.PORT ?? 3000);
const PFX = process.env.AURA_DEMO_PFX ?? path.join(os.homedir(), ".aura-demo", "tachyon-aura.pfx");
const PASSPHRASE = process.env.AURA_DEMO_PFX_PASS ?? "aura-demo";

function forward(req, res) {
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: TARGET_PORT,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, "x-forwarded-proto": "https" },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`AURA app is not running on port ${TARGET_PORT}: ${err.message}`);
  });
  req.pipe(upstream);
}

https.createServer({ pfx: fs.readFileSync(PFX), passphrase: PASSPHRASE }, forward).listen(443, () =>
  console.log(`https://tachyon-aura -> http://127.0.0.1:${TARGET_PORT}`),
);

http
  .createServer((req, res) => {
    const host = (req.headers.host ?? "tachyon-aura").replace(/:\d+$/, "");
    res.writeHead(301, { location: `https://${host}${req.url ?? "/"}` });
    res.end();
  })
  .listen(80, () => console.log("http://:80 -> https redirect"));
