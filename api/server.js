const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

const requiredEnv = [
  "N8N_WEBHOOK_URL",
  "N8N_WEBHOOK_TOKEN",
  "BETEL_ACCESS_TOKEN",
  "BETEL_SECRET_ACCESS_TOKEN"
];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "50kb" }));

const leadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests. Please try again later." }
});

const leadSchema = z.object({
  documentType: z.enum(["CPF", "CNPJ"]),
  document: z.string().min(11).max(18),
  name: z.string().trim().min(3).max(160),
  email: z.email().max(180),
  phoneCountry: z.enum(["BR", "PT", "US", "AR"]),
  phone: z.string().trim().min(8).max(32),
  cep: z.string().trim().min(8).max(9),
  addressStreet: z.string().trim().min(2).max(180),
  addressNumber: z.string().trim().max(20).optional().default(""),
  addressDistrict: z.string().trim().min(2).max(120),
  addressCity: z.string().trim().min(2).max(120),
  addressState: z.string().trim().min(2).max(2),
  addressComplement: z.string().trim().max(120).optional().default(""),
  source: z.string().trim().max(80).optional().default("logan-form-web"),
  submittedAt: z.iso.datetime().optional()
});

function normalizeDocument(value) {
  return String(value || "").replace(/\D/g, "");
}

async function checkExistingClientByDocument(documentValue) {
  const normalized = normalizeDocument(documentValue);
  if (!normalized) return { exists: false };

  const query = new URLSearchParams({ cpf_cnpj: normalized }).toString();
  const url = `https://api.beteltecnologia.com/clientes?${query}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "access-token": process.env.BETEL_ACCESS_TOKEN,
      "secret-access-token": process.env.BETEL_SECRET_ACCESS_TOKEN,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Betel check failed with status ${response.status}`);
  }

  const body = await response.json();
  const data = body?.data;
  const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  if (!rows.length) return { exists: false };

  const found = rows.find((item) => normalizeDocument(item?.cpf || item?.cnpj || item?.cpf_cnpj) === normalized);
  if (!found) return { exists: false };
  return { exists: true, clientId: String(found.id || "") };
}

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "form-bezura-api" });
});

app.post("/lead", leadLimiter, async (req, res) => {
  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({
      ok: false,
      error: "Payload validation failed",
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message
      }))
    });
  }

  const payload = {
    ...parsed.data,
    submittedAt: parsed.data.submittedAt || new Date().toISOString()
  };

  try {
    const duplicateCheck = await checkExistingClientByDocument(payload.document);
    if (duplicateCheck.exists) {
      return res.status(409).json({
        ok: false,
        error: "Cliente ja cadastrado para este CPF/CNPJ.",
        code: "CLIENT_ALREADY_EXISTS",
        clientId: duplicateCheck.clientId || undefined
      });
    }

    const response = await fetch(process.env.N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-token": process.env.N8N_WEBHOOK_TOKEN
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: "Webhook upstream failed",
        status: response.status
      });
    }

    return res.status(200).json({ ok: true });
  } catch (_error) {
    return res.status(502).json({ ok: false, error: "Webhook unavailable" });
  }
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

app.listen(port, () => {
  console.log(`form-bezura-api listening on ${port}`);
});
