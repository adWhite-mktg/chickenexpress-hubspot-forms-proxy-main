import Busboy from "busboy";

const streamToBuffer = (stream) => new Promise((res, rej) => {
  const chunks = [];
  stream.on("data", c => chunks.push(c));
  stream.on("end", () => res(Buffer.concat(chunks)));
  stream.on("error", rej);
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow","POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const bb = Busboy({ headers: req.headers });
  const fields = {};
  const files = {};

  const parsed = new Promise((resolve, reject) => {
    bb.on("field", (name, val) => { fields[name] = val; });
    bb.on("file", async (name, file, info) => {
      const { filename, mimeType } = info;
      try {
        const buf = await streamToBuffer(file);
        files[name] = { filename, mime: mimeType, buffer: buf };
      } catch (e) { reject(e); }
    });
    bb.on("error", reject);
    bb.on("finish", resolve);
  });

  req.pipe(bb);
  await parsed;

  const portalId = fields._portalId;
  const formId   = fields._formId;
  const region   = (fields._region || "na2").toLowerCase();

  if (!portalId || !formId) {
    return res.status(400).json({ error: "Missing _portalId or _formId" });
  }

  // Build outbound multipart
  const out = new FormData();
  for (const [k,v] of Object.entries(fields)) {
    if (k.startsWith("_")) continue;
    out.append(k,v);
  }
  for (const [k,f] of Object.entries(files)) {
    const blob = new Blob([f.buffer], { type: f.mime || "application/octet-stream" });
    out.append(k, blob, f.filename || "upload.bin");
  }

  const hubspotUrl = `https://forms-${region}.hsforms.com/submissions/v3/public/submit/formsnext/multipart/${encodeURIComponent(portalId)}/${encodeURIComponent(formId)}`;
  const hsResp = await fetch(hubspotUrl, { method:"POST", body: out });

  const text = await hsResp.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }

  if (!hsResp.ok) return res.status(hsResp.status).json({ error:"HubSpot error", detail: body });
  res.status(200).json(body);
}
