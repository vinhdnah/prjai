// ======================================================================
// CONFIGURATION SECTION - QUẢN LÝ THÔNG SỐ HIỆU ỨNG 💕
// ======================================================================
const CONFIG = {
    // ImgBB API key để tải ảnh lên (Bạn cung cấp)
    imgbbKey: 'fd742c3948f8cf8f60e57cb4229df53d',

    // Độ nhạy và độ mượt (Đặt = 1.0 để bám tay tức thì 1:1 không trễ, đặt < 1.0 để làm mượt chống rung)
    smoothFactor: 1.0, 
    
    // Khoảng cách nhận diện khung
    minFrameDiag: 80,    // Khoảng cách tối thiểu để hiển thị khung ảnh
    closeThreshold: 100,  // Khoảng cách khi khép tay để chuẩn bị chuyển ảnh
    openThreshold: 160,   // Khoảng cách khi mở tay rộng ra để chuyển ảnh
    
    // Số lượng hạt tối đa để đảm bảo hiệu năng
    maxSparks: 80,
    maxHearts: 25,
    maxGlitters: 40,
    
    // Cấu hình thu phóng và dịch ảnh
    fitMode: 'cover',    // 'cover' hoặc 'contain'
    imageZoom: 1.0,      // Hệ số zoom ảnh
    imageOffsetX: 0.0,   // Dịch chuyển X
    imageOffsetY: 0.0,   // Dịch chuyển Y
    
    // Danh sách ảnh dự phòng (fallback) nếu trình duyệt không quét được thư mục tự động
    fallbackImages: [
        'images/anh1.jpg',
        'images/anh2.jpg',
        'images/anh3.jpg'
    ]
};

let videoElement, hands, handResults = null, isModelLoaded = false;
let activeStream = null, lastVideoTime = -1;
let bgImages = [];
let currentImgIdx = 0;
let wasClosed = false; 
let prevImgIdx = -1;
let transitionProgress = 1.0;

// Biến lưu tọa độ khung đã được làm mượt
let smoothCorners = null;

// Không định nghĩa preload() để p5.js khởi chạy ngay lập tức mà không bị block màn hình tải ảnh.
function preload() {
    // Để trống
}

let sparks = [];
let hearts = [];
let glitters = [];
let prevDist = 0;
let isOpen = false;
let openAlpha = 0;
let cornerPulse = 0;
const ALL_TIPS = [4, 8, 12, 16, 20];
const TIP_COLORS = ['#ff3366', '#ffaa00', '#00ff88', '#00aaff', '#cc66ff'];
const HEART_VERTS = [];

for (let a = 0; a < Math.PI * 2; a += 0.25) {
    HEART_VERTS.push({
        hx: 16 * Math.pow(Math.sin(a), 3),
        hy: -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a))
    });
}

function setup() {
    let canvas = createCanvas(windowWidth, windowHeight);
    canvas.parent('canvas-wrapper');
    textAlign(CENTER, CENTER);
    textFont('Courier New');
    imageMode(CENTER); // Thiết lập vẽ ảnh từ tâm
    
    videoElement = document.querySelector('.input_video');
    
    // Cấu hình MediaPipe Hands với độ nhạy tối ưu hơn
    hands = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    hands.setOptions({ 
        maxNumHands: 2, 
        modelComplexity: 0, // Dùng model 0 (Lite) để tăng tốc độ nhận diện lên gấp 2-3 lần, triệt tiêu độ trễ
        minDetectionConfidence: 0.5, // Giảm xuống 0.5 giúp nhận diện ngón tay nhạy hơn
        minTrackingConfidence: 0.55  // Giữ tracking ở 0.55 để tránh mất dấu khi di chuyển nhanh
    });
    
    hands.onResults((results) => {
        if (!isModelLoaded) {
            isModelLoaded = true;
            document.getElementById('loader').style.display = 'none';
        }
        handResults = results;
    });
    
    getCameras();
    
    // Tự động quét và tải ảnh trong thư mục images
    loadImagesAutomatically();
    
    // Khởi tạo tính năng chia sẻ ảnh
    initShareModal();

    // Khởi tạo tính năng căn chỉnh ảnh
    initAdjustPanel();
}

