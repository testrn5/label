// ... (интерфейсы и константы остаются без изменений)

export default function Home() {
  // ... (все state остаются)
  const [currentModel, setCurrentModel] = useState<string>("nex-agi/nex-n2-pro:free");
  const [isSwitchingModel, setIsSwitchingModel] = useState(false);

  // ... (useEffect, toggleTheme, startCamera, stopCamera остаются)

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
        body: JSON.stringify({
          image: base64Image,
          mediaType: "image/jpeg",
          preferredModels: preferredModels,
          useSpecificModel: specificModel // Передаём конкретную модель если указана
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка сервера");
      setResult(data);
      setCurrentModel(data._used_model || currentModel);

      // Если модель не из preferred — добавляем её
      if (data._used_model && !preferredModels.includes(data._used_model)) {
        const newPreferred = [data._used_model, ...preferredModels].slice(0, 5);
        setPreferredModels(newPreferred);
        localStorage.setItem(STORAGE_KEY_MODELS, JSON.stringify(newPreferred));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }  }, [preferredModels, currentModel]);

  // Кнопка перебора следующей модели
  const switchToNextModel = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) {
      setError("Сначала включите камеру");
      return;
    }

    setIsSwitchingModel(true);
    setError(null);
    
    // Получаем список всех моделей
    try {
      const modelsRes = await fetch('/api/models');
      const modelsData = await modelsRes.json();
      
      if (!modelsData.models || modelsData.models.length === 0) {
        throw new Error("Не удалось получить список моделей");
      }

      // Находим индекс текущей модели
      const currentIndex = modelsData.models.findIndex((m: any) => m.id === currentModel);
      const nextIndex = (currentIndex + 1) % modelsData.models.length;
      const nextModel = modelsData.models[nextIndex].id;

      // Распознаём с новой моделью
      await recognize(nextModel);
      
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSwitchingModel(false);
    }
  }, [currentModel, recognize]);

  // ... (остальные функции остаются без изменений)

  return (
    <>
      {/* ... (стили остаются) */}
      
      <div className="container">
        <div className="header">
          <h1>♻ Распознавание v2.8<span className="free-badge">FREE</span></h1>
          <button className="theme-btn" onClick={toggleTheme}>
            {theme === "dark" ? "☀️ Светлая" : "🌙 Темная"}
          </button>
        </div>
        {/* Информация о текущей модели */}
        <div className="model-status">
          <span className="model-label">📡 Модель:</span>
          <span className="model-name">{currentModel}</span>
          {preferredModels.length > 0 && (
            <span className="model-badge">⚡ {preferredModels.length} в приоритете</span>
          )}
        </div>

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

        {/* ... (остальной JSX остаётся без изменений) */}
      </div>
    </>
  );
}
