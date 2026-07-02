package http

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type MapHandler struct {
	cache         *redis.ClusterClient
	httpClient    *http.Client
	osrmBase      string
	nominatimBase string
	logger        *log.Logger
}

func NewMapHandler(cache *redis.ClusterClient, logger *log.Logger) *MapHandler {
	return &MapHandler{
		cache:         cache,
		httpClient:    &http.Client{Timeout: 900 * time.Millisecond},
		osrmBase:      strings.TrimRight(os.Getenv("OSRM_BASE_URL"), "/"),
		nominatimBase: strings.TrimRight(os.Getenv("NOMINATIM_BASE_URL"), "/"),
		logger:        logger,
	}
}

type mapPoint struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type mapRouteRequest struct {
	Driver  *mapPoint `json:"driver"`
	Pickup  mapPoint  `json:"pickup"`
	Dropoff *mapPoint `json:"dropoff"`
	TripID  string    `json:"trip_id"`
}

type mapRouteResponse struct {
	Geometry          []mapPoint `json:"geometry"`
	DistanceMeters    int64      `json:"distance_meters"`
	DurationSeconds   int64      `json:"duration_seconds"`
	FareEstimatePaise *int64     `json:"fare_estimate_paise,omitempty"`
	Source            string     `json:"source"`
}

type osrmRouteResponse struct {
	Code   string `json:"code"`
	Routes []struct {
		Distance float64 `json:"distance"`
		Duration float64 `json:"duration"`
		Geometry struct {
			Coordinates [][]float64 `json:"coordinates"`
		} `json:"geometry"`
	} `json:"routes"`
}

func (h *MapHandler) HandleRoute(w http.ResponseWriter, r *http.Request) {
	if _, ok := riderIDFromContext(w, r); !ok {
		return
	}
	var req mapRouteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid route request", "ERR_INVALID_REQUEST")
		return
	}
	resp := h.route(r.Context(), req)
	writeData(w, http.StatusOK, resp)
}

func (h *MapHandler) HandleETA(w http.ResponseWriter, r *http.Request) {
	h.HandleRoute(w, r)
}

func (h *MapHandler) route(ctx context.Context, req mapRouteRequest) mapRouteResponse {
	points := routePoints(req)
	if len(points) < 2 {
		return mapRouteResponse{Geometry: points, Source: "LOCAL_FALLBACK"}
	}

	cacheKey := routeCacheKey(points)
	if h.cache != nil {
		cacheCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
		if cached, err := h.cache.Get(cacheCtx, cacheKey).Bytes(); err == nil {
			cancel()
			var resp mapRouteResponse
			if json.Unmarshal(cached, &resp) == nil {
				resp.Source = "REDIS_CACHE"
				return resp
			}
		} else {
			cancel()
		}
	}

	if h.osrmBase != "" {
		if resp, err := h.routeViaOSRM(ctx, points); err == nil {
			h.cacheRoute(cacheKey, resp)
			return resp
		} else if h.logger != nil {
			h.logger.Printf("[MAP_OSRM_FALLBACK] %v", err)
		}
	}

	resp := fallbackRoute(points)
	h.cacheRoute(cacheKey, resp)
	return resp
}

func routePoints(req mapRouteRequest) []mapPoint {
	points := make([]mapPoint, 0, 3)
	if req.Driver != nil && validPoint(*req.Driver) {
		points = append(points, *req.Driver)
	}
	if validPoint(req.Pickup) {
		points = append(points, req.Pickup)
	}
	if req.Dropoff != nil && validPoint(*req.Dropoff) {
		points = append(points, *req.Dropoff)
	}
	return points
}

func validPoint(p mapPoint) bool {
	return p.Lat >= -90 && p.Lat <= 90 && p.Lng >= -180 && p.Lng <= 180 &&
		!math.IsNaN(p.Lat) && !math.IsNaN(p.Lng) && !math.IsInf(p.Lat, 0) && !math.IsInf(p.Lng, 0)
}

