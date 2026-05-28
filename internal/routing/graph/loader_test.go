package graph_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/platform/driver-delivery/internal/routing/graph"
)

func TestGraphLoader_IngestContractedTopology(t *testing.T) {
	// Create temporary nodes CSV
	nodesFile, err := os.CreateTemp("", "nodes_*.csv")
	if err != nil {
		t.Fatalf("failed to create temp nodes file: %v", err)
	}
	defer os.Remove(nodesFile.Name())
	defer nodesFile.Close()

	nodesContent := `id,latitude,longitude,importance_order
1000000001,22.572645,88.363892,1
1000000002,22.573112,88.364104,2
1000000003,22.574580,88.365990,3
`
	if _, err := nodesFile.WriteString(nodesContent); err != nil {
		t.Fatalf("failed to write temp nodes content: %v", err)
	}

	// Create temporary edges CSV
	edgesFile, err := os.CreateTemp("", "edges_*.csv")
	if err != nil {
		t.Fatalf("failed to create temp edges file: %v", err)
	}
	defer os.Remove(edgesFile.Name())
	defer edgesFile.Close()

	edgesContent := `from_node_id,to_node_id,weight_seconds,is_shortcut
1000000001,1000000002,12.4,0
1000000002,1000000003,45.1,0
1000000001,1000000003,57.5,1
`
	if _, err := edgesFile.WriteString(edgesContent); err != nil {
		t.Fatalf("failed to write temp edges content: %v", err)
	}

	svc := graph.NewContractionHierarchiesService()
	loader := graph.NewGraphLoader(svc)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	err = loader.IngestContractedTopology(ctx, nodesFile.Name(), edgesFile.Name())
	if err != nil {
		t.Fatalf("failed to load topology: %v", err)
	}

	// Verify nodes and shortcuts work
	eta, err := svc.ComputeShortestPathETA(ctx, 1000000001, 1000000003)
	if err != nil {
		t.Fatalf("failed to compute path: %v", err)
	}

	expectedETA := 57.5
	if eta != expectedETA {
		t.Errorf("expected ETA %f, got %f", expectedETA, eta)
	}
}