// --- Hàm tự động quét và tải ảnh từ thư mục images ---
async function loadImagesAutomatically() {
    // 1. Kiểm tra xem người dùng có mở link chia sẻ chứa mã ảnh không
    const urlParams = new URLSearchParams(window.location.search);
    const shareCode = urlParams.get('code') || urlParams.get('img');
    let decodedString = null;
    let sharedImgUrls = [];

    if (shareCode) {
        try {
            decodedString = decodeSafeBase64(shareCode);
            // Cắt chuỗi giải mã bằng dấu phẩy để lấy danh sách các ảnh
            const urls = decodedString.split(',');
            sharedImgUrls = urls.filter(url => url.startsWith('http://') || url.startsWith('https://'));
        } catch (e) {
            if (shareCode.startsWith('http://') || shareCode.startsWith('https://')) {
                sharedImgUrls = [shareCode];
            }
        }
    }

    if (sharedImgUrls.length > 0) {
        console.log("Đang tải các ảnh được chia sẻ:", sharedImgUrls);
        const infoEl = document.getElementById('info');
        if (infoEl) {
            infoEl.innerHTML = `💕 Nhận ${sharedImgUrls.length} ảnh từ bạn bè! Ngón cái & trỏ để mở khung`;
        }
        
        // Để giữ đúng thứ tự ảnh khi chèn bằng unshift, ta nên unshift từ cuối mảng lên đầu
        for (let i = sharedImgUrls.length - 1; i >= 0; i--) {
            const path = sharedImgUrls[i];
            loadImage(path, 
                (loadedImg) => {
                    bgImages.unshift(loadedImg); // Đưa lên đầu danh sách hiển thị
                    currentImgIdx = 0;
                },
                (err) => {
                    console.error("Lỗi khi tải ảnh chia sẻ:", path, err);
                }
            );
        }
    }

    let imageList = [];
    try {
        // http-server có tính năng Directory Listing (hiển thị danh sách file dưới dạng HTML)
        const response = await fetch('images/');
        if (response.ok) {
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const links = Array.from(doc.querySelectorAll('a'));
            
            const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
            const foundFiles = links
                .map(link => link.getAttribute('href'))
                .filter(href => href && imageExtensions.some(ext => href.toLowerCase().endsWith(ext)))
                .map(href => 'images/' + href.split('/').pop());
            
            // Lọc các ảnh trùng lặp
            imageList = [...new Set(foundFiles)];
        }
    } catch (e) {
        console.warn("Không thể quét thư mục tự động (lỗi CORS hoặc hosting không hỗ trợ), dùng danh sách dự phòng.");
    }
    
    // Nếu không quét được ảnh nào, dùng danh sách dự phòng
    if (imageList.length === 0) {
        imageList = CONFIG.fallbackImages;
    }
    
    console.log("Danh sách ảnh tải vào game:", imageList);
    
    // Tải bất đồng bộ các ảnh
    for (let path of imageList) {
        if (sharedImgUrl && path === sharedImgUrl) continue;
        
        loadImage(path, 
            (loadedImg) => {
                bgImages.push(loadedImg);
            },
            (err) => {
                console.error("Không thể tải ảnh: " + path);
            }
        );
    }
}

async function getCameras() {
    try {
        await navigator.mediaDevices.getUserMedia({ video: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const vids = devices.filter(d => d.kind === 'videoinput');
        const sel = document.getElementById('camera-select');
        vids.forEach((d, i) => { 
            let o = document.createElement('option'); 
            o.value = d.deviceId; 
            o.text = d.label || `Camera ${i + 1}`; 
            sel.appendChild(o); 
        });
        if (vids.length > 0) { 
            sel.style.display = 'block'; 
            sel.onchange = () => startCamera(sel.value); 
            startCamera(sel.value); 
        }
    } catch (e) { 
        console.error(e); 
    }
}

async function startCamera(deviceId) {
    if (activeStream) activeStream.getTracks().forEach(t => t.stop());
    
    // Kiểm tra thiết bị di động
    let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    // Sử dụng tỉ lệ chuẩn 16:9 để camera hiển thị bình thường không bị zoom/crop trên màn hình rộng
    let targetWidth = isMobile ? 640 : 1280;
    let targetHeight = isMobile ? 360 : 720;
    
    activeStream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
            width: { ideal: targetWidth }, 
            height: { ideal: targetHeight }, 
            deviceId: deviceId ? { exact: deviceId } : undefined 
        } 
    });
    videoElement.srcObject = activeStream;
    videoElement.onloadedmetadata = () => { 
        videoElement.play(); 
        processFrame(); 
    };
}

let isProcessing = false;
let lastProcessTime = 0;
const PROCESS_THROTTLE_MS = 33; // Tối đa ~30 FPS nhận diện tay để tránh nghẽn CPU/GPU, giúp các hiệu ứng vẽ luôn đạt 60 FPS mượt mà

async function processFrame() {
    let now = performance.now();
    if (isProcessing || (now - lastProcessTime < PROCESS_THROTTLE_MS)) {
        requestAnimationFrame(processFrame);
        return;
    }
    
    if (!videoElement.paused && !videoElement.ended && videoElement.currentTime !== lastVideoTime) {
        lastVideoTime = videoElement.currentTime;
        isProcessing = true;
        lastProcessTime = now;
        hands.send({ image: videoElement }).then(() => {
            isProcessing = false;
        }).catch((err) => {
            isProcessing = false;
        });
    }
    requestAnimationFrame(processFrame);
}

