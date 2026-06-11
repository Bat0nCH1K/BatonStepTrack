// BatonStepTrack — app.js v5 (карта фикс + PWA баннер)
let map = null, track = [], watchId = null, timer = null, seconds = 0;
let mode = 'walk', tracking = false, mapInitialized = false;
let gpsMarker = null, gpsWatchId = null;
let currentLat = null, currentLng = null;
let wakeLock = null;
let offlineForced = false;
let lastPoint = null;
let silentAudio = null;

function enableBackgroundAudio() {
    if (silentAudio) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(ctx.destination);
        source.start();
        silentAudio = { ctx, source };
        log('🔇 Фоновый звук вкл');
    } catch(e) { log('⚠️ Аудио нет'); }
}

function disableBackgroundAudio() {
    if (silentAudio) { try { silentAudio.source.stop(); silentAudio.ctx.close(); } catch(e) {} silentAudio = null; }
}

function log(msg) {
    const el = document.getElementById('consoleLog');
    if (!el) return;
    el.classList.add('visible');
    el.innerHTML += `[${new Date().toLocaleTimeString()}] ${msg}<br>`;
    el.scrollTop = el.scrollHeight;
    while (el.children.length > 50) el.removeChild(el.firstChild);
}

function toggleConsole() { document.getElementById('consoleLog').classList.toggle('visible'); }

function toggleOfflineMode() {
    offlineForced = document.getElementById('offlineMode').checked;
    log(offlineForced ? '📴 Офлайн' : '🌐 Онлайн');
    if (map && offlineForced) {
        map.getContainer().style.background = '#0a0a1a';
        map.eachLayer(l => { if (l instanceof L.TileLayer) map.removeLayer(l); });
    }
}

async function requestWakeLock() { try { wakeLock = await navigator.wakeLock.request('screen'); log('🔒 Экран'); } catch(e) { log('⚠️ WakeLock нет'); } }
function releaseWakeLock() { if (wakeLock) { wakeLock.release(); wakeLock = null; } }

window.addEventListener('beforeunload', (e) => {
    if (tracking) { e.preventDefault(); e.returnValue = 'Идёт запись маршрута. Выйти?'; return e.returnValue; }
});

function autoRestore() {
    const saved = localStorage.getItem('bst-current');
    if (!saved) return;
    track = JSON.parse(saved);
    log(`🔄 Восстановлено ${track.length} точек`);
    const savedSeconds = parseInt(localStorage.getItem('bst-seconds') || '0');
    const startTime = localStorage.getItem('bst-start-time');
    const savedMode = localStorage.getItem('bst-mode') || 'walk';
    if (startTime) { seconds = savedSeconds + Math.floor((Date.now() - new Date(startTime).getTime()) / 1000); if (seconds < savedSeconds) seconds = savedSeconds; }
    else seconds = savedSeconds;
    mode = savedMode;
    document.getElementById('time').textContent = formatTime(seconds);
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('resumeBtn').style.display = '';
    document.getElementById('stopBtn').style.display = '';
    document.getElementById('locateBtn').style.display = '';
    document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
    const modeBtn = document.getElementById('mode' + mode.charAt(0).toUpperCase() + mode.slice(1));
    if (modeBtn) modeBtn.classList.add('active');
    updateStats();
    if (!mapInitialized) { document.getElementById('globeContainer').style.display = 'none'; document.getElementById('map').style.display = 'block'; initMapSilent(); }
}

function initMapSilent() {
    if (mapInitialized) return;
    log('🗺️ Инициализация карты...');
    
    // Принудительно показываем карту
    const mapEl = document.getElementById('map');
    mapEl.style.display = 'block';
    mapEl.style.flex = '1';
    mapEl.style.width = '100%';
    mapEl.style.minHeight = '200px';
    document.getElementById('globeContainer').style.display = 'none';
    
    if (typeof L === 'undefined') {
        log('❌ Leaflet не загружен!');
        mapEl.innerHTML = '<p style="color:#e94560;text-align:center;padding:40px;">❌ Карта не загрузилась</p>';
        mapInitialized = true;
        return;
    }
    log('✅ Leaflet загружен');
    
    try {
        map = L.map('map', { zoomControl: false, attributionControl: false, minZoom: 2, maxZoom: 19 }).setView([55.7512, 37.6184], 16);
        log('✅ Карта создана');
    } catch(e) { log('❌ Ошибка: ' + e.message); return; }
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    
    setTimeout(() => {
        const tileCount = document.querySelector('.leaflet-tile-pane')?.children.length || 0;
        log(`📊 Тайлов: ${tileCount}`);
        if (tileCount === 0) { map.getContainer().style.background = '#0a0a1a'; log('📴 Тёмный фон'); }
    }, 3000);
    
    mapInitialized = true;
    
    if (track.length > 0) { track.forEach(pt => L.circleMarker(pt, { radius: 3, color: '#ff9800' }).addTo(map)); if (track.length > 1) L.polyline(track, { color: '#ff9800', weight: 3 }).addTo(map); map.fitBounds(track); }
    const last = localStorage.getItem('bst-last');
    if (last && track.length === 0) { const pts = JSON.parse(last); if (pts.length > 0) L.polyline(pts, { color: '#4caf84', weight: 3, opacity: 0.4, dashArray: '5,5' }).addTo(map); }
}

