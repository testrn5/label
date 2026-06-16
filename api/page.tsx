"use client";
import { useState, useRef, useCallback, useEffect } from "react";

interface RecognitionResult {
  product_name: string;
  manufacturer: string;
  brand: string;
  country: string;
  category: string;
  description: string;
  barcode: string | null;
  weight: string | null;
  ingredients: string | null;
  recyclable: boolean;
  confidence: "high" | "medium" | "low";
  _used_model?: string;
  _from_preferred?: boolean;
  _total_tried?: number;
  _preferred_count?: number;
}

interface HistoryItem {
  id: number;
  product_name: string;
  brand: string;
  category: string;
  weight: string | null;
  recyclable: boolean;
  timestamp: string;
}

const STORAGE_KEY_MODELS = "recognizer_preferred_models";
const STORAGE_KEY_HISTORY = "recognizer_history";
const STORAGE_KEY_STATS = "recognizer_stats";

export default function Home() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [stats, setStats] = useState({ total: 0, recycled: 0, weight: 0 });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [preferredModels, setPreferredModels] = useState<string[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Загрузка из localStorage при монтировании  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    
    try {
      const savedModels = localStorage.getItem(STORAGE_KEY_MODELS);
      if (savedModels) setPreferredModels(JSON.parse(savedModels));
      
      const savedHistory = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (savedHistory) setHistory(JSON.parse(savedHistory));
      
      const savedStats = localStorage.getItem(STORAGE_KEY_STATS);
      if (savedStats) setStats(JSON.parse(savedStats));
    } catch (e) {
      console.error("Ошибка загрузки из localStorage:", e);
    }
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === "dark" ? "light" : "dark");

  const startCamera = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "environment" } 
      });
      setStream(mediaStream);
      if (videoRef.current) videoRef.current.srcObject = mediaStream;
      setError(null);
    } catch (err) {
      setError("Ошибка доступа к камере: " + (err as Error).message);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
      if (videoRef.current) videoRef.current.srcObject = null;
    }
    setResult(null);
  }, [stream]);

  const recognize = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    const base64Image = dataUrl.split(",")[1];

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          image: base64Image, 
          mediaType: "image/jpeg",
          preferredModels: preferredModels // Передаём приоритетные модели
        }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка сервера");
      
      setResult(data);
      
      // Если модель не из preferred — добавляем её в начало списка
      if (!data._from_preferred && data._used_model) {
        const newPreferred = [data._used_model, ...preferredModels.filter(m => m !== data._used_model)].slice(0, 5);
        setPreferredModels(newPreferred);
        localStorage.setItem(STORAGE_KEY_MODELS, JSON.stringify(newPreferred));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [preferredModels]);

  // ИСПРАВЛЕННОЕ сохранение
  const saveResult = useCallback(() => {
    if (!result) return;
    
    const newItem: HistoryItem = {
      id: Date.now(),
      product_name: result.product_name || "Неизвестно",
      brand: result.brand || "No brand",
      category: result.category || "—",
      weight: result.weight,
      recyclable: result.recyclable,
      timestamp: new Date().toLocaleString("ru-RU")
    };
    // Обновляем статистику
    setStats(prev => {
      const newStats = {
        total: prev.total + 1,
        recycled: result.recyclable ? prev.recycled + 1 : prev.recycled,
        weight: prev.weight + (result.weight ? parseInt(result.weight.match(/(\d+)/)?.[1] || "0") : 0)
      };
      localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(newStats));
      return newStats;
    });

    // Обновляем историю
    setHistory(prev => {
      const newHistory = [newItem, ...prev].slice(0, 50); // Храним последние 50
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(newHistory));
      return newHistory;
    });

    // Очищаем результат после сохранения
    setResult(null);
  }, [result]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setStats({ total: 0, recycled: 0, weight: 0 });
    localStorage.removeItem(STORAGE_KEY_HISTORY);
    localStorage.removeItem(STORAGE_KEY_STATS);
  }, []);

  const cColor = (c: string) => c === "high" ? "#22c55e" : c === "medium" ? "#f59e0b" : "#ef4444";
  const cLabel = (c: string) => c === "high" ? "Высокая" : c === "medium" ? "Средняя" : "Низкая";

  const fields = result ? [
    { label: "Название", value: result.product_name },
    { label: "Производитель", value: result.manufacturer },
    { label: "Бренд", value: result.brand },
    { label: "Страна", value: result.country },
    { label: "Категория", value: result.category },
    { label: "Переработка", value: result.recyclable ? "♻ Да" : "✗ Нет" },
    { label: "Штрихкод", value: result.barcode || "—" },
    { label: "Вес / Объём", value: result.weight || "—" },
    { label: "Состав", value: result.ingredients || "—" },
  ] : [];

  return (
    <>
      <style>{`
        :root {
          --bg: #0a0a0f; --text: #e8e8f0; --text-muted: #6b7280;
          --card-bg: rgba(255,255,255,0.03); --card-border: rgba(255,255,255,0.08);          --accent: #818cf8; --accent-bg: rgba(99,102,241,0.15);
        }
        [data-theme="light"] {
          --bg: #f8fafc; --text: #0f172a; --text-muted: #64748b;
          --card-bg: #ffffff; --card-border: #e2e8f0;
          --accent: #4f46e5; --accent-bg: rgba(79, 70, 229, 0.1);
        }
        * { box-sizing: border-box; }
        body { font-family: 'Inter', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; padding: 20px; transition: background 0.3s, color 0.3s; }
        .container { max-width: 760px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
        h1 { font-size: 28px; font-weight: 700; background: linear-gradient(135deg, var(--text), var(--accent)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0; }
        .free-badge { display: inline-block; font-size: 10px; font-weight: 700; background: #22c55e; color: #000; padding: 3px 8px; border-radius: 10px; margin-left: 8px; vertical-align: middle; -webkit-text-fill-color: #000; }
        .theme-btn { padding: 8px 16px; border-radius: 8px; border: 1px solid var(--card-border); background: var(--card-bg); color: var(--text); cursor: pointer; font-weight: 600; }
        .video-container { position: relative; background: #111; border-radius: 16px; overflow: hidden; margin-bottom: 20px; border: 1px solid var(--card-border); }
        video, canvas { width: 100%; display: block; max-height: 400px; object-fit: contain; }
        .controls { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 24px; }
        .btn { padding: 10px 20px; border-radius: 10px; border: 1px solid rgba(99,102,241,0.4); background: var(--accent-bg); color: var(--accent); font-weight: 600; cursor: pointer; transition: all 0.2s; font-size: 14px; }
        .btn:hover:not(:disabled) { filter: brightness(1.1); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-danger { background: rgba(239,68,68,0.15); color: #ef4444; border-color: rgba(239,68,68,0.4); }
        .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 24px; }
        .stat-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; padding: 16px; text-align: center; }
        .stat-value { font-size: 24px; font-weight: 700; color: var(--accent); }
        .stat-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 4px; }
        .loader { display: none; text-align: center; padding: 24px; color: var(--accent); }
        .loader.active { display: block; }
        .spinner { display: inline-block; width: 20px; height: 20px; border: 2px solid rgba(99,102,241,0.2); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; margin-right: 8px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .result-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px; overflow: hidden; margin-bottom: 24px; }
        .result-header { padding: 16px 20px; border-bottom: 1px solid var(--card-border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
        .result-title { font-size: 13px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; }
        .confidence-badge { font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 20px; }
        .result-desc { padding: 16px 20px; border-bottom: 1px solid var(--card-border); font-size: 14px; color: var(--text-muted); line-height: 1.5; }
        .field { display: flex; padding: 12px 20px; border-bottom: 1px solid var(--card-border); }
        .field:last-child { border-bottom: none; }
        .field-label { min-width: 130px; color: var(--text-muted); font-size: 13px; font-weight: 500; }
        .field-value { color: var(--text); font-size: 14px; flex: 1; }
        .model-info { padding: 12px 20px; background: rgba(99,102,241,0.05); font-size: 12px; color: var(--text-muted); border-top: 1px solid var(--card-border); }
        .history { margin-top: 20px; }
        .history-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .history h3 { font-size: 16px; margin: 0; color: var(--text-muted); }
        .history-list { list-style: none; color: var(--text-muted); font-size: 14px; padding: 0; }
        .history-list li { padding: 10px 12px; border-bottom: 1px solid var(--card-border); display: flex; justify-content: space-between; align-items: center; }
        .history-list li:last-child { border-bottom: none; }
        .history-time { font-size: 11px; color: var(--text-muted); }
        .err { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 12px; padding: 12px 16px; color: #ef4444; font-size: 14px; margin-bottom: 16px; }
        .preferred-info { font-size: 11px; color: var(--text-muted); margin-bottom: 16px; padding: 8px 12px; background: var(--card-bg); border-radius: 8px; border: 1px solid var(--card-border); }
      `}</style>
      <div className="container">
        <div className="header">
          <h1>♻ Распознавание v2.8<span className="free-badge">FREE</span></h1>
          <button className="theme-btn" onClick={toggleTheme}>
            {theme === "dark" ? "☀️ Светлая" : "🌙 Темная"}
          </button>
        </div>

        {preferredModels.length > 0 && (
          <div className="preferred-info">
            ⚡ Ускорение: {preferredModels.length} моделей в приоритете (из localStorage)
          </div>
        )}

        {error && <div className="err">⚠ {error}</div>}

        <div className="video-container">
          <video ref={videoRef} autoPlay playsInline muted />
          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>

        <div className="controls">
          <button className="btn" onClick={startCamera} disabled={!!stream}>Включить камеру</button>
          <button className="btn" onClick={stopCamera} disabled={!stream}>Стоп</button>
          <button className="btn" onClick={recognize} disabled={!stream || loading}>Распознать</button>
          <button className="btn" onClick={saveResult} disabled={!result}>Сохранить</button>
          <button className="btn btn-danger" onClick={clearHistory} disabled={history.length === 0}>Очистить историю</button>
        </div>

        <div className="stats">
          <div className="stat-card">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Всего</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.recycled}</div>
            <div className="stat-label">♻ Перераб.</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.weight} г</div>
            <div className="stat-label">Общий вес</div>
          </div>
        </div>

        <div className={`loader ${loading ? "active" : ""}`}>
          <span className="spinner"></span> Анализируем через AI...
        </div>

        {result && (
          <div className="result-card">            <div className="result-header">
              <span className="result-title">Результат</span>
              <span className="confidence-badge" style={{ background: `${cColor(result.confidence)}18`, color: cColor(result.confidence), border: `1px solid ${cColor(result.confidence)}40` }}>
                Точность: {cLabel(result.confidence)}
              </span>
            </div>
            {result.description && <div className="result-desc">{result.description}</div>}
            {fields.map(f => (
              <div className="field" key={f.label}>
                <span className="field-label">{f.label}</span>
                <span className="field-value">{f.value}</span>
              </div>
            ))}
            {result._used_model && (
              <div className="model-info">
                Модель: {result._used_model} {result._from_preferred ? "(из приоритетных )" : ""} | 
                Проверено: {result._total_tried} | 
                Приоритетных: {result._preferred_count || 0}
              </div>
            )}
          </div>
        )}

        <div className="history">
          <div className="history-header">
            <h3>История операций ({history.length})</h3>
          </div>
          <ul className="history-list">
            {history.length === 0 ? (
              <li style={{ justifyContent: "center", color: "var(--text-muted)" }}>Пока пусто</li>
            ) : (
              history.map(item => (
                <li key={item.id}>
                  <span>✓ {item.product_name} ({item.brand})</span>
                  <span className="history-time">{item.timestamp}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </>
  );
}
