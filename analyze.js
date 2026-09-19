import OpenAI from "openai";
import * as cheerio from "cheerio";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MAX_HTML = 150000;

function headers(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d{1,3})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function clean(value, max = 4000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function extractPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const links = [];
  $("a[href]").each((_, element) => {
    try {
      const absolute = new URL($(element).attr("href"), base).href;
      links.push(absolute);
    } catch {}
  });
  const images = [];
  $("img").each((_, element) => images.push({ src: clean($(element).attr("src"), 500), alt: clean($(element).attr("alt"), 300) }));
  const bodyText = clean($("body").text(), 12000);
  return {
    url: pageUrl,
    title: clean($("title").first().text(), 300),
    metaDescription: clean($("meta[name='description']").attr("content"), 500),
    canonical: clean($("link[rel='canonical']").attr("href"), 500),
    robots: clean($("meta[name='robots']").attr("content"), 200),
    language: clean($("html").attr("lang"), 50),
    h1: $("h1").map((_, e) => clean($(e).text(), 300)).get().slice(0, 20),
    h2: $("h2").map((_, e) => clean($(e).text(), 300)).get().slice(0, 30),
    wordCount: bodyText ? bodyText.split(/\s+/).length : 0,
    bodyText,
    links: { total: links.length, internal: links.filter(link => new URL(link).hostname === base.hostname).length, external: links.filter(link => new URL(link).hostname !== base.hostname).length },
    images: { total: images.length, withAlt: images.filter(image => image.alt).length, withoutAlt: images.filter(image => !image.alt).length, items: images.slice(0, 30) },
    hasStructuredData: $("script[type='application/ld+json']").length > 0,
    hasOpenGraph: $("meta[property^='og:']").length > 0,
    hasViewport: $("meta[name='viewport']").length > 0
  };
}

const systemPrompt = `أنت محرر تقارير SEO مؤسسية باللغة العربية. أعد JSON صالحًا فقط دون Markdown. اعتمد على البيانات المتاحة فقط، وميّز بين "غير متحقق" و"غير موجود" ولا تخترع معلومات. اجعل الصياغة رسمية وواضحة وقابلة للإرسال للإدارة. أجب عن طلب المستخدم مع إنشاء تقرير نهائي.`;

export default async function handler(req, res) {
  headers(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "يسمح هذا المسار بطلبات POST فقط." });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "لم يتم إعداد OPENAI_API_KEY في Vercel." });
  try {
    const { url, question } = req.body || {};
    if (!url || !question) return res.status(400).json({ error: "الرابط والسؤال مطلوبان." });
    if (String(question).length > 4000) return res.status(400).json({ error: "السؤال طويل جدًا." });
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return res.status(400).json({ error: "يجب أن يبدأ الرابط بـ HTTPS." });
    if (isPrivateHost(parsed.hostname)) return res.status(400).json({ error: "هذا النطاق غير مسموح للفحص." });

    const pageResponse = await fetch(parsed.href, { redirect: "follow", headers: { "User-Agent": "SharePoint-SEO-Analyzer/1.0" }, signal: AbortSignal.timeout(15000) });
    if (!pageResponse.ok) return res.status(502).json({ error: `تعذر الوصول إلى الصفحة (${pageResponse.status}).` });
    const contentType = pageResponse.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return res.status(400).json({ error: "الرابط لا يعيد صفحة HTML." });
    const html = (await pageResponse.text()).slice(0, MAX_HTML);
    const pageData = extractPage(html, parsed.href);
    const userPrompt = `طلب المستخدم:\n${clean(question, 4000)}\n\nبيانات الصفحة المستخرجة:\n${JSON.stringify(pageData)}`;
    const completion = await openai.chat.completions.create({ model: "gpt-4o-mini", temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }] });
    const raw = completion.choices?.[0]?.message?.content || "{}";
    let report;
    try { report = JSON.parse(raw); } catch { report = { score: null, summary: raw, importantFindings: [], recommendations: [] }; }
    return res.status(200).json({ report, extractedData: pageData });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "حدث خطأ أثناء قراءة الصفحة أو التواصل مع OpenAI." });
  }
}