function initMap() { if (!mapInitialized) initMapSilent(); }

function showGPSPosition() {
    if (!navigator.geolocation || !map) { log('⚠️ Нет геолокации'); return; }
    if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
    log('📍 GPS');
    gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => { currentLat = pos.coords.latitude; currentLng = pos.coords.longitude; if (gpsMarker) map.removeLayer(gpsMarker); gpsMarker = L.marker([currentLat, currentLng], { icon: L.divIcon({ className: 'gps-dot', iconSize: [12, 12], iconAnchor: [6, 6] }) }).addTo(map); if (!tracking) map.setView([currentLat, currentLng], 16, { animate: true, duration: 1 }); },
        (err) => { log('❌ GPS: ' + err.message); },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
}

function locateMe() { if (currentLat && currentLng && map) map.setView([currentLat, currentLng], 17, { animate: true, duration: 0.5 }); else alert('📍 Жду GPS...'); }
function showTrack(pts, color) { if (!map) return; map.eachLayer(l => { if (l instanceof L.CircleMarker || (l instanceof L.Polyline)) map.removeLayer(l); }); L.polyline(pts, { color, weight: 4 }).addTo(map); map.fitBounds(pts); if (gpsMarker) gpsMarker.addTo(map); }
function setMode(m) { mode = m; document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active')); const btn = document.getElementById('mode' + m.charAt(0).toUpperCase() + m.slice(1)); if (btn) btn.classList.add('active'); }

function startTracking() {
    if (!navigator.geolocation) { alert('Геолокация не поддерживается'); return; }
    initMap();
    map.eachLayer(l => { if (l instanceof L.CircleMarker || (l instanceof L.Polyline)) map.removeLayer(l); });
    if (gpsMarker) map.removeLayer(gpsMarker);
    if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
    tracking = true; track = []; seconds = 0; lastPoint = null;
    log('▶ Старт (' + mode + ')');
    enableBackgroundAudio();
    document.getElementById('startBtn').style.display = 'none'; document.getElementById('resumeBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = ''; document.getElementById('locateBtn').style.display = '';
    localStorage.setItem('bst-start-time', new Date().toISOString()); localStorage.setItem('bst-seconds', '0');
    localStorage.setItem('bst-mode', mode); localStorage.setItem('bst-current', '[]');
    watchId = navigator.geolocation.watchPosition(
        (pos) => { currentLat = pos.coords.latitude; currentLng = pos.coords.longitude; const pt = [currentLat, currentLng]; if (lastPoint) { const dist = getDist(lastPoint[0], lastPoint[1], pt[0], pt[1]) * 1000; if (dist < 5) return; } lastPoint = pt; track.push(pt); localStorage.setItem('bst-current', JSON.stringify(track)); L.circleMarker(pt, { radius: 3, color: '#4caf84' }).addTo(map); if (track.length > 1) L.polyline([track[track.length-2], pt], { color: '#4caf84', weight: 3 }).addTo(map); updateStats(); },
        (err) => { log('❌ GPS: ' + err.message); },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
    timer = setInterval(() => { seconds++; document.getElementById('time').textContent = formatTime(seconds); localStorage.setItem('bst-seconds', seconds.toString()); }, 1000);
}

function resumeTracking() { startTracking(); }

function stopTracking() {
    tracking = false; disableBackgroundAudio();
    if (watchId) navigator.geolocation.clearWatch(watchId);
    if (timer) clearInterval(timer);
    log('⏹ Стоп — ' + track.length + ' точек');
    document.getElementById('startBtn').style.display = ''; document.getElementById('resumeBtn').style.display = 'none'; document.getElementById('stopBtn').style.display = 'none';
    localStorage.setItem('bst-last', JSON.stringify(track)); localStorage.removeItem('bst-current'); localStorage.removeItem('bst-start-time'); localStorage.removeItem('bst-seconds');
    const history = JSON.parse(localStorage.getItem('bst-history') || '[]');
    history.push({ date: new Date().toISOString(), mode, distance: calcDistance(), time: seconds, track });
    if (history.length > 50) history.shift();
    localStorage.setItem('bst-history', JSON.stringify(history));
    showTrack(track, { walk:'#4caf84', bike:'#4a90d9', run:'#ff9800', car:'#e94560' }[mode]);
    showGPSPosition();
}

function showHistory() { initMap(); renderHistory(); document.getElementById('historyOverlay').classList.add('open'); }
function hideHistory() { document.getElementById('historyOverlay').classList.remove('open'); }
function deleteHistory(index) { const h = JSON.parse(localStorage.getItem('bst-history') || '[]'); h.splice(index,1); localStorage.setItem('bst-history', JSON.stringify(h)); renderHistory(); }
function renderHistory() {
    const history = JSON.parse(localStorage.getItem('bst-history') || '[]');
    const list = document.getElementById('historyList');
    if (!list) return;
    list.innerHTML = history.length === 0 ? '<p style="text-align:center;color:#888;">Нет сохранённых маршрутов</p>' : history.slice().reverse().map((h, i) => {
        const ri = history.length-1-i;
        return `<div class="history-item" onclick="viewHistory(${ri})"><span class="mode-icon">${{ walk:'🚶', bike:'🚴', run:'🏃', car:'🚗' }[h.mode]||'📍'}</span><div class="info"><div class="date">${new Date(h.date).toLocaleDateString('ru-RU')+' '+new Date(h.date).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</div><div class="stats" style="color:${{ walk:'#4caf84', bike:'#4a90d9', run:'#ff9800', car:'#e94560' }[h.mode]||'#4caf84'}">${h.distance.toFixed(2)} км | ${formatTime(h.time)}</div></div><button class="history-delete" onclick="event.stopPropagation();deleteHistory(${ri})">🗑</button></div>`;
    }).join('');
}
function viewHistory(index) { const route = (JSON.parse(localStorage.getItem('bst-history')||'[]'))[index]; if (route?.track) { showTrack(route.track, { walk:'#4caf84', bike:'#4a90d9', run:'#ff9800', car:'#e94560' }[route.mode]||'#4caf84'); document.getElementById('dist').textContent = route.distance.toFixed(2); document.getElementById('time').textContent = formatTime(route.time); document.getElementById('speed').textContent = route.time>0 ? (route.distance/(route.time/3600)).toFixed(1) : '0.0'; hideHistory(); } }

function calcDistance() { let d=0; for(let i=1;i<track.length;i++) d+=getDist(track[i-1][0],track[i-1][1],track[i][0],track[i][1]); return d; }
function getDist(lat1,lon1,lat2,lon2) { const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180; return R*2*Math.atan2(Math.sqrt(Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2),Math.sqrt(1-(Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2))); }
function updateStats() { const d=calcDistance(); document.getElementById('dist').textContent=d.toFixed(2); document.getElementById('speed').textContent=seconds>0?Math.min((d/(seconds/3600)),{walk:6,bike:25,run:15,car:120}[mode]).toFixed(1):'0.0'; }
function formatTime(s) { return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); }

log('🚀 BatonStepTrack v5');

// PWA баннер
(function() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone || localStorage.getItem('pwa-dismissed')) return;
    
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        showBanner();
    });
    
    setTimeout(() => { if (!deferredPrompt) showBanner(); }, 3000);
    
    function showBanner() {
        const banner = document.createElement('div');
        banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#16213e;padding:14px 16px;z-index:999;display:flex;flex-direction:column;gap:10px;border-top:2px solid #4caf84;';
        banner.innerHTML = `
            <div style="font-size:13px;text-align:center;">📲 <b>Установите приложение</b><br><span style="font-size:11px;color:#aaa;">Работает в фоне, не теряет маршрут</span></div>
            <button style="background:#4caf84;color:#fff;padding:10px;border-radius:8px;border:none;font-weight:bold;font-size:14px;" id="pwaInstallBtn">📥 Скачать</button>
            <button style="background:none;border:none;color:#888;font-size:14px;align-self:center;" id="pwaDismissBtn">Закрыть</button>
        `;
        document.body.appendChild(banner);
        
        document.getElementById('pwaInstallBtn').onclick = () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                deferredPrompt.userChoice.then(() => banner.remove());
            } else {
                alert('Откройте в Google Chrome\n⋮ → "Добавить на главный экран"');
                banner.remove();
            }
        };
        document.getElementById('pwaDismissBtn').onclick = () => {
            banner.remove();
            localStorage.setItem('pwa-dismissed', '1');
        };
    }
})();

autoRestore();
