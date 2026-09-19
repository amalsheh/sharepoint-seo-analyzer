# مساعد تقرير SEO لصفحات SharePoint

## الفكرة

- `index.html`: واجهة GitHub Pages.
- `api/analyze.js`: Backend يعمل كـ Vercel Function.
- OpenAI API: صياغة التقرير النهائي باللغة العربية.

## النشر

### 1. نشر Backend على Vercel

1. افتح Vercel وسجّل الدخول بحساب GitHub.
2. اختر **Add New Project** ثم المستودع `amalsheh/sharepoint-seo-analyzer`.
3. اضغط **Deploy**.
4. من **Settings → Environment Variables** أضف:

```text
OPENAI_API_KEY = مفتاح OpenAI API