function spawnSparks(x, y, count, col, strong) {
    if (sparks.length >= CONFIG.maxSparks) return;
    let speed = strong ? 6 : 3;
    let sz = strong ? 5 : 3;
    for (let i = 0; i < count; i++) {
        sparks.push({
            x, y,
            vx: random(-speed, speed),
            vy: random(-speed - 1, speed * 0.3),
            life: random(strong ? 20 : 10, strong ? 40 : 25),
            maxLife: strong ? 40 : 25,
            size: random(2, sz),
            col: col
        });
    }
}

function spawnHearts(corners, count) {
    if (hearts.length >= CONFIG.maxHearts) return;
    for (let i = 0; i < count; i++) {
        let t1 = random(), t2 = random();
        let top = { x: lerp(corners[0].x, corners[1].x, t1), y: lerp(corners[0].y, corners[1].y, t1) };
        let bot = { x: lerp(corners[3].x, corners[2].x, t1), y: lerp(corners[3].y, corners[2].y, t1) };
        hearts.push({
            x: lerp(top.x, bot.x, t2),
            y: lerp(top.y, bot.y, t2),
            vy: random(-1.2, -0.3),
            vx: random(-0.3, 0.3),
            life: random(50, 90),
            maxLife: 90,
            size: random(10, 20)
        });
    }
}

function spawnGlitters(corners, count) {
    if (glitters.length >= CONFIG.maxGlitters) return;
    for (let i = 0; i < count; i++) {
        let t1 = random(), t2 = random();
        let top = { x: lerp(corners[0].x, corners[1].x, t1), y: lerp(corners[0].y, corners[1].y, t1) };
        let bot = { x: lerp(corners[3].x, corners[2].x, t1), y: lerp(corners[3].y, corners[2].y, t1) };
        glitters.push({
            x: lerp(top.x, bot.x, t2), y: lerp(top.y, bot.y, t2),
            life: random(25, 50), maxLife: 50,
            size: random(1.5, 3),
            twinkle: random(0.05, 0.12)
        });
    }
}

function drawHeart(x, y, sz) {
    let r = sz * 0.05;
    beginShape();
    for (let v of HEART_VERTS) {
        vertex(x + v.hx * r, y + v.hy * r);
    }
    endShape(CLOSE);
}

// --- Sắp xếp 4 điểm thành đa giác không tự cắt (TL, TR, BR, BL) ---
function sortQuad(points) {
    let cx = (points[0].x + points[1].x + points[2].x + points[3].x) / 4;
    let cy = (points[0].y + points[1].y + points[2].y + points[3].y) / 4;

    // Sắp xếp các điểm theo góc cực xoay quanh tâm (centroid)
    let sorted = points.slice().sort((a, b) => {
        return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
    });

    // Tìm điểm gần góc trên bên trái nhất (x+y nhỏ nhất) để bắt đầu
    let minSum = Infinity, startIdx = 0;
    for (let i = 0; i < 4; i++) {
        let sum = sorted[i].x + sorted[i].y;
        if (sum < minSum) {
            minSum = sum;
            startIdx = i;
        }
    }

    // Sắp xếp lại theo thứ tự kim đồng hồ bắt đầu từ Top-Left (TL, TR, BR, BL)
    let finalPoints = [];
    for (let i = 0; i < 4; i++) {
        finalPoints.push(sorted[(startIdx + i) % 4]);
    }
    return finalPoints;
}

// --- Chuyển đổi tọa độ từ khung hình camera (MediaPipe) sang kích thước thực tế của Canvas (theo tỉ lệ object-fit: cover) ---
function getCanvasCoords(lm) {
    let videoW = videoElement.videoWidth || 1280;
    let videoH = videoElement.videoHeight || 720;
    
    let videoAspect = videoW / videoH;
    let canvasAspect = width / height;
    
    let scale, dx = 0, dy = 0;
    if (canvasAspect > videoAspect) {
        // Canvas bè ngang hơn Video (Video bị cắt trên dưới)
        scale = width / videoW;
        dy = (height - videoH * scale) / 2;
    } else {
        // Canvas cao dọc hơn Video (Video bị cắt trái phải - thường thấy trên Điện thoại)
        scale = height / videoH;
        dx = (width - videoW * scale) / 2;
    }
    
    // Ánh xạ tọa độ normalized (0 đến 1) của MediaPipe sang điểm hiển thị thực tế
    let px = (lm.x * videoW) * scale + dx;
    let py = (lm.y * videoH) * scale + dy;
    
    return { x: px, y: py };
}