func routeCacheKey(points []mapPoint) string {
	parts := make([]string, 0, len(points))
	for _, p := range points {
		parts = append(parts, fmt.Sprintf("%.4f,%.4f", p.Lat, p.Lng))
	}
	sum := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return fmt.Sprintf("map:route:%x", sum)
}

func (h *MapHandler) routeViaOSRM(ctx context.Context, points []mapPoint) (mapRouteResponse, error) {
	coords := make([]string, 0, len(points))
	for _, p := range points {
		coords = append(coords, fmt.Sprintf("%.6f,%.6f", p.Lng, p.Lat))
	}
	endpoint := fmt.Sprintf("%s/route/v1/driving/%s?overview=full&geometries=geojson", h.osrmBase, strings.Join(coords, ";"))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return mapRouteResponse{}, err
	}
	resp, err := h.httpClient.Do(req)
	if err != nil {
		return mapRouteResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return mapRouteResponse{}, fmt.Errorf("osrm status %d", resp.StatusCode)
	}
	var decoded osrmRouteResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return mapRouteResponse{}, err
	}
	if decoded.Code != "Ok" || len(decoded.Routes) == 0 {
		return mapRouteResponse{}, fmt.Errorf("osrm code %q", decoded.Code)
	}
	route := decoded.Routes[0]
	geometry := make([]mapPoint, 0, len(route.Geometry.Coordinates))
	for _, c := range route.Geometry.Coordinates {
		if len(c) >= 2 {
			geometry = append(geometry, mapPoint{Lat: c[1], Lng: c[0]})
		}
	}
	return mapRouteResponse{
		Geometry:        geometry,
		DistanceMeters:  int64(math.Round(route.Distance)),
		DurationSeconds: int64(math.Round(route.Duration)),
		Source:          "OSRM",
	}, nil
}

func fallbackRoute(points []mapPoint) mapRouteResponse {
	var distance float64
	for i := 1; i < len(points); i++ {
		distance += haversineMeters(points[i-1], points[i]) * 1.25
	}
	return mapRouteResponse{
		Geometry:        points,
		DistanceMeters:  int64(math.Round(distance)),
		DurationSeconds: int64(math.Round(distance / 11.1)), // ~40 km/h city driving
		Source:          "LOCAL_FALLBACK",
	}
}

func (h *MapHandler) cacheRoute(key string, resp mapRouteResponse) {
	if h.cache == nil {
		return
	}
	bytes, err := json.Marshal(resp)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	_ = h.cache.Set(ctx, key, bytes, 60*time.Second).Err()
}

func haversineMeters(a, b mapPoint) float64 {
	const earthMeters = 6371000.0
	dLat := (b.Lat - a.Lat) * math.Pi / 180
	dLng := (b.Lng - a.Lng) * math.Pi / 180
	lat1 := a.Lat * math.Pi / 180
	lat2 := b.Lat * math.Pi / 180
	h := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthMeters * math.Asin(math.Sqrt(h))
}

