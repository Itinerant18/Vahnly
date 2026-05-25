package graph_test

import (
	"context"
	"testing"
	"time"

	"github.com/platform/driver-delivery/internal/routing/graph"
)

func TestComputeShortestPathETA_SimplePath(t *testing.T) {
	// Setup Graph Service
	s := graph.NewContractionHierarchiesService()

	// Define nodes with importance order
	// Dijkstra search only moves upward along order ranking.
	s.AddNode(&graph.CHNode{ID: 1, Order: 1})
	s.AddNode(&graph.CHNode{ID: 2, Order: 3})
	s.AddNode(&graph.CHNode{ID: 3, Order: 2})
	s.AddNode(&graph.CHNode{ID: 4, Order: 4})

	// Add directed edges
	// Node order order:
	// 1 (Order 1) -> 3 (Order 2) -> 2 (Order 3) -> 4 (Order 4)
	s.AddEdge(1, 3, 10.0, false)
	s.AddEdge(3, 2, 5.0, false)
	s.AddEdge(2, 4, 15.0, false)

	// Add a shortcut: 1 -> 2 (weight: 15.0, which bypasses 3)
	s.AddEdge(1, 2, 15.0, true)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	// Compute ETA from Node 1 to Node 4
	eta, err := s.ComputeShortestPathETA(ctx, 1, 4)
	if err != nil {
		t.Fatalf("Failed to compute shortest path: %v", err)
	}

	// Expected shortest path: 1 -> 2 -> 4 with weight 15 + 15 = 30.0
	expectedETA := 30.0
	if eta != expectedETA {
		t.Errorf("Expected ETA %f, got %f", expectedETA, eta)
	}
}

func TestComputeShortestPathETA_SameNode(t *testing.T) {
	s := graph.NewContractionHierarchiesService()
	s.AddNode(&graph.CHNode{ID: 1, Order: 1})

	eta, err := s.ComputeShortestPathETA(context.Background(), 1, 1)
	if err != nil {
		t.Fatalf("Failed to compute path to same node: %v", err)
	}
	if eta != 0.0 {
		t.Errorf("Expected ETA 0.0 for same source and target, got %f", eta)
	}
}

func TestComputeShortestPathETA_Disconnected(t *testing.T) {
	s := graph.NewContractionHierarchiesService()
	s.AddNode(&graph.CHNode{ID: 1, Order: 1})
	s.AddNode(&graph.CHNode{ID: 2, Order: 2})

	_, err := s.ComputeShortestPathETA(context.Background(), 1, 2)
	if err == nil {
		t.Fatal("Expected routing_error for disconnected graph, got nil")
	}
}
