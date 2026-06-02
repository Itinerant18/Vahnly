package google

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"time"

	"github.com/platform/driver-delivery/internal/routing/graph"
)

type GoogleMapsRoutingService struct {
	apiKey    string
	chService *graph.ContractionHierarchiesService
	client    *http.Client
}

func NewGoogleMapsRoutingService(apiKey string, chService *graph.ContractionHierarchiesService) *GoogleMapsRoutingService {
	return &GoogleMapsRoutingService{
		apiKey:    apiKey,
		chService: chService,
		client:    &http.Client{Timeout: 5 * time.Second},
	}
}

// DistanceMatrixResponse maps the structure of Google's Distance Matrix response
type DistanceMatrixResponse struct {
	Rows []struct {
		Elements []struct {
			Status   string `json:"status"`
			Duration struct {
				Value int64 `json:"value"` // Travel duration in seconds
			} `json:"duration"`
			Distance struct {
				Value int64 `json:"value"` // Distance in meters
			} `json:"distance"`
		} `json:"elements"`
	} `json:"rows"`
	Status string `json:"status"`
}

func (g *GoogleMapsRoutingService) ComputeShortestPathETA(ctx context.Context, sourceID, targetID int64) (float64, error) {
	// Look up nodes in CHService to obtain spatial coordinates
	sourceNode, err := g.getNode(sourceID)
	if err != nil {
		return 0, err
	}
	targetNode, err := g.getNode(targetID)
	if err != nil {
		return 0, err
	}

	// Hit Google Distance Matrix API
	origins := fmt.Sprintf("%f,%f", sourceNode.Latitude, sourceNode.Longitude)
	destinations := fmt.Sprintf("%f,%f", targetNode.Latitude, targetNode.Longitude)

	apiURL := fmt.Sprintf("https://maps.googleapis.com/maps/api/distancematrix/json?origins=%s&destinations=%s&key=%s", 
		url.QueryEscape(origins), 
		url.QueryEscape(destinations), 
		g.apiKey,
	)

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return 0, err
	}

	resp, err := g.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("google_api_http_error: status %d", resp.StatusCode)
	}

	var dmResp DistanceMatrixResponse
	if err := json.NewDecoder(resp.Body).Decode(&dmResp); err != nil {
		return 0, err
	}

	if dmResp.Status != "OK" || len(dmResp.Rows) == 0 || len(dmResp.Rows[0].Elements) == 0 {
		return 0, fmt.Errorf("google_api_status_error: status %s", dmResp.Status)
	}

	elem := dmResp.Rows[0].Elements[0]
	if elem.Status != "OK" {
		return 0, fmt.Errorf("google_element_status_error: status %s", elem.Status)
	}

	// Return duration in seconds
	return float64(elem.Duration.Value), nil
}

func (g *GoogleMapsRoutingService) getNode(id int64) (*graph.CHNode, error) {
	node, exists := g.chService.GetNode(id)
	if !exists {
		return nil, fmt.Errorf("graph_node_not_found: id %d", id)
	}
	return node, nil
}

type PremiumHybridRouter struct {
	apiKey    string
	chService *graph.ContractionHierarchiesService
	googleSvc *GoogleMapsRoutingService
}

func NewPremiumHybridRouter(apiKey string, chService *graph.ContractionHierarchiesService) *PremiumHybridRouter {
	var googleSvc *GoogleMapsRoutingService
	if apiKey != "" && apiKey != "YOUR_GOOGLE_MAPS_API_KEY" {
		googleSvc = NewGoogleMapsRoutingService(apiKey, chService)
		log.Println("[ROUTING] Google Maps Distance Matrix API enabled as primary routing path.")
	} else {
		log.Println("[ROUTING] Google Maps API key missing. Operating in pure local Contraction Hierarchies mode.")
	}

	return &PremiumHybridRouter{
		apiKey:    apiKey,
		chService: chService,
		googleSvc: googleSvc,
	}
}

func (r *PremiumHybridRouter) ComputeShortestPathETA(ctx context.Context, sourceID, targetID int64) (float64, error) {
	if r.googleSvc != nil {
		eta, err := r.googleSvc.ComputeShortestPathETA(ctx, sourceID, targetID)
		if err == nil {
			return eta, nil
		}
		// Log the error and fall back to local OSM graph
		log.Printf("[ROUTING_FALLBACK] Google Maps API failed (%v). Falling back to local OSM Contraction Hierarchies.", err)
	}

	// Fallback to pure local calculation
	return r.chService.ComputeShortestPathETA(ctx, sourceID, targetID)
}
