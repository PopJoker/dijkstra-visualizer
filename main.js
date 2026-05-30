// main.js

// 初始化 Leaflet 地圖 設定台北 101 附近與深色底圖
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

const statusEl = document.getElementById("status");
const resetBtn = document.getElementById("reset-btn");

// 地圖點擊事件
map.on('click', (e) => {
    if (points.length >= 2) return; // 動畫或計算中鎖定點擊

    points.push(e.latlng);
    const color = points.length === 1 ? "#00d2ff" : "#ff4757";

    // 畫起終點標記
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
        worker.postMessage({ start: points[0], end: points[1] }); // 丟給後台算
    }
});

// 接收 Worker 計算結果
worker.onmessage = (e) => {
    if (e.data.error) {
        statusEl.innerText = "錯誤: " + e.data.error;
        points = [];
        return;
    }

    const { explored, path, bounds } = e.data;

    // 自動縮放地圖到合適範圍
    if (bounds) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }

    if (explored.length === 0) {
        statusEl.innerText = "無法找到連通的路徑。";
        return;
    }

    animate(explored, path); // 跑視覺化動畫
};

// 跑路網搜尋與最短路徑動畫
function animate(explored, path) {
    if (animationId) cancelAnimationFrame(animationId);
    let frame = 0;
    let mode = "explore";

    const exploredLayer = L.featureGroup().addTo(layers);
    const pathLC = L.polyline([], { color: "#00FF15", weight: 5, opacity: 1 }).addTo(layers);

    function step() {
        if (mode === "explore") {
            // 階段一 畫藍色路網擴散效果
            const batchSize = 15; // 每影格繪製線段數
            const startIdx = frame;
            const endIdx = Math.min(frame + batchSize, explored.length);

            for (let i = startIdx; i < endIdx; i++) {
                L.polyline(explored[i], {
                    color: "#00E1FF",
                    weight: 1,
                    opacity: 0.3,
                    interactive: false
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
            // 階段二 畫綠色最短路徑
            frame += 1;

            if (frame <= path.length) {
                const segs = path.slice(0, frame);
                pathLC.setLatLngs(segs.flat(1));
                statusEl.innerText = `找到最短路徑！`;
                animationId = requestAnimationFrame(step);
            } else {
                statusEl.innerText = "完成";
            }
        }
    }
    step();
}

// 重置按鈕
resetBtn.onclick = () => {
    cancelAnimationFrame(animationId);
    points = [];
    layers.clearLayers();
    statusEl.innerText = "點擊地圖選擇起點";
};