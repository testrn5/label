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
  material_type: "plastic" | "glass" | "aluminum" | "paper" | "metal" | "cardboard" | "other";
  size: "small" | "medium" | "large" | "xlarge";
  confidence: "high" | "medium" | "low";
  _used_model?: string;
  _total_tried?: number;
}

interface HistoryItem {
  id: number;
  product_name: string;
  brand: string;
  category: string;
  weight_label: string | null;
  calculated_weight: number;
  material_type: string;
  size: string;
  recyclable: boolean;
  timestamp: string;
  description?: string;
}

const STORAGE_KEY_MODELS = "recognizer_preferred_models";
const STORAGE_KEY_HISTORY = "recognizer_history";
const STORAGE_KEY_STATS = "recognizer_stats";

const MATERIAL_DENSITY: Record<string, number> = {
  plastic: 200,
  glass: 500,
  aluminum: 300,
  paper: 150,
  cardboard: 180,
  metal: 400,
  other: 250,
};

const SIZE_VOLUME: Record<string, number> = {  small: 0.0008,
  medium: 0.002,
  large: 0.005,
  xlarge: 0.015,
};

const MATERIAL_LABELS: Record<string, string> = {
  plastic: "Пластик",
  glass: "Стекло",
  aluminum: "Алюминий",
  paper: "Бумага",
  cardboard: "Картон",
  metal: "Металл",
  other: "Другое",
};

const SIZE_LABELS: Record<string, string> = {
  small: "Маленький (≤0.5л)",
  medium: "Средний (~1л)",
  large: "Большой (1.5-2л)",
  xlarge: "Очень большой (5л+)",
};

function calculateEmptyWeight(material: string, size: string): number {
  const density = MATERIAL_DENSITY[material] || MATERIAL_DENSITY.other;
  const volume = SIZE_VOLUME[size] || SIZE_VOLUME.medium;
  return Math.round(density * volume);
}

