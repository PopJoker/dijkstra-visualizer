const map = L.map('map', {
    preferCanvas: true,
    zoomControl: false
}).setView([25.0330, 121.5654], 14);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB'
}).addTo(map);

let points = [];
let layers = L.layerGroup().addTo(map);
let animationId = null;
const worker = new Worker("./worker.js");

// UI 元素
const statusEl = document.getElementById("status");
const resetBtn = document.getElementById("reset-btn");

map.on('click', (e) => {
    if (points.length >= 2) return; // 動畫中禁止點擊

    points.push(e.latlng);
    const color = points.length === 1 ? "#00d2ff" : "#ff4757";

    L.circleMarker(e.latlng, {
        radius: 8,
        fillColor: color,
        color: "#fff",
        weight: 2,
        fillOpacity: 1
    }).addTo(layers);

    if (points.length === 1) {
        statusEl.innerText = "請選擇終點...";
    } else {
        statusEl.innerText = "演算法計算中...";
        worker.postMessage({ start: points[0], end: points[1] });
    }
});

// 主程式中的 worker.onmessage
worker.onmessage = (e) => {
    if (e.data.error) {
        statusEl.innerText = "錯誤: " + e.data.error;
        points = []; // 重置
        return;
    }

    const { explored, path, bounds } = e.data;

    if (bounds) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }

    if (explored.length === 0) {
        statusEl.innerText = "無法找到連通的路徑。";
        return;
    }

    animate(explored, path);
};

// 主程式中的 animate
function animate(explored, path) {
    if (animationId) cancelAnimationFrame(animationId);
    let frame = 0;
    let mode = "explore";

    // 💡 這裡稍微調整：explored 建議用一個大的 FeatureGroup 或單獨處理
    // 如果用單一 polyline 會強制連線，我們改用分段更新的方式
    const exploredLayer = L.featureGroup().addTo(layers);
    const pathLC = L.polyline([], { color: "#00FF15", weight: 5, opacity: 1 }).addTo(layers);

    function step() {
        if (mode === "explore") {
            const batchSize = 15; // 每次畫 15 條線
            const startIdx = frame;
            const endIdx = Math.min(frame + batchSize, explored.length);

            for (let i = startIdx; i < endIdx; i++) {
                // 💡 為每一條搜尋邊建立獨立線段，避免首尾相連  
                L.polyline(explored[i], {
                    color: "#00E1FF",
                    weight: 1,
                    opacity: 0.3,
                    interactive: false // 增進效能
                }).addTo(exploredLayer);
            }

            frame = endIdx;

            if (frame < explored.length) {
                statusEl.innerText = `正在搜尋路網...`;
                animationId = requestAnimationFrame(step);
            } else {
                mode = "path";
                frame = 0;
                animationId = requestAnimationFrame(step);
            }
        } else {
            // frame += 500000000000000;
            frame += 1;

            if (frame <= path.length) { // 改成 <= 確保能畫到最後一個點
                const segs = path.slice(0, frame);
                pathLC.setLatLngs(segs.flat(1));
                statusEl.innerText = `找到最短路徑！`;
                animationId = requestAnimationFrame(step);
            } else {
                statusEl.innerText = "完成 🎉";
            }
        }
    }
    step();
}

resetBtn.onclick = () => {
    cancelAnimationFrame(animationId);
    points = [];
    layers.clearLayers();
    statusEl.innerText = "點擊地圖選擇起點";
};