function draw() {
    clear();
    cornerPulse = (sin(frameCount * 0.08) + 1) * 0.5;
    let rawCorners = null;
    
    if (handResults && handResults.multiHandLandmarks) {
        drawingContext.shadowBlur = 15;
        
        // Vẽ hiệu ứng trên đầu 5 ngón tay
        for (let hi = 0; hi < handResults.multiHandLandmarks.length; hi++) {
            let lm = handResults.multiHandLandmarks[hi];
            for (let ti = 0; ti < ALL_TIPS.length; ti++) {
                let tip = lm[ALL_TIPS[ti]];
                let pt = getCanvasCoords(tip);
                let fx = pt.x;
                let fy = pt.y;
                let col = TIP_COLORS[ti];
                drawingContext.shadowColor = col;
                fill(col);
                noStroke();
                drawHeart(fx, fy, 12);
                if (frameCount % 4 === 0) {
                    spawnSparks(fx, fy, 1, col, true);
                }
            }
        }
        drawingContext.shadowBlur = 0;
        
        // Khi phát hiện đủ 2 bàn tay để tạo khung
        if (handResults.multiHandLandmarks.length >= 2) {
            let h1 = handResults.multiHandLandmarks[0];
            let h2 = handResults.multiHandLandmarks[1];
            
            // Lấy 4 điểm chốt (Ngón cái-4 và Ngón trỏ-8 của cả 2 tay) mapped chính xác theo toạ độ màn hình
            let pts = [
                getCanvasCoords(h1[4]),
                getCanvasCoords(h1[8]),
                getCanvasCoords(h2[4]),
                getCanvasCoords(h2[8])
            ];
            
            // Sắp xếp chuẩn các góc theo chiều kim đồng hồ
            rawCorners = sortQuad(pts);
        }
    }
    
    // --- Áp dụng làm mượt góc khung ảnh (Exponential Smoothing) ---
    // --- Áp dụng làm mượt hoặc bám tay trực tiếp 1:1 ---
    if (rawCorners) {
        if (CONFIG.smoothFactor >= 1.0) {
            smoothCorners = rawCorners;
        } else if (!smoothCorners) {
            smoothCorners = rawCorners.map(p => ({ x: p.x, y: p.y }));
        } else {
            let f = CONFIG.smoothFactor;
            for (let i = 0; i < 4; i++) {
                smoothCorners[i].x = smoothCorners[i].x * (1 - f) + rawCorners[i].x * f;
                smoothCorners[i].y = smoothCorners[i].y * (1 - f) + rawCorners[i].y * f;
            }
        }
    } else {
        smoothCorners = null;
    }
    
    // --- Vẽ Khung Ảnh và Các Hiệu Ứng ---
    if (smoothCorners) {
        let tl = smoothCorners[0], tr = smoothCorners[1], br = smoothCorners[2], bl = smoothCorners[3];
        let diag = dist(tl.x, tl.y, br.x, br.y);
        
        // Ngưỡng tính toán động tối ưu cho cả máy tính và điện thoại
        let minDimension = Math.min(width, height);
        let minFrameDiag = Math.max(60, Math.min(100, minDimension * 0.15));
        let closeThreshold = Math.max(90, Math.min(150, minDimension * 0.22));
        let openThreshold = Math.max(140, Math.min(220, minDimension * 0.32));
        
        let nowOpen = diag > minFrameDiag;
        if (nowOpen && wasClosed && bgImages.length > 0) {
            prevImgIdx = currentImgIdx;
            currentImgIdx = (currentImgIdx + 1) % bgImages.length;
            transitionProgress = 0.0;
            wasClosed = false;
        }
        if (diag < closeThreshold) wasClosed = true;
        isOpen = nowOpen;
        
        // Tăng tiến trình chuyển cảnh
        if (transitionProgress < 1.0) {
            transitionProgress += 0.06; // Khoảng 16 khung hình
            if (transitionProgress > 1.0) transitionProgress = 1.0;
        }
        
        openAlpha = isOpen ? min(255, openAlpha + 10) : max(0, openAlpha - 12);
        
        if (isOpen && diag > prevDist + 2) {
            for (let c of smoothCorners) {
                spawnSparks(c.x, c.y, 4, random(['#ff3366', '#ff6699', '#ffaa00', '#ff4488']), true);
            }
        }
        if (isOpen && frameCount % 5 === 0) spawnHearts(smoothCorners, 2);
        if (isOpen && frameCount % 3 === 0) spawnGlitters(smoothCorners, 4);
        
        prevDist = diag;
        
        // Vẽ hiệu ứng vòng tròn và trái tim pulsing tại 4 góc đã được làm mượt
        for (let i = 0; i < 4; i++) {
            let p = smoothCorners[i];
            let tipCol = ['#ff3366', '#ff3366', '#ffaa00', '#ffaa00'][i];
            
            noFill();
            stroke(tipCol);
            strokeWeight(2);
            drawingContext.shadowBlur = 15;
            drawingContext.shadowColor = tipCol;
            drawingContext.globalAlpha = (0.3 + cornerPulse * 0.5) * (openAlpha / 255);
            ellipse(p.x, p.y, 38 + cornerPulse * 14);
            drawingContext.globalAlpha = 1;
            drawingContext.shadowBlur = 0;
            
            push();
            translate(p.x, p.y);
            drawingContext.shadowBlur = 30;
            drawingContext.shadowColor = tipCol;
            drawingContext.globalAlpha = openAlpha / 255;
            fill(tipCol);
            noStroke();
            drawHeart(0, 0, 18 + cornerPulse * 4);
            drawingContext.globalAlpha = 1;
            drawingContext.shadowBlur = 0;
            pop();
            
            if (frameCount % 2 === 0 && isOpen) {
                spawnSparks(p.x, p.y, 3, tipCol, true);
            }
        }
        
        // --- Hiển thị ảnh cắt bên trong khung ---
        if (openAlpha > 10) {
            let a = openAlpha;
            
            // Vẽ ảnh bên trong khung sử dụng clip
            let drawClippedImage = (img, alphaVal) => {
                if (!img) return;
                push();
                drawingContext.save();
                drawingContext.beginPath();
                drawingContext.moveTo(tl.x, tl.y);
                drawingContext.lineTo(tr.x, tr.y);
                drawingContext.lineTo(br.x, br.y);
                drawingContext.lineTo(bl.x, bl.y);
                drawingContext.closePath();
                drawingContext.clip();
                
                let minX = Math.min(tl.x, tr.x, br.x, bl.x);
                let maxX = Math.max(tl.x, tr.x, br.x, bl.x);
                let minY = Math.min(tl.y, tr.y, br.y, bl.y);
                let maxY = Math.max(tl.y, tr.y, br.y, bl.y);
                let bw = maxX - minX;
                let bh = maxY - minY;
                let cx = (minX + maxX) / 2;
                let cy = (minY + maxY) / 2;
                
                let breathe = 1.0 + sin(frameCount * 0.02) * 0.04;
                let imgAspect = img.width / img.height;
                let boxAspect = bw / bh;
                
                let zoom = CONFIG.imageZoom || 1.0;
                let fit = CONFIG.fitMode || 'cover';
                
                // 1. Vẽ nền trong suốt nếu là chế độ contain (Vừa khít) để tránh lộ khoảng đen trống
                if (fit === 'contain') {
                    let bgW, bgH;
                    if (boxAspect > imgAspect) {
                        bgW = bw * breathe;
                        bgH = (bw / imgAspect) * breathe;
                    } else {
                        bgH = bh * breathe;
                        bgW = (bh * imgAspect) * breathe;
                    }
                    drawingContext.globalAlpha = (alphaVal * 0.25) / 255;
                    image(img, cx, cy, bgW, bgH);
                }
                
                // 2. Tính toán kích thước cho hình ảnh chính
                let dw, dh;
                if (fit === 'cover') {
                    if (boxAspect > imgAspect) { 
                        dw = bw * breathe * zoom; 
                        dh = (bw / imgAspect) * breathe * zoom; 
                    } else { 
                        dh = bh * breathe * zoom; 
                        dw = (bh * imgAspect) * breathe * zoom; 
                    }
                } else { // 'contain'
                    if (boxAspect > imgAspect) {
                        dh = bh * breathe * zoom;
                        dw = bh * imgAspect * breathe * zoom;
                    } else {
                        dw = bw * breathe * zoom;
                        dh = (bw / imgAspect) * breathe * zoom;
                    }
                }
                
                // Tính toán độ dời ảnh (panning) theo cài đặt thanh trượt (offset tỉ lệ theo kích thước khung)
                let offsetX = (CONFIG.imageOffsetX || 0) * bw;
                let offsetY = (CONFIG.imageOffsetY || 0) * bh;
                
                drawingContext.globalAlpha = alphaVal / 255;
                image(img, cx + offsetX, cy + offsetY, dw, dh);
                drawingContext.globalAlpha = 1;
                drawingContext.restore();
                pop();
            };

            // Thực hiện hiệu ứng Cross-Fade chuyển tiếp mượt mà
            if (prevImgIdx !== -1 && transitionProgress < 1.0) {
                let oldImg = bgImages[prevImgIdx];
                let newImg = bgImages[currentImgIdx];
                
                // Vẽ ảnh cũ mờ dần
                if (oldImg) drawClippedImage(oldImg, a * (1 - transitionProgress));
                // Vẽ ảnh mới rõ dần
                if (newImg) drawClippedImage(newImg, a * transitionProgress);
            } else {
                let curImg = bgImages[currentImgIdx];
                if (curImg) drawClippedImage(curImg, a);
            }
            
            // Hiệu ứng Vignette hồng dịu nhẹ bên trong khung
            if (bgImages[currentImgIdx]) {
                push();
                drawingContext.save();
                drawingContext.beginPath();
                drawingContext.moveTo(tl.x, tl.y);
                drawingContext.lineTo(tr.x, tr.y);
                drawingContext.lineTo(br.x, br.y);
                drawingContext.lineTo(bl.x, bl.y);
                drawingContext.closePath();
                drawingContext.clip();
                
                let cx2 = (tl.x + br.x) / 2;
                let cy2 = (tl.y + br.y) / 2;
                let rad = dist(tl.x, tl.y, br.x, br.y) / 2;
                let grad = drawingContext.createRadialGradient(cx2, cy2, rad * 0.3, cx2, cy2, rad);
                grad.addColorStop(0, 'rgba(255,105,180,0)');
                grad.addColorStop(1, `rgba(255,20,80,${0.15 * a / 255})`);
                drawingContext.fillStyle = grad;
                drawingContext.fillRect(tl.x - 50, tl.y - 50, dist(tl.x, 0, tr.x, 0) + 100, dist(0, tl.y, 0, bl.y) + 100);
                drawingContext.restore();
                pop();
            }
            
            // Vẽ viền lớn dạng Gradient đổi màu chạy dọc theo khung
            drawingContext.shadowBlur = 20 + cornerPulse * 15;
            drawingContext.shadowColor = `rgba(255,105,180,${a / 255})`;
            let borderGrad = drawingContext.createLinearGradient(tl.x, tl.y, br.x, br.y);
            borderGrad.addColorStop(0, '#ff69b4');
            borderGrad.addColorStop(0.5, '#ffaa00');
            borderGrad.addColorStop(1, '#ff3366');
            drawingContext.strokeStyle = borderGrad;
            drawingContext.lineWidth = 4;
            drawingContext.beginPath();
            drawingContext.moveTo(tl.x, tl.y);
            drawingContext.lineTo(tr.x, tr.y);
            drawingContext.lineTo(br.x, br.y);
            drawingContext.lineTo(bl.x, bl.y);
            drawingContext.closePath();
            drawingContext.stroke();
            
            // Viền chỉ trang trí mỏng màu trắng nhẹ bên trong
            stroke(255, 255, 255, a * 0.4);
            strokeWeight(1);
            drawingContext.shadowBlur = 5;
            drawingContext.shadowColor = 'rgba(255,255,255,0.3)';
            let cx3 = (tl.x + br.x) / 2;
            let cy3 = (tl.y + br.y) / 2;
            beginShape();
            for (let c of smoothCorners) {
                vertex(c.x + (cx3 - c.x) * 0.06, c.y + (cy3 - c.y) * 0.06);
            }
            endShape(CLOSE);
            drawingContext.shadowBlur = 0;
            
            // Vẽ các góc nối màu trắng nổi bật
            for (let i = 0; i < 4; i++) {
                let c = smoothCorners[i];
                let next = smoothCorners[(i + 1) % 4];
                let prev = smoothCorners[(i + 3) % 4];
                let bLen = 25 + cornerPulse * 8;
                
                let dx1 = next.x - c.x, dy1 = next.y - c.y;
                let len1 = Math.hypot(dx1, dy1) || 1;
                dx1 /= len1; dy1 /= len1;
                
                let dx2 = prev.x - c.x, dy2 = prev.y - c.y;
                let len2 = Math.hypot(dx2, dy2) || 1;
                dx2 /= len2; dy2 /= len2;
                
                stroke(255, 255, 255, a * 0.9);
                strokeWeight(2.5);
                line(c.x, c.y, c.x + dx1 * bLen, c.y + dy1 * bLen);
                line(c.x, c.y, c.x + dx2 * bLen, c.y + dy2 * bLen);
                
                noStroke();
                drawingContext.shadowBlur = 12 + cornerPulse * 10;
                drawingContext.shadowColor = '#ff69b4';
                fill(255, 105, 180, 200 + cornerPulse * 55);
                ellipse(c.x, c.y, 7 + cornerPulse * 4);
                drawingContext.shadowBlur = 0;
            }
            
            // Nhãn tọa độ 4 góc (TL, TR, BR, BL)
            let labels = ['TL', 'TR', 'BR', 'BL'];
            let offsets = [[-12, -22], [12, -22], [12, 22], [-12, 22]];
            for (let i = 0; i < 4; i++) {
                let c = smoothCorners[i];
                push();
                translate(c.x + offsets[i][0], c.y + offsets[i][1]);
                scale(-1, 1);
                drawingContext.globalAlpha = 0.45;
                let lbl = `${labels[i]}(${Math.round(c.x)},${Math.round(c.y)})`;
                noStroke(); 
                fill(255, 255, 255); 
                textSize(9); 
                text(lbl, 0, 0);
                drawingContext.globalAlpha = 1;
                pop();
            }
        }
    }
    
    // --- Cập nhật & Vẽ các hệ thống hạt ---
    noStroke();
    for (let i = sparks.length - 1; i >= 0; i--) {
        let s = sparks[i];
        s.x += s.vx; 
        s.y += s.vy; 
        s.vy += 0.15; 
        s.life--;
        let t = s.life / s.maxLife;
        drawingContext.globalAlpha = t;
        fill(s.col);
        ellipse(s.x, s.y, s.size * t);
        if (s.life <= 0) sparks.splice(i, 1);
    }
    drawingContext.globalAlpha = 1;
    
    textAlign(CENTER, CENTER);
    for (let i = hearts.length - 1; i >= 0; i--) {
        let h = hearts[i];
        h.x += h.vx; 
        h.y += h.vy; 
        h.life--;
        let t = h.life / h.maxLife;
        drawingContext.globalAlpha = t * 0.7;
        textSize(h.size);
        text('💕', h.x, h.y);
        if (h.life <= 0) hearts.splice(i, 1);
    }
    drawingContext.globalAlpha = 1;
    
    noStroke();
    fill(255, 220, 240);
    for (let i = glitters.length - 1; i >= 0; i--) {
        let g = glitters[i];
        g.life--;
        let t = g.life / g.maxLife;
        let twinkle = sin(frameCount * g.twinkle * 10 + i * 3);
        let alpha = t * (0.5 + twinkle * 0.5);
        if (alpha > 0.05) {
            drawingContext.globalAlpha = alpha;
            let sz = g.size * (0.8 + twinkle * 0.4);
            rectMode(CENTER);
            rect(g.x, g.y, sz * 2.5, sz * 0.5, 1);
            rect(g.x, g.y, sz * 0.5, sz * 2.5, 1);
        }
        if (g.life <= 0) glitters.splice(i, 1);
    }
    drawingContext.globalAlpha = 1;
}