export default function Home() {
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, recycled: 0, weight: 0 });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [preferredModels, setPreferredModels] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [currentModel, setCurrentModel] = useState<string>("nex-agi/nex-n2-pro:free");
  const [isSwitchingModel, setIsSwitchingModel] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      const savedModels = localStorage.getItem(STORAGE_KEY_MODELS);
      if (savedModels) setPreferredModels(JSON.parse(savedModels));      const savedHistory = localStorage.getItem(STORAGE_KEY_HISTORY);
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
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
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

  const recognize = useCallback(async (specificModel?: string) => {
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
        body: JSON.stringify({          image: base64Image,
          mediaType: "image/jpeg",
          preferredModels: preferredModels,
          useSpecificModel: specificModel
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка сервера");
      setResult(data);
      if (data._used_model) setCurrentModel(data._used_model);

      if (data._used_model && !preferredModels.includes(data._used_model)) {
        const newPreferred = [data._used_model, ...preferredModels].slice(0, 5);
        setPreferredModels(newPreferred);
        localStorage.setItem(STORAGE_KEY_MODELS, JSON.stringify(newPreferred));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [preferredModels]);

  const saveResult = useCallback(() => {
    if (!result) return;

    const calculatedWeight = calculateEmptyWeight(
      result.material_type || "other",
      result.size || "medium"
    );

    const newItem: HistoryItem = {
      id: Date.now(),
      product_name: result.product_name || "Неизвестно",
      brand: result.brand || "No brand",
      category: result.category || "—",
      weight_label: result.weight,
      calculated_weight: calculatedWeight,
      material_type: result.material_type || "other",
      size: result.size || "medium",
      recyclable: result.recyclable,
      timestamp: new Date().toLocaleString("ru-RU"),
      description: result.description,
    };

    setStats(prev => {
      const newStats = {
        total: prev.total + 1,
        recycled: result.recyclable ? prev.recycled + 1 : prev.recycled,
        weight: prev.weight + calculatedWeight,      };
      localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(newStats));
      return newStats;
    });

    setHistory(prev => {
      const newHistory = [newItem, ...prev].slice(0, 50);
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(newHistory));
      return newHistory;
    });

    setResult(null);
  }, [result]);

  const clearHistory = useCallback(() => {
    if (!confirm("Очистить всю историю и статистику?")) return;
    setHistory([]);
    setStats({ total: 0, recycled: 0, weight: 0 });
    localStorage.removeItem(STORAGE_KEY_HISTORY);
    localStorage.removeItem(STORAGE_KEY_STATS);
  }, []);

  const toggleExpand = (id: number) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const switchToNextModel = useCallback(async () => {
    if (!videoRef.current) {
      setError("Сначала включите камеру");
      return;
    }

    setIsSwitchingModel(true);
    setError(null);
    
    try {
      const modelsRes = await fetch('/api/models');
      const modelsData = await modelsRes.json();
      
      if (!modelsData.models || modelsData.models.length === 0) {
        throw new Error("Не удалось получить список моделей");
      }

      const currentIndex = modelsData.models.findIndex((m: any) => m.id === currentModel);
      const nextIndex = (currentIndex + 1) % modelsData.models.length;
      const nextModel = modelsData.models[nextIndex].id;

      await recognize(nextModel);
      
    } catch (err) {      setError((err as Error).message);
    } finally {
      setIsSwitchingModel(false);
    }
  }, [currentModel, recognize]);

  const cColor = (c: string) => c === "high" ? "#22c55e" : c === "medium" ? "#f59e0b" : "#ef4444";
  const cLabel = (c: string) => c === "high" ? "Высокая" : c === "medium" ? "Средняя" : "Низкая";

  const fields = result ? [
    { label: "Название", value: result.product_name },
    { label: "Производитель", value: result.manufacturer },
    { label: "Бренд", value: result.brand },
    { label: "Страна", value: result.country },
    { label: "Категория", value: result.category },
    { label: "Материал", value: MATERIAL_LABELS[result.material_type || "other"] },
    { label: "Размер", value: SIZE_LABELS[result.size || "medium"] },
    { label: "Вес пустой тары", value: `${calculateEmptyWeight(result.material_type || "other", result.size || "medium")} г` },
    { label: "Указанный вес", value: result.weight || "—" },
    { label: "Переработка", value: result.recyclable ? "♻ Да" : "✗ Нет" },
    { label: "Штрихкод", value: result.barcode || "—" },
    { label: "Состав", value: result.ingredients || "—" },
  ] : [];

  return (
    <>
      <style>{`
        :root {
          --bg: #0a0a0f; --text: #e8e8f0; --text-muted: #6b7280;
          --card-bg: rgba(255,255,255,0.03); --card-border: rgba(255,255,255,0.08);
          --accent: #818cf8; --accent-bg: rgba(99,102,241,0.15);
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
        .model-status { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; padding: 12px 16px; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 10px; font-size: 13px; }
        .model-label { color: var(--text-muted); font-weight: 500; }
        .model-name { color: var(--accent); font-weight: 600; font-family: monospace; font-size: 12px; }
        .model-badge { background: rgba(34, 197, 94, 0.15); color: #22c55e; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
        .video-container { position: relative; background: #111; border-radius: 16px; overflow: hidden; margin-bottom: 20px; border: 1px solid var(--card-border); }
        video, canvas { width: 100%; display: block; max-height: 400px; object-fit: contain; }        .controls { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 24px; }
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
        .history-list { list-style: none; padding: 0; }
        .history-item { border: 1px solid var(--card-border); border-radius: 10px; margin-bottom: 8px; overflow: hidden; background: var(--card-bg); }
        .history-item-header { padding: 12px 16px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: background 0.15s; }
        .history-item-header:hover { background: rgba(99,102,241,0.05); }
        .history-item-title { font-weight: 600; font-size: 14px; color: var(--text); }
        .history-item-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
        .history-item-arrow { font-size: 12px; color: var(--text-muted); transition: transform 0.2s; }
        .history-item-arrow.open { transform: rotate(180deg); }
        .history-item-details { padding: 0 16px 12px; display: none; border-top: 1px solid var(--card-border); }
        .history-item-details.open { display: block; padding-top: 12px; }
        .detail-row { display: flex; padding: 6px 0; font-size: 13px; border-bottom: 1px solid var(--card-border); }
        .detail-row:last-child { border-bottom: none; }
        .detail-label { min-width: 120px; color: var(--text-muted); font-weight: 500; }
        .detail-value { color: var(--text); flex: 1; }
        .weight-calc { background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); border-radius: 8px; padding: 8px 12px; margin-top: 8px; font-size: 12px; color: #22c55e; }
        .err { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 12px; padding: 12px 16px; color: #ef4444; font-size: 14px; margin-bottom: 16px; }
        .preferred-info { font-size: 11px; color: var(--text-muted); margin-bottom: 16px; padding: 8px 12px; background: var(--card-bg); border-radius: 8px; border: 1px solid var(--card-border); }
      `}</style>

      <div className="container">
        <div className="header">
          <h1>♻ Распознавание v2.9<span className="free-badge">FREE</span></h1>
          <button className="theme-btn" onClick={toggleTheme}>
            {theme === "dark" ? "☀️ Светлая" : "🌙 Темная"}          </button>
        </div>

        <div className="model-status">
          <span className="model-label">📡 Модель:</span>
          <span className="model-name">{currentModel}</span>
          {preferredModels.length > 0 && (
            <span className="model-badge">⚡ {preferredModels.length} в приоритете</span>
          )}
        </div>

        {preferredModels.length > 0 && (
          <div className="preferred-info">
            ⚡ Ускорение: {preferredModels.length} моделей в приоритете
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
          <button className="btn" onClick={() => recognize()} disabled={!stream || loading}>
            {loading ? "Распознаю..." : "Распознать"}
          </button>
          <button 
            className="btn" 
            onClick={switchToNextModel} 
            disabled={!stream || isSwitchingModel}
            title="Переключиться на следующую модель"
          >
            {isSwitchingModel ? "Переключение..." : "🔄 Сменить модель"}
          </button>
          <button className="btn" onClick={saveResult} disabled={!result}>Сохранить</button>
          <button className="btn btn-danger" onClick={clearHistory} disabled={history.length === 0}>Очистить</button>
        </div>

        <div className="stats">
          <div className="stat-card">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Всего</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.recycled}</div>
            <div className="stat-label">♻ Перераб.</div>          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.weight} г</div>
            <div className="stat-label">Вес пустой тары</div>
          </div>
        </div>

        <div className={`loader ${loading ? "active" : ""}`}>
          <span className="spinner"></span> Анализируем через AI...
        </div>

        {result && (
          <div className="result-card">
            <div className="result-header">
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
                Модель: {result._used_model} |
                Проверено: {result._total_tried}
              </div>
            )}
          </div>
        )}

        <div className="history">
          <div className="history-header">
            <h3>История операций ({history.length})</h3>
          </div>
          {history.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "20px", fontSize: "14px" }}>Пока пусто</div>
          ) : (
            <ul className="history-list">
              {history.map(item => (
                <li key={item.id} className="history-item">
                  <div className="history-item-header" onClick={() => toggleExpand(item.id)}>
                    <div>
                      <div className="history-item-title">
                        {item.recyclable ? "♻" : ""} {item.product_name}
                      </div>                      <div className="history-item-sub">
                        {item.brand} · {MATERIAL_LABELS[item.material_type] || item.material_type} · {item.calculated_weight} г
                      </div>
                    </div>
                    <span className={`history-item-arrow ${expandedId === item.id ? "open" : ""}`}>▼</span>
                  </div>
                  <div className={`history-item-details ${expandedId === item.id ? "open" : ""}`}>
                    <div className="detail-row">
                      <span className="detail-label">Категория</span>
                      <span className="detail-value">{item.category}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Материал</span>
                      <span className="detail-value">{MATERIAL_LABELS[item.material_type] || item.material_type}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Размер упаковки</span>
                      <span className="detail-value">{SIZE_LABELS[item.size] || item.size}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Указанный вес</span>
                      <span className="detail-value">{item.weight_label || "—"}</span>
                    </div>
                    <div className="weight-calc">
                      ✅ Рассчитанный вес пустой тары: <strong>{item.calculated_weight} г</strong>
                      <br/>
                      (материал: {MATERIAL_LABELS[item.material_type] || item.material_type}, объём: {item.size})
                    </div>
                    {item.description && (
                      <div className="detail-row" style={{ flexDirection: "column", gap: "4px" }}>
                        <span className="detail-label">Описание</span>
                        <span className="detail-value">{item.description}</span>
                      </div>
                    )}
                    <div className="detail-row">
                      <span className="detail-label">Время</span>
                      <span className="detail-value">{item.timestamp}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
