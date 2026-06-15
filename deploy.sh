#!/usr/bin/env bash
set -e

# ============================================================
#  Product Recognizer — деплой на Vercel
#  Использование: bash deploy.sh
# ============================================================

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}▸${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
sep()  { echo -e "\n${CYAN}────────────────────────────────────────${NC}"; }

echo ""
echo -e "${BOLD}  🔍 Product Recognizer${NC}"
echo -e "  AI-распознавание товаров и этикеток"
sep

# ── 1. Проверка зависимостей ────────────────────────────────
log "Проверка системных зависимостей..."

if ! command -v node &>/dev/null; then
  fail "Node.js не установлен. Скачайте на https://nodejs.org"
fi
NODE_VER=$(node -v | cut -c2- | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  fail "Нужен Node.js 18+. Текущая версия: $(node -v)"
fi
ok "Node.js $(node -v)"

if ! command -v npm &>/dev/null; then
  fail "npm не найден"
fi
ok "npm $(npm -v)"

# ── 2. Vercel CLI ───────────────────────────────────────────
sep
log "Проверка Vercel CLI..."

if ! command -v vercel &>/dev/null; then
  warn "Vercel CLI не найден. Устанавливаю..."
  npm install -g vercel
  ok "Vercel CLI установлен"
else
  ok "Vercel CLI $(vercel --version 2>/dev/null | head -1)"
fi

# ── 3. ANTHROPIC_API_KEY ────────────────────────────────────
sep
log "Настройка Anthropic API ключа..."

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo ""
  echo -e "  Получите ключ на ${CYAN}https://console.anthropic.com/keys${NC}"
  echo ""
  read -rp "  Введите ANTHROPIC_API_KEY: " ANTHROPIC_API_KEY
  echo ""
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
  fail "ANTHROPIC_API_KEY не может быть пустым"
fi

# Базовая проверка формата
if [[ ! "$ANTHROPIC_API_KEY" == sk-ant-* ]]; then
  warn "Ключ не начинается с 'sk-ant-' — проверьте правильность"
fi
ok "API ключ принят"

# ── 4. Копирование проекта ──────────────────────────────────
sep
PROJECT_DIR="product-recognizer"
log "Создание проекта в ./${PROJECT_DIR}..."

if [ -d "$PROJECT_DIR" ]; then
  warn "Папка ${PROJECT_DIR} уже существует — обновляю файлы"
else
  mkdir -p "$PROJECT_DIR"
fi

# Создаём структуру
mkdir -p "$PROJECT_DIR/app/api/recognize"

# ── app/layout.tsx ──
cat > "$PROJECT_DIR/app/layout.tsx" << 'LAYOUT'
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Product Recognizer — AI распознавание товаров",
  description: "Загрузите фото товара или этикетки — AI определит производителя, бренд и состав",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
LAYOUT

# ── app/api/recognize/route.ts ──
cat > "$PROJECT_DIR/app/api/recognize/route.ts" << 'ROUTE'
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { image, mediaType } = await req.json();
    if (!image || !mediaType) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: image,
            },
          },
          {
            type: "text",
            text: `You are a product recognition expert. Analyze this product image or label and return ONLY valid JSON with no markdown, no explanation, no preamble.

Return this exact JSON structure:
{
  "product_name": "full product name",
  "manufacturer": "company that made it",
  "brand": "brand name",
  "country": "country of origin",
  "category": "product category",
  "description": "brief description in Russian (1-2 sentences)",
  "barcode": "barcode number or null",
  "weight": "weight or volume with units or null",
  "ingredients": "main ingredients if visible or null",
  "confidence": "high or medium or low"
}

If you cannot determine a field, use null. Always respond in Russian where possible for text fields. Return ONLY the JSON object.`,
          },
        ],
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const clean = text.replace(/```json\n?|\n?```/g, "").trim();
    return NextResponse.json(JSON.parse(clean));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to process image" }, { status: 500 });
  }
}
ROUTE

# ── app/page.tsx ──
cat > "$PROJECT_DIR/app/page.tsx" << 'PAGE'
"use client";
import { useState, useCallback, useRef } from "react";

interface RecognitionResult {
  product_name: string;
  manufacturer: string;
  brand: string;
  country: string;
  category: string;
  description: string;
  barcode: string | null;
  ingredients?: string | null;
  weight?: string | null;
  confidence: "high" | "medium" | "low";
}