// ======================================================================
// SHARE LOGIC & HELPER FUNCTIONS 📤
// ======================================================================

// Mã hóa URL-safe Base64
function encodeSafeBase64(str) {
    return btoa(str)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// Giải mã URL-safe Base64
function decodeSafeBase64(base64) {
    let str = base64.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) {
        str += '=';
    }
    return atob(str);
}

// Khởi tạo Modal chia sẻ và tải ảnh
function initShareModal() {
    const shareBtn = document.getElementById('share-btn');
    const shareModal = document.getElementById('share-modal');
    const closeBtn = document.getElementById('modal-close-btn');
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const uploadStatus = document.getElementById('upload-status');
    const uploadInstruction = document.getElementById('upload-instruction');
    const resultBox = document.getElementById('result-box');
    const shareUrlText = document.getElementById('share-url');
    const copyBtn = document.getElementById('copy-btn');
    
    if (!shareBtn || !shareModal) return;
    
    // Mở modal
    shareBtn.addEventListener('click', () => {
        shareModal.classList.add('active');
        resultBox.style.display = 'none';
        uploadInstruction.style.display = 'block';
        uploadStatus.style.display = 'none';
    });
    
    // Đóng modal
    closeBtn.addEventListener('click', () => {
        shareModal.classList.remove('active');
    });
    
    // Đóng khi click ra vùng ngoài
    shareModal.addEventListener('click', (e) => {
        if (e.target === shareModal) {
            shareModal.classList.remove('active');
        }
    });
    
    // Kích hoạt chọn file
    uploadArea.addEventListener('click', () => {
        fileInput.click();
    });
    
    // Xử lý upload ảnh (Hỗ trợ upload nhiều ảnh cùng lúc qua ImgBB)
    fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        
        uploadInstruction.style.display = 'none';
        uploadStatus.style.display = 'block';
        uploadStatus.textContent = `Đang nén và chuẩn bị tải lên ${files.length} ảnh...`;
        
        try {
            let uploadedCount = 0;
            const uploadPromises = files.map(async (file) => {
                const formData = new FormData();
                formData.append('image', file);
                
                // Tải lên ImgBB API - Tốc độ cao, không bị chặn và có API Key riêng
                const response = await fetch(`https://api.imgbb.com/1/upload?key=${CONFIG.imgbbKey}`, {
                    method: 'POST',
                    body: formData
                });
                
                if (!response.ok) throw new Error("Không thể kết nối đến máy chủ ImgBB.");
                
                const resData = await response.json();
                if (!resData.success || !resData.data || !resData.data.url) {
                    throw new Error("Phản hồi tải ảnh thất bại từ ImgBB.");
                }
                
                uploadedCount++;
                uploadStatus.textContent = `Đang tải lên ảnh (${uploadedCount}/${files.length})...`;
                
                // Trả về đường dẫn trực tiếp ảnh gốc của ImgBB
                return resData.data.url;
            });
            
            // Chờ tất cả ảnh upload xong
            const urls = await Promise.all(uploadPromises);
            console.log("Upload thành công tất cả ảnh lên ImgBB:", urls);
            
            // Ghép nối danh sách ảnh bằng dấu phẩy
            const combinedUrls = urls.join(',');
            
            // Tạo mã ngắn gọn an toàn từ chuỗi các URL ảnh
            const code = encodeSafeBase64(combinedUrls);
            
            // Tạo đường dẫn hoàn chỉnh chứa code
            const baseDomain = window.location.origin + window.location.pathname;
            const finalShareUrl = `${baseDomain}?code=${code}`;
            
            shareUrlText.textContent = finalShareUrl;
            resultBox.style.display = 'block';
            uploadStatus.textContent = `Đã tạo thành công link chia sẻ chứa ${urls.length} ảnh! 💕`;
        } catch (err) {
            console.error("Lỗi khi tạo link:", err);
            uploadStatus.textContent = "Tải ảnh lên thất bại. Vui lòng thử lại!";
            uploadInstruction.style.display = 'block';
        }
    });
    
    // Sao chép liên kết vào clipboard
    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(shareUrlText.textContent)
            .then(() => {
                copyBtn.textContent = "Đã chép!";
                copyBtn.style.background = "#00ff88";
                setTimeout(() => {
                    copyBtn.textContent = "Sao chép";
                    copyBtn.style.background = "#ff69b4";
                }, 2000);
            })
            .catch(err => {
                console.error("Lỗi sao chép link:", err);
            });
    });
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}