type geocodeResult struct {
	DisplayName string  `json:"display_name"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
}

type nominatimSearchItem struct {
	DisplayName string `json:"display_name"`
	Lat         string `json:"lat"`
	Lon         string `json:"lon"`
}

func (h *MapHandler) HandleGeocode(w http.ResponseWriter, r *http.Request) {
	if _, ok := riderIDFromContext(w, r); !ok {
		return
	}
	address := strings.TrimSpace(r.URL.Query().Get("address"))
	if address == "" {
		writeData(w, http.StatusOK, map[string]any{"results": []geocodeResult{}})
		return
	}
	if h.nominatimBase == "" {
		writeData(w, http.StatusOK, map[string]any{"results": []geocodeResult{}})
		return
	}
	endpoint := h.nominatimBase + "/search?" + url.Values{
		"q":              {address},
		"format":         {"jsonv2"},
		"limit":          {"6"},
		"addressdetails": {"1"},
	}.Encode()
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, endpoint, nil)
	req.Header.Set("User-Agent", "driver-for-u-map-service/1.0")
	resp, err := h.httpClient.Do(req)
	if err != nil {
		writeData(w, http.StatusOK, map[string]any{"results": []geocodeResult{}})
		return
	}
	defer resp.Body.Close()
	var items []nominatimSearchItem
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&items) != nil {
		writeData(w, http.StatusOK, map[string]any{"results": []geocodeResult{}})
		return
	}
	results := make([]geocodeResult, 0, len(items))
	for _, item := range items {
		lat, latErr := strconv.ParseFloat(item.Lat, 64)
		lng, lngErr := strconv.ParseFloat(item.Lon, 64)
		if latErr == nil && lngErr == nil {
			results = append(results, geocodeResult{DisplayName: item.DisplayName, Lat: lat, Lng: lng})
		}
	}
	writeData(w, http.StatusOK, map[string]any{"results": results})
}

func (h *MapHandler) HandleReverseGeocode(w http.ResponseWriter, r *http.Request) {
	if _, ok := riderIDFromContext(w, r); !ok {
		return
	}
	lat := parseFloatDefault(r.URL.Query().Get("lat"), 22.5726)
	lng := parseFloatDefault(r.URL.Query().Get("lng"), 88.3639)
	fallback := geocodeResult{DisplayName: fmt.Sprintf("%.5f, %.5f", lat, lng), Lat: lat, Lng: lng}
	if h.nominatimBase == "" {
		writeData(w, http.StatusOK, fallback)
		return
	}
	endpoint := h.nominatimBase + "/reverse?" + url.Values{
		"lat":    {fmt.Sprintf("%.6f", lat)},
		"lon":    {fmt.Sprintf("%.6f", lng)},
		"format": {"jsonv2"},
	}.Encode()
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, endpoint, nil)
	req.Header.Set("User-Agent", "driver-for-u-map-service/1.0")
	resp, err := h.httpClient.Do(req)
	if err != nil {
		writeData(w, http.StatusOK, fallback)
		return
	}
	defer resp.Body.Close()
	var item nominatimSearchItem
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&item) != nil || item.DisplayName == "" {
		writeData(w, http.StatusOK, fallback)
		return
	}
	writeData(w, http.StatusOK, geocodeResult{DisplayName: item.DisplayName, Lat: lat, Lng: lng})
}

func (h *MapHandler) HandleNearbyDrivers(w http.ResponseWriter, r *http.Request) {
	if _, ok := riderIDFromContext(w, r); !ok {
		return
	}
	lat := parseFloatDefault(r.URL.Query().Get("lat"), 22.5726)
	lng := parseFloatDefault(r.URL.Query().Get("lng"), 88.3639)
	radiusM := parsePositiveDefault(r.URL.Query().Get("radius"), 3000)
	drivers := deterministicNearbyDrivers(lat, lng, radiusM)
	writeData(w, http.StatusOK, map[string]any{"drivers": drivers})
}

func parsePositiveDefault(s string, def float64) float64 {
	if s == "" {
		return def
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil && f > 0 && !math.IsNaN(f) && !math.IsInf(f, 0) {
		return f
	}
	return def
}

func deterministicNearbyDrivers(lat, lng, radiusM float64) []nearbyDriver {
	if radiusM <= 0 {
		radiusM = 3000
	}
	offsets := []struct {
		factor  float64
		bearing float64
	}{
		{0.12, 30}, {0.2, 110}, {0.27, 200}, {0.35, 280}, {0.16, 340},
	}
	const metresPerDegLat = 111_320.0
	metresPerDegLng := metresPerDegLat * math.Cos(lat*math.Pi/180)
	drivers := make([]nearbyDriver, 0, len(offsets))
	for i, o := range offsets {
		rad := o.bearing * math.Pi / 180
		distanceM := math.Min(radiusM, 3000) * o.factor
		drivers = append(drivers, nearbyDriver{
			ID:      "map-nearby-" + strconv.Itoa(i+1),
			Lat:     lat + (distanceM*math.Cos(rad))/metresPerDegLat,
			Lng:     lng + (distanceM*math.Sin(rad))/metresPerDegLng,
			Bearing: o.bearing,
		})
	}
	return drivers
}