export default function Home() {
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) { setError("Загрузите изображение"); return; }
    setError(null); setResult(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl);
      setLoading(true);
      try {
        const res = await fetch("/api/recognize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl.split(",")[1], mediaType: file.type }),
        });
        if (!res.ok) throw new Error();
        setResult(await res.json());
      } catch { setError("Не удалось распознать товар. Попробуйте другое фото."); }
      finally { setLoading(false); }
    };
    reader.readAsDataURL(file);
  }, []);

  const cColor = (c: string) => c === "high" ? "#22c55e" : c === "medium" ? "#f59e0b" : "#ef4444";
  const cLabel = (c: string) => c === "high" ? "Высокая" : c === "medium" ? "Средняя" : "Низкая";

  const fields = result ? [
    { label: "Название", value: result.product_name },
    { label: "Производитель", value: result.manufacturer },
    { label: "Бренд", value: result.brand },
    { label: "Страна", value: result.country },
    { label: "Категория", value: result.category },
    { label: "Штрихкод", value: result.barcode || "—" },
    { label: "Вес / Объём", value: result.weight || "—" },
    { label: "Состав", value: result.ingredients || "—" },
  ] : [];

  return (
    <>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Inter',system-ui,sans-serif;background:#0a0a0f;color:#e8e8f0;min-height:100vh}
        .glow{position:fixed;top:-200px;left:50%;transform:translateX(-50%);width:800px;height:500px;background:radial-gradient(ellipse,rgba(99,102,241,.15) 0%,transparent 70%);pointer-events:none;z-index:0}
        .wrap{position:relative;z-index:1;max-width:760px;margin:0 auto;padding:60px 24px 80px}
        header{text-align:center;margin-bottom:52px}
        .ew{display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#818cf8;background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.25);padding:5px 14px;border-radius:20px;margin-bottom:20px}
        h1{font-size:clamp(32px,5vw,48px);font-weight:700;line-height:1.1;letter-spacing:-.02em;background:linear-gradient(135deg,#e8e8f0,#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:14px}
        .sub{font-size:16px;color:#6b7280;line-height:1.6}
        .dz{border:2px dashed rgba(99,102,241,.3);border-radius:20px;padding:56px 24px;text-align:center;cursor:pointer;transition:all .2s;background:rgba(99,102,241,.03);margin-bottom:32px}
        .dz:hover,.dz.drag{border-color:#818cf8;background:rgba(99,102,241,.08)}
        .di{width:56px;height:56px;margin:0 auto 16px;background:rgba(99,102,241,.12);border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:26px}
        .dt{font-size:17px;font-weight:600;margin-bottom:6px}
        .ds{font-size:13px;color:#6b7280}
        .btn{display:inline-block;margin-top:18px;padding:10px 24px;border-radius:10px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.4);color:#818cf8;font-size:14px;font-weight:500;cursor:pointer;transition:all .2s}
        .btn:hover{background:rgba(99,102,241,.25)}
        .pw{border-radius:16px;overflow:hidden;margin-bottom:28px;background:#111118}
        .pw img{width:100%;max-height:380px;object-fit:contain;display:block}
        .loader{display:flex;align-items:center;justify-content:center;gap:12px;padding:28px;color:#818cf8;font-size:15px}
        .spinner{width:22px;height:22px;border:2px solid rgba(99,102,241,.2);border-top-color:#818cf8;border-radius:50%;animation:spin .8s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}
        .card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:20px;overflow:hidden}
        .ch{padding:20px 24px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;justify-content:space-between}
        .ct{font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.08em}
        .cb{font-size:12px;font-weight:600;padding:4px 12px;border-radius:20px}
        .db{padding:18px 24px 16px;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px;color:#9ca3af;line-height:1.6}
        .fr{display:flex;align-items:baseline;padding:12px 24px;gap:16px;border-bottom:1px solid rgba(255,255,255,.04);transition:background .15s}
        .fr:last-child{border-bottom:none}
        .fr:hover{background:rgba(99,102,241,.04)}
        .fl{font-size:12px;color:#4b5563;min-width:110px;font-weight:500}
        .fv{font-size:14px;color:#d1d5db;flex:1}
        .err{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:12px;padding:16px 20px;color:#fca5a5;font-size:14px;margin-bottom:16px}
        .rb{display:block;width:100%;margin-top:20px;padding:12px;border-radius:12px;text-align:center;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#6b7280;font-size:14px;cursor:pointer;transition:all .2s}
        .rb:hover{background:rgba(255,255,255,.08);color:#d1d5db}
      `}</style>
      <div className="glow" />
      <div className="wrap">
        <header>
          <div className="ew">✦ AI Vision</div>
          <h1>Распознавание товаров</h1>
          <p className="sub">Загрузите фото этикетки или упаковки — AI определит производителя,<br/>бренд, состав и другие данные за секунды</p>
        </header>
        {error && <div className="err">⚠ {error}</div>}
        {!preview ? (
          <div className={`dz${dragging?" drag":""}`}
            onDragOver={e=>{e.preventDefault();setDragging(true)}}
            onDragLeave={()=>setDragging(false)}
            onDrop={e=>{e.preventDefault();setDragging(false);const f=e.dataTransfer.files[0];if(f)processFile(f)}}
            onClick={()=>inputRef.current?.click()}>
            <div className="di">📦</div>
            <div className="dt">Перетащите фото сюда</div>
            <div className="ds">или нажмите для выбора файла</div>
            <div className="btn">Выбрать изображение</div>
            <input ref={inputRef} type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f)processFile(f)}} style={{display:"none"}} />
          </div>
        ) : (
          <>
            <div className="pw"><img src={preview} alt="preview" /></div>
            {loading && <div className="loader"><div className="spinner"/>Анализируем изображение...</div>}
            {result && (
              <div className="card">
                <div className="ch">
                  <span className="ct">Результат распознавания</span>
                  <span className="cb" style={{background:`${cColor(result.confidence)}18`,color:cColor(result.confidence),border:`1px solid ${cColor(result.confidence)}40`}}>
                    Точность: {cLabel(result.confidence)}
                  </span>
                </div>
                {result.description && <div className="db">{result.description}</div>}
                <div>{fields.map(({label,value})=>(
                  <div className="fr" key={label}>
                    <span className="fl">{label}</span>
                    <span className="fv">{value}</span>
                  </div>
                ))}</div>
              </div>
            )}
            <button className="rb" onClick={()=>{setPreview(null);setResult(null);setError(null)}}>← Загрузить другое изображение</button>
          </>
        )}
      </div>
    </>
  );
}
PAGE

# ── package.json ──
cat > "$PROJECT_DIR/package.json" << 'PKG'
{
  "name": "product-recognizer",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "next": "^15.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "typescript": "^5"
  }
}
PKG

# ── tsconfig.json ──
cat > "$PROJECT_DIR/tsconfig.json" << 'TSC'
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
TSC

# ── next.config.js ──
cat > "$PROJECT_DIR/next.config.js" << 'NEXT'
/** @type {import('next').NextConfig} */
const nextConfig = {};
module.exports = nextConfig;
NEXT

# ── .gitignore ──
cat > "$PROJECT_DIR/.gitignore" << 'GIT'
.env.local
.env
node_modules
.next
out
GIT

ok "Файлы проекта созданы"

# ── 5. Установка зависимостей ───────────────────────────────
sep
log "Установка npm зависимостей..."
cd "$PROJECT_DIR"
npm install --silent
ok "Зависимости установлены"

# ── 6. Деплой на Vercel ─────────────────────────────────────
sep
log "Деплой на Vercel..."
echo ""
echo -e "  ${YELLOW}Если вы ещё не авторизованы, сейчас откроется браузер для входа.${NC}"
echo ""

# Передаём API ключ как env переменную
echo "$ANTHROPIC_API_KEY" | vercel env add ANTHROPIC_API_KEY production --force 2>/dev/null || true

# Деплой
vercel --prod --yes

sep
echo ""
echo -e "${GREEN}${BOLD}  ✓ Деплой завершён!${NC}"
echo ""
echo -e "  ${CYAN}Переменные окружения${NC} (если не установились автоматически):"
echo -e "  Vercel Dashboard → ваш проект → Settings → Environment Variables"
echo -e "  Добавьте: ${BOLD}ANTHROPIC_API_KEY${NC} = ваш ключ"
echo ""
echo -e "  ${CYAN}Локальная разработка:${NC}"
echo -e "  echo 'ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}' > .env.local"
echo -e "  npm run dev"
echo ""
