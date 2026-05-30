// worker.js (完整修正版：精確路網探索)

// Overpass API 備用名單
const OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter"
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 撈 OSM 資料 失敗自動換伺服器重試
async function fetchWithRetry(query) {
    for (const url of OVERPASS_URLS) {
        try {
            const res = await fetch(url, {
                method: "POST",
                body: "data=" + encodeURIComponent(query)
            });
            const text = await res.text();
            if (text.includes("timeout") || text.includes("too busy")) {
                await sleep(2000);
                continue;
            }
            return JSON.parse(text);
        } catch (e) {
            console.warn(`❌ ${url} 失敗`, e);
        }
    }
    throw new Error("伺服器忙碌中。");
}

self.onmessage = async function (e) {
    try {
        const { start, end } = e.data;
        let explored = [];
        let path = [];

        // 經緯度算實際距離 (Haversine 公式)
        const heuristic = (a, b) => {
            const R = 6371000;
            const dLat = (a.lat - b.lat) * Math.PI / 180;
            const dLng = (a.lng - b.lng) * Math.PI / 180;
            const x = Math.sin(dLat / 2) ** 2 +
                Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
                Math.sin(dLng / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(x));
        };

        // 擴大搜尋邊界 避免斷路
        const buffer = 0.008;
        const minLat = Math.min(start.lat, end.lat) - buffer;
        const maxLat = Math.max(start.lat, end.lat) + buffer;
        const minLng = Math.min(start.lng, end.lng) - buffer;
        const maxLng = Math.max(start.lng, end.lng) + buffer;

        // 撈範圍內可通行的道路
        const query = `
            [out:json][timeout:25];
            (way["highway"~"primary|secondary|tertiary|residential|service|unclassified"]
            (${minLat},${minLng},${maxLat},${maxLng}););
            (._;>;);
            out body;`;

        const osmData = await fetchWithRetry(query);

        const nodes = new Map();
        const adj = new Map();

        // 1 建立節點表
        for (const el of osmData.elements) {
            if (el.type === "node") {
                nodes.set(el.id, { lat: el.lat, lng: el.lon });
            }
        }

        // 2 建立鄰接表 將 way 拆解成點對點的邊並算距離
        for (const el of osmData.elements) {
            if (el.type === "way" && el.nodes) {
                for (let i = 0; i < el.nodes.length - 1; i++) {
                    const u = el.nodes[i], v = el.nodes[i + 1];
                    const a = nodes.get(u), b = nodes.get(v);
                    if (!a || !b) continue;

                    const d = heuristic(a, b);
                    if (!adj.has(u)) adj.set(u, []);
                    if (!adj.has(v)) adj.set(v, []);

                    // 預設雙向
                    adj.get(u).push({ to: v, w: d });
                    adj.get(v).push({ to: u, w: d });
                }
            }
        }

        // 3 點對齊 找出最靠近點擊位置的真實道路節點
        let sId = null, eId = null;
        let dS = Infinity, dE = Infinity;
        for (const [id, coord] of nodes) {
            if (!adj.has(id)) continue;
            const ds = heuristic(coord, start);
            const de = heuristic(coord, end);
            if (ds < dS) { dS = ds; sId = id; }
            if (de < dE) { dE = de; eId = id; }
        }

        if (!sId || !eId) throw new Error("找不到道路。");

        // 4 A* 搜尋
        const openSet = new Set([sId]);
        const gScore = new Map([[sId, 0]]);
        const fScore = new Map([[sId, heuristic(nodes.get(sId), nodes.get(eId))]]);
        const cameFrom = new Map();
        const visited = new Set();

        while (openSet.size > 0) {
            // 取 fScore 最小的節點
            let curr = null;
            let minF = Infinity;
            for (const id of openSet) {
                const f = fScore.get(id) ?? Infinity;
                if (f < minF) { minF = f; curr = id; }
            }

            if (curr === eId) break;

            openSet.delete(curr);
            visited.add(curr);

            const neighbors = adj.get(curr) || [];
            for (const edge of neighbors) {
                if (visited.has(edge.to)) continue;

                const tentativeG = (gScore.get(curr) ?? Infinity) + edge.w;
                if (tentativeG < (gScore.get(edge.to) ?? Infinity)) {
                    cameFrom.set(edge.to, curr);
                    gScore.set(edge.to, tentativeG);
                    fScore.set(edge.to, tentativeG + heuristic(nodes.get(edge.to), nodes.get(eId)));
                    openSet.add(edge.to);

                    // 存探索邊 給前端畫動畫
                    const u = nodes.get(curr);
                    const v = nodes.get(edge.to);
                    explored.push([[u.lat, u.lng], [v.lat, v.lng]]);
                }
            }
        }

        // 5 回溯重建最短路徑
        let temp = eId;
        while (cameFrom.has(temp)) {
            const prev = cameFrom.get(temp);
            path.push([[nodes.get(prev).lat, nodes.get(prev).lng], [nodes.get(temp).lat, nodes.get(temp).lng]]);
            temp = prev;
        }

        self.postMessage({ explored, path, bounds: [[minLat, minLng], [maxLat, maxLng]] });

    } catch (err) {
        self.postMessage({ error: err.message });
    }
};