// Khởi tạo bảng điều khiển căn chỉnh ảnh
function initAdjustPanel() {
    const adjustBtn = document.getElementById('adjust-btn');
    const adjustPanel = document.getElementById('adjust-panel');
    const closeBtn = document.getElementById('panel-close-btn');
    
    const fitCoverBtn = document.getElementById('fit-cover-btn');
    const fitContainBtn = document.getElementById('fit-contain-btn');
    
    const zoomSlider = document.getElementById('zoom-slider');
    const zoomVal = document.getElementById('zoom-val');
    
    const panXSlider = document.getElementById('pan-x-slider');
    const panXVal = document.getElementById('pan-x-val');
    
    const panYSlider = document.getElementById('pan-y-slider');
    const panYVal = document.getElementById('pan-y-val');
    
    const smoothSlider = document.getElementById('smooth-slider');
    const smoothVal = document.getElementById('smooth-val');
    
    if (!adjustBtn || !adjustPanel) return;
    
    // Mở / Đóng Panel
    adjustBtn.addEventListener('click', () => {
        adjustPanel.classList.toggle('active');
    });
    
    closeBtn.addEventListener('click', () => {
        adjustPanel.classList.remove('active');
    });
    
    // Click ngoài đóng panel (nếu chạm vùng khác ngoài panel và nút)
    document.addEventListener('click', (e) => {
        if (!adjustPanel.contains(e.target) && e.target !== adjustBtn) {
            adjustPanel.classList.remove('active');
        }
    });
    
    // Điều khiển Chế độ hiển thị (Fit Mode)
    fitCoverBtn.addEventListener('click', () => {
        CONFIG.fitMode = 'cover';
        fitCoverBtn.classList.add('active');
        fitContainBtn.classList.remove('active');
    });
    
    fitContainBtn.addEventListener('click', () => {
        CONFIG.fitMode = 'contain';
        fitContainBtn.classList.add('active');
        fitCoverBtn.classList.remove('active');
    });
    
    // Điều khiển Zoom
    zoomSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        CONFIG.imageZoom = val;
        zoomVal.textContent = `${Math.round(val * 100)}%`;
    });
    
    // Điều khiển Pan X
    panXSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        CONFIG.imageOffsetX = val;
        const sign = val > 0 ? '+' : '';
        panXVal.textContent = `${sign}${Math.round(val * 100)}%`;
    });
    
    // Điều khiển Pan Y
    panYSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        CONFIG.imageOffsetY = val;
        const sign = val > 0 ? '+' : '';
        panYVal.textContent = `${sign}${Math.round(val * 100)}%`;
    });
    
    // Điều khiển Smooth Factor
    smoothSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        CONFIG.smoothFactor = val;
        
        if (val >= 1.0) {
            smoothVal.textContent = "Tức thì";
        } else if (val <= 0.15) {
            smoothVal.textContent = "Cực mượt (Trễ)";
        } else {
            smoothVal.textContent = `${Math.round(val * 100)}%`;
        }
    });
}