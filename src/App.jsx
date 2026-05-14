import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Canvas,
  Rect,
  Circle,
  Line,
  Polygon,
  Group,
  IText,
  FabricImage,
  PencilBrush,
  Path,
  classRegistry,
  util,
} from 'fabric';

// Fabric v7: explicitly register classes so enlivenObjects can resolve them
classRegistry.setClass(Rect, 'Rect');
classRegistry.setClass(Circle, 'Circle');
classRegistry.setClass(Line, 'Line');
classRegistry.setClass(Polygon, 'Polygon');
classRegistry.setClass(Group, 'Group');
classRegistry.setClass(IText, 'IText');
classRegistry.setClass(FabricImage, 'Image');
classRegistry.setClass(Path, 'Path');
import { io } from 'socket.io-client';
import {
  MousePointer2,
  PenTool,
  Square,
  Circle as CircleIcon,
  Type,
  Image as ImageIcon,
  Trash2,
  Wifi,
  WifiOff,
  Palette,
  Minus,
  MoveRight,
  LogIn,
  Download,
  Hand,
} from 'lucide-react';

const PRESET_COLORS = [
  '#f8fafc', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899',
];

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || `http://${window.location.hostname}:3001`;

function App() {
  // Use a div container so Fabric.js can manage its own canvas element
  // without React interfering during re-renders
  const containerRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const socketRef = useRef(null);
  const isRemoteRef = useRef(false);

  // These refs hold volatile collaborative state to avoid re-renders
  const remoteCursorsRef = useRef({});
  const onlineUsersRef = useRef([]);
  const cursorLayerRef = useRef(null);
  const userListRef = useRef(null);

  const [activeTool, setActiveTool] = useState('select');
  const [isConnected, setIsConnected] = useState(false);
  const [selectedColor, setSelectedColor] = useState('#f8fafc');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [lineStyle, setLineStyle] = useState('solid');
  const [showLineStyles, setShowLineStyles] = useState(false);
  const [strokeSize, setStrokeSize] = useState(3);
  const [showStrokeSize, setShowStrokeSize] = useState(false);

  // Join screen state
  const [userName, setUserName] = useState('');
  const [hasJoined, setHasJoined] = useState(false);

  // Refs for line drawing (avoid stale closure issues)
  const lineDrawingRef = useRef({ isDrawing: false, startX: 0, startY: 0, tempLine: null });
  const lineStyleRef = useRef('solid');
  const selectedColorRef = useRef('#f8fafc');
  const strokeSizeRef = useRef(3);

  // Keep refs in sync with state
  useEffect(() => { lineStyleRef.current = lineStyle; }, [lineStyle]);
  useEffect(() => { selectedColorRef.current = selectedColor; }, [selectedColor]);
  useEffect(() => { strokeSizeRef.current = strokeSize; }, [strokeSize]);

  const [userColor] = useState(
    () => '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')
  );

  // ── Render cursors into a DOM layer (no React re-render needed) ──
  const renderCursors = useCallback(() => {
    const layer = cursorLayerRef.current;
    if (!layer) return;
    const cursors = remoteCursorsRef.current;
    layer.innerHTML = '';
    Object.values(cursors).forEach((c) => {
      const el = document.createElement('div');
      el.className = 'user-cursor';
      el.style.left = c.x + 'px';
      el.style.top = c.y + 'px';
      el.innerHTML = `
        <div class="cursor-dot" style="background:${c.color}"></div>
        <div class="cursor-name" style="border-color:${c.color}">${c.name}</div>
      `;
      layer.appendChild(el);
    });
  }, []);

  const renderUsers = useCallback(() => {
    const container = userListRef.current;
    if (!container) return;
    const users = onlineUsersRef.current;
    const socketId = socketRef.current?.id;
    // Keep the "You" badge, clear the rest
    const youBadge = container.querySelector('.you-badge');
    container.innerHTML = '';
    if (youBadge) container.appendChild(youBadge);

    users
      .filter((u) => u.id !== socketId)
      .forEach((u) => {
        const badge = document.createElement('div');
        badge.className = 'user-badge';
        badge.innerHTML = `
          <div class="status-dot" style="background:${u.color}"></div>
          <span>${u.name}</span>
        `;
        container.appendChild(badge);
      });
  }, []);

  // ── Setup Fabric + Socket after user joins ──
  useEffect(() => {
    if (!hasJoined) return;
    const container = containerRef.current;
    if (!container) return;

    // Create a fresh canvas element inside the container
    const canvasEl = document.createElement('canvas');
    canvasEl.id = 'fabric-canvas';
    container.appendChild(canvasEl);

    const canvas = new Canvas(canvasEl, {
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: 'transparent',
      allowTouchScrolling: true,
    });
    fabricCanvasRef.current = canvas;

    // Set up the free-drawing brush (Fabric v7 requires explicit creation)
    canvas.freeDrawingBrush = new PencilBrush(canvas);
    canvas.freeDrawingBrush.color = '#f8fafc';
    canvas.freeDrawingBrush.width = 3;

    // ── Socket ──
    const socket = io(SOCKET_URL, {
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[socket] connected:', socket.id);
      setIsConnected(true);
      // Always re-join on connect (handles initial + reconnections)
      socket.emit('join', { name: userName, color: userColor });
    });

    socket.on('disconnect', (reason) => {
      console.log('[socket] disconnected, reason:', reason);
      setIsConnected(false);
    });

    socket.on('reconnect_attempt', (attempt) => {
      console.log('[socket] reconnection attempt:', attempt);
    });

    socket.on('connect_error', (err) => {
      console.warn('[socket] connection error:', err.message);
    });

    // ── Receive initial canvas state ──
    socket.on('init-canvas', (data) => {
      console.log('[socket] init-canvas:', data.length, 'objects');
      if (!data || data.length === 0) return;
      isRemoteRef.current = true;
      util
        .enlivenObjects(data)
        .then((objects) => {
          objects.forEach((o) => {
            const exists = canvas.getObjects().some((ex) => ex.id === o.id);
            if (!exists) canvas.add(o);
          });
          canvas.renderAll();
        })
        .catch((err) => console.error('[fabric] enliven error:', err))
        .finally(() => {
          isRemoteRef.current = false;
        });
    });

    // ── Remote object added ──
    socket.on('object-added', (obj) => {
      isRemoteRef.current = true;
      util
        .enlivenObjects([obj])
        .then((objects) => {
          objects.forEach((o) => {
            const exists = canvas.getObjects().some((ex) => ex.id === o.id);
            if (!exists) {
              canvas.add(o);
              canvas.renderAll();
            }
          });
        })
        .catch((err) => console.error('[fabric] object-added enliven error:', err))
        .finally(() => {
          isRemoteRef.current = false;
        });
    });

    // ── Remote object modified ──
    socket.on('object-modified', (objData) => {
      const existing = canvas.getObjects().find((o) => o.id === objData.id);
      if (existing) {
        isRemoteRef.current = true;
        // For IText objects, explicitly update the text content
        // because Fabric v7's generic .set() doesn't reliably update it
        if (objData.text !== undefined && typeof existing.set === 'function') {
          existing.set('text', objData.text);
        }
        existing.set(objData);
        existing.setCoords();
        // Force text re-render by triggering internal dimension recalc
        if (existing.initDimensions) existing.initDimensions();
        canvas.renderAll();
        isRemoteRef.current = false;
      }
    });

    // ── Remote object removed ──
    socket.on('object-removed', (objId) => {
      const existing = canvas.getObjects().find((o) => o.id === objId);
      if (existing) {
        isRemoteRef.current = true;
        canvas.remove(existing);
        canvas.renderAll();
        isRemoteRef.current = false;
      }
    });

    // ── Remote cursors (direct DOM, no re-render) ──
    socket.on('mouse-move', (data) => {
      remoteCursorsRef.current[data.id] = data;
      renderCursors();
    });

    socket.on('update-users', (users) => {
      onlineUsersRef.current = users;
      renderUsers();
    });

    socket.on('user-left', (id) => {
      delete remoteCursorsRef.current[id];
      renderCursors();
    });

    // ── Local canvas events -> broadcast ──
    canvas.on('object:added', (e) => {
      if (isRemoteRef.current) return;
      const obj = e.target;
      if (obj && !obj.id) {
        obj.id = `${socket.id}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      }
      if (obj?.id) {
        socket.emit('object-added', obj.toObject(['id']));
      }
    });

    canvas.on('object:modified', (e) => {
      if (isRemoteRef.current) return;
      const obj = e.target;
      if (obj?.id) {
        socket.emit('object-modified', obj.toObject(['id']));
      }
    });

    // ── Sync text content after editing ──
    canvas.on('text:editing:exited', (e) => {
      if (isRemoteRef.current) return;
      const obj = e.target;
      if (obj?.id) {
        socket.emit('object-modified', obj.toObject(['id']));
      }
    });

    // ── Live text sync while typing (debounced) ──
    let textChangeTimer = null;
    canvas.on('text:changed', (e) => {
      if (isRemoteRef.current) return;
      const obj = e.target;
      if (!obj?.id) return;
      clearTimeout(textChangeTimer);
      textChangeTimer = setTimeout(() => {
        socket.emit('object-modified', obj.toObject(['id']));
      }, 300);
    });

    // ── Mouse tracking ──
    const onMouseMove = (e) => {
      socket.emit('mouse-move', {
        x: e.clientX,
        y: e.clientY,
        name: userName,
        color: userColor,
      });
    };
    window.addEventListener('mousemove', onMouseMove);

    // ── Resize ──
    const onResize = () => {
      canvas.setDimensions({ width: window.innerWidth, height: window.innerHeight });
      canvas.renderAll();
    };
    window.addEventListener('resize', onResize);

    // ── Line tool: mouse handlers ──
    canvas.on('mouse:down', (opt) => {
      if (canvas._activeLineTool !== 'line') return;
      const pointer = canvas.getScenePoint(opt.e);
      const ld = lineDrawingRef.current;
      ld.isDrawing = true;
      ld.startX = pointer.x;
      ld.startY = pointer.y;

      const style = lineStyleRef.current;
      const dashArray = style === 'dash' ? [10, 6] : undefined;

      const tempLine = new Line([pointer.x, pointer.y, pointer.x, pointer.y], {
        stroke: selectedColorRef.current,
        strokeWidth: strokeSizeRef.current,
        strokeDashArray: dashArray,
        selectable: false,
        evented: false,
      });
      ld.tempLine = tempLine;
      canvas.add(tempLine);
    });

    canvas.on('mouse:move', (opt) => {
      const ld = lineDrawingRef.current;
      if (!ld.isDrawing || !ld.tempLine) return;
      const pointer = canvas.getScenePoint(opt.e);
      ld.tempLine.set({ x2: pointer.x, y2: pointer.y });
      canvas.renderAll();
    });

    canvas.on('mouse:up', () => {
      const ld = lineDrawingRef.current;
      if (!ld.isDrawing || !ld.tempLine) return;
      ld.isDrawing = false;

      const { x1, y1, x2, y2 } = ld.tempLine;
      // Remove temp line
      canvas.remove(ld.tempLine);

      // Ignore tiny accidental clicks
      if (Math.abs(x2 - x1) < 3 && Math.abs(y2 - y1) < 3) {
        ld.tempLine = null;
        return;
      }

      const style = lineStyleRef.current;
      const color = selectedColorRef.current;
      const sw = strokeSizeRef.current;
      const dashArray = style === 'dash' ? [sw * 3.5, sw * 2] : undefined;

      if (style === 'arrow') {
        // Create line + arrowhead as a group
        const line = new Line([x1, y1, x2, y2], {
          stroke: color,
          strokeWidth: sw,
          originX: 'center',
          originY: 'center',
        });

        // Arrowhead triangle
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const headLen = Math.max(14, sw * 5);
        const headAngle = Math.PI / 6;
        const points = [
          { x: x2, y: y2 },
          { x: x2 - headLen * Math.cos(angle - headAngle), y: y2 - headLen * Math.sin(angle - headAngle) },
          { x: x2 - headLen * Math.cos(angle + headAngle), y: y2 - headLen * Math.sin(angle + headAngle) },
        ];
        const arrow = new Polygon(points, {
          fill: color,
          stroke: color,
          strokeWidth: 1,
          originX: 'center',
          originY: 'center',
        });

        const group = new Group([line, arrow], {
          selectable: true,
          evented: true,
        });
        canvas.add(group);
        canvas.setActiveObject(group);
      } else {
        const finalLine = new Line([x1, y1, x2, y2], {
          stroke: color,
          strokeWidth: sw,
          strokeDashArray: dashArray,
          selectable: true,
          evented: true,
        });
        canvas.add(finalLine);
        canvas.setActiveObject(finalLine);
      }

      canvas.renderAll();
      ld.tempLine = null;
    });

    // ── Pan & Zoom (desktop: Space+drag / Ctrl+wheel, mobile: 2-finger) ──
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let spaceHeld = false;

    const onKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat && !spaceHeld) {
        spaceHeld = true;
        canvas.defaultCursor = 'grab';
        canvas.selection = false;
        e.preventDefault();
      }
    };
    const onKeyUp = (e) => {
      if (e.code === 'Space') {
        spaceHeld = false;
        isPanning = false;
        canvas.defaultCursor = 'default';
        // Only restore selection if not in a tool that disables it
        if (!canvas._activeLineTool && !canvas._activePanTool) {
          canvas.selection = true;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Desktop pan via Space+drag or Pan tool
    canvas.on('mouse:down', (opt) => {
      if (spaceHeld || canvas._activePanTool) {
        isPanning = true;
        panStartX = opt.e.clientX;
        panStartY = opt.e.clientY;
        canvas.defaultCursor = 'grabbing';
        opt.e.preventDefault();
        opt.e.stopPropagation();
      }
    });
    canvas.on('mouse:move', (opt) => {
      if (isPanning) {
        const vpt = canvas.viewportTransform;
        vpt[4] += opt.e.clientX - panStartX;
        vpt[5] += opt.e.clientY - panStartY;
        panStartX = opt.e.clientX;
        panStartY = opt.e.clientY;
        canvas.requestRenderAll();
        opt.e.preventDefault();
        opt.e.stopPropagation();
      }
    });
    canvas.on('mouse:up', () => {
      if (isPanning) {
        isPanning = false;
        canvas.defaultCursor = spaceHeld ? 'grab' : (canvas._activePanTool ? 'grab' : 'default');
        canvas.setViewportTransform(canvas.viewportTransform);
      }
    });

    // Desktop zoom via Ctrl+wheel (or pinch gesture on trackpad)
    canvas.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY;
      let zoom = canvas.getZoom();
      zoom *= 0.999 ** delta;
      zoom = Math.min(Math.max(zoom, 0.1), 10);
      canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    // ── Mobile touch: 2-finger pan & pinch-to-zoom ──
    let lastTouchDist = 0;
    let lastTouchCenter = null;
    let touchPanning = false;

    const getTouchInfo = (touches) => {
      const t1 = touches[0];
      const t2 = touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const cx = (t1.clientX + t2.clientX) / 2;
      const cy = (t1.clientY + t2.clientY) / 2;
      return { dist, cx, cy };
    };

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        touchPanning = true;
        const info = getTouchInfo(e.touches);
        lastTouchDist = info.dist;
        lastTouchCenter = { x: info.cx, y: info.cy };
        e.preventDefault();
      }
    };
    const onTouchMove = (e) => {
      if (e.touches.length === 2 && touchPanning) {
        const info = getTouchInfo(e.touches);

        // Pinch zoom
        if (lastTouchDist > 0) {
          let zoom = canvas.getZoom() * (info.dist / lastTouchDist);
          zoom = Math.min(Math.max(zoom, 0.1), 10);
          canvas.zoomToPoint({ x: info.cx, y: info.cy }, zoom);
        }

        // Two-finger pan
        if (lastTouchCenter) {
          const vpt = canvas.viewportTransform;
          vpt[4] += info.cx - lastTouchCenter.x;
          vpt[5] += info.cy - lastTouchCenter.y;
          canvas.requestRenderAll();
        }

        lastTouchDist = info.dist;
        lastTouchCenter = { x: info.cx, y: info.cy };
        e.preventDefault();
      }
    };
    const onTouchEnd = (e) => {
      if (e.touches.length < 2) {
        touchPanning = false;
        lastTouchDist = 0;
        lastTouchCenter = null;
        canvas.setViewportTransform(canvas.viewportTransform);
      }
    };

    const upperCanvas = canvasEl.parentNode?.querySelector('.upper-canvas') || canvasEl;
    upperCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
    upperCanvas.addEventListener('touchmove', onTouchMove, { passive: false });
    upperCanvas.addEventListener('touchend', onTouchEnd);

    // ── Cleanup ──
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      upperCanvas.removeEventListener('touchstart', onTouchStart);
      upperCanvas.removeEventListener('touchmove', onTouchMove);
      upperCanvas.removeEventListener('touchend', onTouchEnd);
      canvas.dispose();
      socket.disconnect();
      if (canvasEl.parentNode) canvasEl.parentNode.removeChild(canvasEl);
    };
  }, [hasJoined]); // runs when user joins

  // ── Tool handlers (stable via ref) ──

  // Shared cleanup to prevent state leakage between tools
  const resetToolState = (c) => {
    c.isDrawingMode = false;
    c.selection = true;
    c.skipTargetFind = false;
    c._activeLineTool = null;
    c._activePanTool = false;
    c.defaultCursor = 'default';
  };

  const enablePan = () => {
    const c = fabricCanvasRef.current;
    if (!c) return;
    setActiveTool('pan');
    resetToolState(c);
    c._activePanTool = true;
    c.selection = false;
    c.skipTargetFind = true;
    c.discardActiveObject();
    c.defaultCursor = 'grab';
  };

  const addRect = () => {
    const c = fabricCanvasRef.current;
    if (!c) return;
    setActiveTool('rect');
    resetToolState(c);
    const rect = new Rect({
      left: 100 + Math.random() * 300,
      top: 100 + Math.random() * 300,
      fill: 'transparent',
      stroke: selectedColor,
      strokeWidth: 2,
      width: 120,
      height: 80,
    });
    c.add(rect);
    c.setActiveObject(rect);
  };

  const addCircle = () => {
    const c = fabricCanvasRef.current;
    if (!c) return;
    setActiveTool('circle');
    resetToolState(c);
    const circle = new Circle({
      left: 150 + Math.random() * 300,
      top: 150 + Math.random() * 300,
      radius: 50,
      fill: 'transparent',
      stroke: selectedColor,
      strokeWidth: 2,
    });
    c.add(circle);
    c.setActiveObject(circle);
  };

  const addText = () => {
    const c = fabricCanvasRef.current;
    if (!c) return;
    setActiveTool('text');
    resetToolState(c);
    const text = new IText('Double click to edit', {
      left: 200 + Math.random() * 200,
      top: 200 + Math.random() * 100,
      fontFamily: 'Inter, sans-serif',
      fontSize: 20,
      fill: selectedColor,
    });
    c.add(text);
    c.setActiveObject(text);
  };

  const enableDrawing = () => {
    const c = fabricCanvasRef.current;
    if (!c) return;
    setActiveTool('pen');
    resetToolState(c);
    // Ensure brush exists and is configured
    if (!c.freeDrawingBrush) {
      c.freeDrawingBrush = new PencilBrush(c);
    }
    c.freeDrawingBrush.color = selectedColor;
    c.freeDrawingBrush.width = strokeSize;
    c.isDrawingMode = true;
  };

  const enableLine = (style) => {
    const c = fabricCanvasRef.current;
    if (!c) return;
    setActiveTool('line');
    resetToolState(c);
    setLineStyle(style || lineStyle);
    c.isDrawingMode = false;
    c.selection = false;
    c.skipTargetFind = true;
    c.discardActiveObject();
    c._activeLineTool = 'line';
  };

  const disableDrawing = () => {
    const c = fabricCanvasRef.current;
    if (!c) return;
    setActiveTool('select');
    resetToolState(c);
    setShowStrokeSize(false);
    setShowLineStyles(false);
  };

  const deleteSelected = () => {
    const c = fabricCanvasRef.current;
    const s = socketRef.current;
    if (!c || !s) return;
    const active = c.getActiveObjects();
    if (active.length) {
      c.discardActiveObject();
      isRemoteRef.current = true;
      active.forEach((obj) => {
        if (obj.id) s.emit('object-removed', obj.id);
        c.remove(obj);
      });
      isRemoteRef.current = false;
    }
  };

  const handleImageUpload = (e) => {
    const c = fabricCanvasRef.current;
    if (!c) return;
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (f) => {
      FabricImage.fromURL(f.target.result).then((img) => {
        img.scale(0.5);
        c.add(img);
        c.renderAll();
      });
    };
    reader.readAsDataURL(file);
  };

  // Apply color to any currently selected objects
  const applyColorToSelection = (color) => {
    const c = fabricCanvasRef.current;
    const s = socketRef.current;
    if (!c) return;
    const activeObjs = c.getActiveObjects();

    const applyToObject = (obj) => {
      if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') {
        obj.set('fill', color);
      } else if (obj.type === 'group' && obj._objects) {
        // Arrow groups: update stroke/fill on all children
        obj._objects.forEach((child) => {
          child.set('stroke', color);
          if (child.type === 'polygon') {
            child.set('fill', color);
          }
        });
        obj.set('stroke', color);
      } else {
        obj.set('stroke', color);
      }
    };

    activeObjs.forEach((obj) => {
      applyToObject(obj);
      obj.setCoords();
      if (obj.id && s) {
        s.emit('object-modified', obj.toObject(['id']));
      }
    });
    if (activeObjs.length) c.renderAll();
  };

  // ── Join screen handler ──
  const handleJoin = () => {
    const trimmed = userName.trim();
    if (!trimmed) return;
    setUserName(trimmed);
    setHasJoined(true);
  };

  // ── Join Screen ──
  if (!hasJoined) {
    return (
      <div className="join-screen">
        <div className="join-card">
          <div className="join-logo">✦</div>
          <h1 className="join-title">Nexus Canvas</h1>
          <p className="join-subtitle">Real-time collaborative whiteboard</p>
          <div className="join-form">
            <input
              type="text"
              className="join-input"
              placeholder="Enter your name..."
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              maxLength={20}
              autoFocus
            />
            <button
              className="join-btn"
              onClick={handleJoin}
              disabled={!userName.trim()}
            >
              <LogIn size={18} />
              Join Board
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Toolbar */}
      <div className="toolbar">
        <div style={{ display: 'flex', alignItems: 'center', marginRight: 8 }}>
          {isConnected ? <Wifi size={18} color="#22c55e" /> : <WifiOff size={18} color="#ef4444" />}
        </div>
        <button className={`tool-btn ${activeTool === 'select' ? 'active' : ''}`} onClick={disableDrawing} title="Select">
          <MousePointer2 size={20} />
        </button>
        <button className={`tool-btn ${activeTool === 'pan' ? 'active' : ''}`} onClick={enablePan} title="Pan (or hold Space)">
          <Hand size={20} />
        </button>
        <button className={`tool-btn ${activeTool === 'pen' ? 'active' : ''}`} onClick={enableDrawing} title="Pen">
          <PenTool size={20} />
        </button>
        {/* Line Tool with Style Selector */}
        <div className="color-picker-wrapper">
          <button
            className={`tool-btn ${activeTool === 'line' ? 'active' : ''}`}
            onClick={() => {
              if (activeTool === 'line') {
                setShowLineStyles(!showLineStyles);
              } else {
                enableLine(lineStyle);
                setShowLineStyles(false);
              }
            }}
            title="Line"
          >
            <Minus size={20} />
          </button>
          {activeTool === 'line' && (
            <button
              className="line-style-toggle"
              onClick={() => setShowLineStyles(!showLineStyles)}
              title="Line Style"
            >
              ▾
            </button>
          )}
          {showLineStyles && (
            <div className="color-picker-dropdown line-style-dropdown">
              <button
                className={`line-style-option ${lineStyle === 'solid' ? 'active' : ''}`}
                onClick={() => { setLineStyle('solid'); lineStyleRef.current = 'solid'; setShowLineStyles(false); enableLine('solid'); }}
              >
                <svg width="40" height="2"><line x1="0" y1="1" x2="40" y2="1" stroke="currentColor" strokeWidth="2" /></svg>
                <span>Solid</span>
              </button>
              <button
                className={`line-style-option ${lineStyle === 'dash' ? 'active' : ''}`}
                onClick={() => { setLineStyle('dash'); lineStyleRef.current = 'dash'; setShowLineStyles(false); enableLine('dash'); }}
              >
                <svg width="40" height="2"><line x1="0" y1="1" x2="40" y2="1" stroke="currentColor" strokeWidth="2" strokeDasharray="6 4" /></svg>
                <span>Dashed</span>
              </button>
              <button
                className={`line-style-option ${lineStyle === 'arrow' ? 'active' : ''}`}
                onClick={() => { setLineStyle('arrow'); lineStyleRef.current = 'arrow'; setShowLineStyles(false); enableLine('arrow'); }}
              >
                <MoveRight size={20} />
                <span>Arrow</span>
              </button>
            </div>
          )}
        </div>
        {/* Stroke Size Control */}
        {(activeTool === 'pen' || activeTool === 'line') && (
          <div className="color-picker-wrapper">
            <button
              className="tool-btn stroke-trigger"
              onClick={() => setShowStrokeSize(!showStrokeSize)}
              title="Stroke Size"
            >
              <svg width="20" height="20" viewBox="0 0 20 20">
                <line x1="3" y1="17" x2="17" y2="3" stroke="currentColor" strokeWidth={strokeSize > 10 ? 4 : strokeSize > 5 ? 3 : 2} strokeLinecap="round" />
              </svg>
              <div className="stroke-indicator">{strokeSize}px</div>
            </button>
            {showStrokeSize && (
              <div className="color-picker-dropdown stroke-size-dropdown">
                <div className="stroke-size-label">Stroke Width</div>
                <div className="stroke-size-slider-row">
                  <input
                    type="range"
                    min="1"
                    max="20"
                    value={strokeSize}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setStrokeSize(v);
                      const c = fabricCanvasRef.current;
                      if (c?.freeDrawingBrush) c.freeDrawingBrush.width = v;
                    }}
                    className="stroke-slider"
                  />
                  <span className="stroke-size-value">{strokeSize}px</span>
                </div>
                <div className="stroke-preview">
                  <svg width="100%" height="24" viewBox="0 0 160 24">
                    <line x1="10" y1="12" x2="150" y2="12" stroke="#f8fafc" strokeWidth={strokeSize} strokeLinecap="round" />
                  </svg>
                </div>
                <div className="stroke-presets">
                  {[1, 2, 3, 5, 8, 12].map((s) => (
                    <button
                      key={s}
                      className={`stroke-preset-btn ${strokeSize === s ? 'active' : ''}`}
                      onClick={() => {
                        setStrokeSize(s);
                        const c = fabricCanvasRef.current;
                        if (c?.freeDrawingBrush) c.freeDrawingBrush.width = s;
                      }}
                    >
                      <svg width="28" height="16">
                        <line x1="4" y1="8" x2="24" y2="8" stroke="currentColor" strokeWidth={s} strokeLinecap="round" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <button className="tool-btn" onClick={addRect} title="Rectangle">
          <Square size={20} />
        </button>
        <button className="tool-btn" onClick={addCircle} title="Circle">
          <CircleIcon size={20} />
        </button>
        <button className="tool-btn" onClick={addText} title="Text">
          <Type size={20} />
        </button>
        <label className="tool-btn" title="Image">
          <ImageIcon size={20} />
          <input type="file" hidden onChange={handleImageUpload} accept="image/*" />
        </label>
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
        {/* Color Picker */}
        <div className="color-picker-wrapper">
          <button
            className="tool-btn color-trigger"
            onClick={() => setShowColorPicker(!showColorPicker)}
            title="Color"
          >
            <Palette size={20} />
            <div className="color-indicator" style={{ background: selectedColor }} />
          </button>
          {showColorPicker && (
            <div className="color-picker-dropdown">
              <div className="color-swatches">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`color-swatch ${selectedColor === color ? 'active' : ''}`}
                    style={{ background: color }}
                    onClick={() => {
                      setSelectedColor(color);
                      // Update brush color live if pen is active
                      const c = fabricCanvasRef.current;
                      if (c?.freeDrawingBrush) c.freeDrawingBrush.color = color;
                      // Apply to selected objects
                      applyColorToSelection(color);
                    }}
                  />
                ))}
              </div>
              <div className="color-custom">
                <label className="color-custom-label">
                  Custom
                  <input
                    type="color"
                    value={selectedColor}
                    onChange={(e) => {
                      setSelectedColor(e.target.value);
                      const c = fabricCanvasRef.current;
                      if (c?.freeDrawingBrush) c.freeDrawingBrush.color = e.target.value;
                      // Apply to selected objects
                      applyColorToSelection(e.target.value);
                    }}
                    className="color-input-native"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
        <button className="tool-btn" onClick={deleteSelected} title="Delete">
          <Trash2 size={20} color="#ef4444" />
        </button>
        <button
          className="tool-btn"
          onClick={() => {
            const c = fabricCanvasRef.current;
            if (!c) return;
            // Save original background and set white for JPG
            const origBg = c.backgroundColor;
            c.backgroundColor = '#ffffff';
            c.renderAll();
            const dataURL = c.toDataURL({ format: 'jpeg', quality: 0.92, multiplier: 2 });
            // Restore original background
            c.backgroundColor = origBg;
            c.renderAll();
            // Trigger download
            const link = document.createElement('a');
            link.download = `nexus-canvas-${Date.now()}.jpg`;
            link.href = dataURL;
            link.click();
          }}
          title="Export as JPG"
        >
          <Download size={20} />
        </button>
      </div>

      {/* User Presence (managed via direct DOM for zero re-renders) */}
      <div className="user-presence" ref={userListRef}>
        <div className="user-badge you-badge" style={{ borderColor: userColor }}>
          <div className="status-dot" style={{ background: userColor }} />
          <span>{userName} (You)</span>
        </div>
      </div>

      {/* Remote Cursors Layer (managed via direct DOM) */}
      <div ref={cursorLayerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50 }} />

      {/* Fabric.js canvas container — React never touches inside here */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
    </div>
  );
}

export default App;
