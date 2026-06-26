'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

export interface MapDriver {
  id: string;
  latitude: number;
  longitude: number;
  bearing: number;
  speed: number;
}

export interface MapH3Hex {
  index: string;
  intensity: number; // 0 to 1
  color: string;
}

interface MapInterpolatedProps {
  drivers: MapDriver[];
  h3Hexagons?: MapH3Hex[];
  pickup?: { lat: number; lng: number } | null;
  destination?: { lat: number; lng: number } | null;
  center?: { lat: number; lng: number };
  zoom?: number;
}

interface InterpolatedState {
  id: string;
  currentLat: number;
  currentLng: number;
  startLat: number;
  startLng: number;
  targetLat: number;
  targetLng: number;
  startTime: number;
  bearing: number;
}

export default function MapInterpolated({
  drivers,
  h3Hexagons = [],
  pickup = null,
  destination = null,
  center = { lat: 22.5726, lng: 88.3639 }, // Kolkata defaults
}: MapInterpolatedProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const driverStateRef = useRef<Record<string, InterpolatedState>>({});
  
  // Track center coordinates for panning
  const [mapCenter, setMapCenter] = useState(center);
  const [zoomLevel, setZoomLevel] = useState(15);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // When the OS asks for reduced motion, snap vehicle pins to their target
  // instead of gliding the 4s tween.
  const prefersReducedMotion = useReducedMotion();

  // Update center when prop changes
  useEffect(() => {
    setMapCenter(center);
  }, [center.lat, center.lng]);

  // Telemetry Interpolation Update Loop
  useEffect(() => {
    const now = Date.now();
    
    // Sync incoming drivers into interpolation states
    drivers.forEach((d) => {
      const existing = driverStateRef.current[d.id];
      if (!existing) {
        // New driver
        driverStateRef.current[d.id] = {
          id: d.id,
          currentLat: d.latitude,
          currentLng: d.longitude,
          startLat: d.latitude,
          startLng: d.longitude,
          targetLat: d.latitude,
          targetLng: d.longitude,
          startTime: now,
          bearing: d.bearing,
        };
      } else if (existing.targetLat !== d.latitude || existing.targetLng !== d.longitude) {
        // Target updated: set start position to where the vehicle currently is, and reset timer
        driverStateRef.current[d.id] = {
          id: d.id,
          currentLat: existing.currentLat,
          currentLng: existing.currentLng,
          startLat: existing.currentLat,
          startLng: existing.currentLng,
          targetLat: d.latitude,
          targetLng: d.longitude,
          startTime: now,
          bearing: d.bearing,
        };
      }
    });

    // Remove stale drivers
    const activeIds = new Set(drivers.map((d) => d.id));
    Object.keys(driverStateRef.current).forEach((id) => {
      if (!activeIds.has(id)) {
        delete driverStateRef.current[id];
      }
    });
  }, [drivers]);

  // Main Canvas Rendering Loop
  useEffect(() => {
    let animationId: number;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const now = Date.now();

      // Resolve design-system tokens once per render (canvas can't take var()).
      const css = getComputedStyle(document.documentElement);
      const v = (name: string) => css.getPropertyValue(name).trim();

      const bgColor = v('--background-primary');
      const gridColor = v('--border-opaque');
      const highwayColor = v('--background-tertiary');
      const routeColor = v('--accent-400');
      const pinOutlineColor = v('--border-opaque');
      const pinLabelColor = v('--content-primary');
      const vehicleColor = v('--content-primary');
      const vehicleOutlineColor = v('--background-primary');
      const vehicleTailColor = 'rgba(0, 0, 0, 0.03)';
      const h3FillColor = 'rgba(201, 64, 48, 0.08)';
      const h3StrokeColor = 'rgba(201, 64, 48, 0.22)';
      const h3LabelColor = v('--negative-400');

      // Clear with background color
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Coordinate converter helper
      const toScreen = (lat: number, lng: number) => {
        const scale = Math.pow(2, zoomLevel) * 0.1;
        const x = canvas.width / 2 + (lng - mapCenter.lng) * scale * 1.5;
        const y = canvas.height / 2 - (lat - mapCenter.lat) * scale;
        return { x, y };
      };

      // 1. Draw elegant minimalist roads grid
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1.5;
      const gridSize = 80;
      for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Draw stylized highways
      ctx.strokeStyle = highwayColor;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, canvas.height * 0.3);
      ctx.lineTo(canvas.width, canvas.height * 0.7);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(canvas.width * 0.2, 0);
      ctx.lineTo(canvas.width * 0.8, canvas.height);
      ctx.stroke();

      // 2. Draw H3 Hexagons Surge Heatmap Overlay
      h3Hexagons.forEach((hex) => {
        let hLat = mapCenter.lat;
        let hLng = mapCenter.lng;
        
        if (hex.index === '88283082b9fffff') {
          hLat = 22.5726;
          hLng = 88.3639;
        } else if (hex.index === '88283082b9fcdef') {
          hLat = 22.5760;
          hLng = 88.3580;
        }

        const screenCenter = toScreen(hLat, hLng);
        const radius = 60 * (zoomLevel / 15);

        ctx.fillStyle = h3FillColor;
        ctx.strokeStyle = h3StrokeColor;
        ctx.lineWidth = 1;

        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i;
          const x = screenCenter.x + radius * Math.cos(angle);
          const y = screenCenter.y + radius * Math.sin(angle);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = h3LabelColor;
        ctx.font = 'bold 9px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(`h3:${hex.index.substring(0, 7)}`, screenCenter.x, screenCenter.y + 3);
      });

      // 3. Draw Route Path if pickup & destination exist
      if (pickup && destination) {
        const pScreen = toScreen(pickup.lat, pickup.lng);
        const dScreen = toScreen(destination.lat, destination.lng);

        ctx.strokeStyle = routeColor;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pScreen.x, pScreen.y);
        ctx.bezierCurveTo(
          pScreen.x + (dScreen.x - pScreen.x) * 0.2,
          pScreen.y - 30,
          pScreen.x + (dScreen.x - pScreen.x) * 0.8,
          pScreen.y + 30,
          dScreen.x,
          dScreen.y
        );
        ctx.stroke();
      }

      // 4. Draw Pickup & Destination pins
      if (pickup) {
        const screen = toScreen(pickup.lat, pickup.lng);
        ctx.fillStyle = pinOutlineColor;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = v('--positive-400');
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = pinLabelColor;
        ctx.font = 'bold 9px system-ui';
        ctx.fillText('pickup', screen.x, screen.y - 12);
      }

      if (destination) {
        const screen = toScreen(destination.lat, destination.lng);
        ctx.fillStyle = pinOutlineColor;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = v('--negative-400');
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = pinLabelColor;
        ctx.font = 'bold 9px system-ui';
        ctx.fillText('drop', screen.x, screen.y - 12);
      }

      // 5. Update Interpolated Positions and Draw Active Drivers
      Object.values(driverStateRef.current).forEach((state) => {
        const elapsed = now - state.startTime;
        const duration = 4000;
        const progress = prefersReducedMotion ? 1 : Math.min(1.0, elapsed / duration);

        state.currentLat = state.startLat + (state.targetLat - state.startLat) * progress;
        state.currentLng = state.startLng + (state.targetLng - state.startLng) * progress;

        const screen = toScreen(state.currentLat, state.currentLng);

        // A. Draw vehicle path tail shadow
        ctx.fillStyle = vehicleTailColor;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 12, 0, Math.PI * 2);
        ctx.fill();

        // B. Draw vehicle body (triangle indicating direction/bearing)
        ctx.save();
        ctx.translate(screen.x, screen.y);
        ctx.rotate((state.bearing * Math.PI) / 180);

        ctx.fillStyle = vehicleColor;
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(-5, 6);
        ctx.lineTo(5, 6);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = vehicleOutlineColor;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();

        // C. Tag label for driver ID
        ctx.fillStyle = pinLabelColor;
        ctx.font = 'bold 8px monospace';
        ctx.fillText(state.id.substring(0, 5), screen.x, screen.y + 16);
      });

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [mapCenter, zoomLevel, h3Hexagons, pickup, destination, prefersReducedMotion]);

  // Handle Dragging / Map Panning
  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    dragStart.current = { x: e.clientX, y: e.clientY };

    const scale = Math.pow(2, zoomLevel) * 0.1;
    // Update center based on pixel drag delta
    setMapCenter((prev) => ({
      lat: prev.lat + dy / scale,
      lng: prev.lng - dx / (scale * 1.5),
    }));
  };

  const handleMouseUpOrLeave = () => {
    isDragging.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    setZoomLevel((prev) => Math.max(13, Math.min(18, prev - Math.sign(e.deltaY))));
  };

  return (
    <div className="relative w-full h-full overflow-hidden rounded-2xl border border-border-opaque shadow-2xl bg-background-tertiary select-none">
      <canvas
        ref={canvasRef}
        width={750}
        height={450}
        role="img"
        aria-label="Live map of nearby drivers and the trip route. Use the zoom buttons to change view."
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onWheel={handleWheel}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* Glassmorphic Map Control Overlays */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2 p-1.5 rounded-xl border border-border-opaque/80 bg-background-secondary/60 backdrop-blur-md shadow-xl">
        <button
          onClick={() => setZoomLevel((z) => Math.min(18, z + 1))}
          aria-label="Zoom in"
          className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-content-primary hover:bg-background-tertiary/80 active:bg-background-tertiary transition"
        >
          +
        </button>
        <button
          onClick={() => setZoomLevel((z) => Math.max(13, z - 1))}
          aria-label="Zoom out"
          className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-content-primary hover:bg-background-tertiary/80 active:bg-background-tertiary transition"
        >
          −
        </button>
      </div>

      <div className="absolute top-4 left-4 p-2.5 rounded-xl border border-border-opaque/80 bg-background-secondary/70 backdrop-blur-md shadow-lg flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-positive-400 animate-pulse" />
        <span className="text-[11px] font-semibold text-content-secondary uppercase tracking-wider">
          Live Vector Grid (Kolkata)
        </span>
      </div>
    </div>
  );
}
