package google

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/platform/driver-delivery/internal/routing/graph"
	"github.com/redis/go-redis/v9"
)

type PremiumHybridRouter struct {
	apiKey     string
	chService  *graph.ContractionHierarchiesService
	mapsClient *GoogleMapsClient
}

func NewPremiumHybridRouter(apiKey string, chService *graph.ContractionHierarchiesService, clusterClient *redis.ClusterClient) *PremiumHybridRouter {
	var mapsClient *GoogleMapsClient
	if apiKey != "" && apiKey != "YOUR_GOOGLE_MAPS_API_KEY" {
		logger := log.New(log.Writer(), "[GOOGLE_ROUTER] ", log.LstdFlags)
		mapsClient = NewGoogleMapsClient(apiKey, clusterClient, logger)
		log.Println("[ROUTING] Google Maps Distance Matrix API enabled as primary routing path.")
	} else {
		log.Println("[ROUTING] Google Maps API key missing. Operating in pure local Contraction Hierarchies mode.")
	}

	return &PremiumHybridRouter{
		apiKey:     apiKey,
		chService:  chService,
		mapsClient: mapsClient,
	}
}

func (r *PremiumHybridRouter) ComputeShortestPathETA(ctx context.Context, sourceID, targetID int64) (float64, error) {
	// Look up nodes in CHService to obtain spatial coordinates
	sourceNode, err := r.getNode(sourceID)
	if err != nil {
		return r.chService.ComputeShortestPathETA(ctx, sourceID, targetID)
	}
	targetNode, err := r.getNode(targetID)
	if err != nil {
		return r.chService.ComputeShortestPathETA(ctx, sourceID, targetID)
	}

	// Only attempt Google Maps (Redis cache check + API) when the caller's context has
	// enough remaining budget: the cache check alone needs ~35ms, and the API path needs
	// ~400ms. Batch edge-cost calls arrive with a ~15ms budget — they must go straight to
	// CH (sub-millisecond in-memory), otherwise both sub-contexts collapse to the parent
	// deadline and GetTransitMetrics always deadlines out, swallows the error as a local
	// fallback, and the Redis cache never warms.
	if r.mapsClient != nil {
		if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) >= 50*time.Millisecond {
			metrics, err := r.mapsClient.GetTransitMetrics(ctx, sourceNode.Latitude, sourceNode.Longitude, targetNode.Latitude, targetNode.Longitude)
			if err == nil {
				return float64(metrics.DurationSecs), nil
			}
			log.Printf("[ROUTING_FALLBACK] Google Maps API failed (%v). Falling back to local OSM Contraction Hierarchies.", err)
		}
	}

	// Fallback to pure local calculation
	return r.chService.ComputeShortestPathETA(ctx, sourceID, targetID)
}

func (r *PremiumHybridRouter) getNode(id int64) (*graph.CHNode, error) {
	node, exists := r.chService.GetNode(id)
	if !exists {
		return nil, fmt.Errorf("graph_node_not_found: id %d", id)
	}
	return node, nil
}
