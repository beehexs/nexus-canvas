import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Canvas,
  Rect,
  Circle,
  IText,
  FabricImage,
  PencilBrush,
  util,
} from 'fabric';
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
} from 'lucide-react';

const PRESET_COLORS = [
  '#f8fafc', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899',
];

const SOCKET_URL = `http://${window.location.hostname}:3001`;

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

  const [userName] = useState(() => `User_${Math.floor(Math.random() * 1000)}`);
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

  // ── Setup Fabric + Socket once on mount ──
  useEffect(() => {
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
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[socket] connected:', socket.id);
      setIsConnected(true);
      socket.emit('join', { name: userName, color: userColor });
    });

    socket.on('disconnect', () => {
      console.log('[socket] disconnected');
      setIsConnected(false);
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
        .finally(() => {
          isRemoteRef.current = false;
        });
    });

    // ── Remote object modified ──
    socket.on('object-modified', (objData) => {
      const existing = canvas.getObjects().find((o) => o.id === objData.id);
      if (existing) {
        isRemoteRef.current = true;
        existing.set(objData);
        existing.setCoords();
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

    // ── Cleanup ──
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      canvas.dispose();
      socket.disconnect();
      if (canvasEl.parentNode) canvasEl.parentNode.removeChild(canvasEl);
    };
  }, []); // runs exactly once

  // ── Tool handlers (stable via ref) ──
  const addRect = () => {
    const c = fabricCanvasRef.current;
    if (!c) return;
    setActiveTool('rect');
    c.isDrawingMode = false;
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
    c.isDrawingMode = false;
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
    c.isDrawingMode = false;
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
    // Ensure brush exists and is configured
    if (!c.freeDrawingBrush) {
      c.freeDrawingBrush = new PencilBrush(c);
    }
    c.freeDrawingBrush.color = selectedColor;
    c.freeDrawingBrush.width = 3;
    c.isDrawingMode = true;
  };

  const disableDrawing = () => {
    const c = fabricCanvasRef.current;
    if (!c) return;
    setActiveTool('select');
    c.isDrawingMode = false;
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
    activeObjs.forEach((obj) => {
      // Text objects use fill, shapes/paths use stroke
      if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') {
        obj.set('fill', color);
      } else {
        obj.set('stroke', color);
      }
      obj.setCoords();
      if (obj.id && s) {
        s.emit('object-modified', obj.toObject(['id']));
      }
    });
    if (activeObjs.length) c.renderAll();
  };

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
        <button className={`tool-btn ${activeTool === 'pen' ? 'active' : ''}`} onClick={enableDrawing} title="Pen">
          <PenTool size={20} />
        </button>
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
